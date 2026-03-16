import { describe, expect, mock, test } from "bun:test";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
	BatchWriteCommand,
	DeleteCommand,
	PutCommand,
	QueryCommand,
} from "@aws-sdk/lib-dynamodb";

import type { EmailFilters, EmailItem } from "./dynamo";
import {
	buildFilterExpression,
	buildSortKey,
	createEmailRepository,
	mapEmailItem,
	ttl,
} from "./dynamo";

describe("buildSortKey", () => {
	test("formats as ISO timestamp # messageId", () => {
		const ts = new Date("2025-03-10T12:00:00.000Z").getTime();
		const sk = buildSortKey(ts, "abc-123");

		expect(sk).toBe("2025-03-10T12:00:00.000Z#abc-123");
	});

	test("preserves messageId with special characters", () => {
		const ts = new Date("2025-01-01T00:00:00.000Z").getTime();
		const sk = buildSortKey(ts, "msg@example.com");

		expect(sk).toBe("2025-01-01T00:00:00.000Z#msg@example.com");
	});

	test("empty messageId still produces valid sort key", () => {
		const ts = new Date("2025-01-01T00:00:00.000Z").getTime();
		const sk = buildSortKey(ts, "");

		expect(sk).toBe("2025-01-01T00:00:00.000Z#");
	});
});

describe("ttl", () => {
	test("returns unix epoch seconds roughly 7 days from now", () => {
		const before = Math.floor(Date.now() / 1000);
		const result = ttl();
		const after = Math.floor(Date.now() / 1000);

		const sevenDays = 7 * 24 * 60 * 60;
		expect(result).toBeGreaterThanOrEqual(before + sevenDays);
		expect(result).toBeLessThanOrEqual(after + sevenDays);
	});

	test("returns an integer", () => {
		expect(Number.isInteger(ttl())).toBe(true);
	});
});

describe("buildFilterExpression", () => {
	test("returns undefined for empty filters", () => {
		expect(buildFilterExpression({})).toBeUndefined();
	});

	test("builds sender contains condition", () => {
		const result = buildFilterExpression({ sender: "alice" });
		if (!result) throw new Error("expected filter expression");

		expect(result.FilterExpression).toBe("contains(#sender, :sender)");
		expect(result.ExpressionAttributeValues).toEqual({ ":sender": "alice" });
		expect(result.ExpressionAttributeNames).toEqual({ "#sender": "sender" });
	});

	test("builds subject contains condition", () => {
		const result = buildFilterExpression({ subject: "invoice" });
		if (!result) throw new Error("expected filter expression");

		expect(result.FilterExpression).toBe("contains(#subject, :subj)");
		expect(result.ExpressionAttributeValues).toEqual({ ":subj": "invoice" });
		expect(result.ExpressionAttributeNames).toEqual({
			"#subject": "subject",
		});
	});

	test("builds receivedAfter condition", () => {
		const result = buildFilterExpression({ receivedAfter: 1000 });
		if (!result) throw new Error("expected filter expression");

		expect(result.FilterExpression).toBe("receivedAt >= :rAfter");
		expect(result.ExpressionAttributeValues).toEqual({ ":rAfter": 1000 });
		expect(result.ExpressionAttributeNames).toBeUndefined();
	});

	test("builds receivedBefore condition", () => {
		const result = buildFilterExpression({ receivedBefore: 2000 });
		if (!result) throw new Error("expected filter expression");

		expect(result.FilterExpression).toBe("receivedAt <= :rBefore");
		expect(result.ExpressionAttributeValues).toEqual({ ":rBefore": 2000 });
	});

	test("builds hasAttachments true condition", () => {
		const result = buildFilterExpression({ hasAttachments: true });
		if (!result) throw new Error("expected filter expression");

		expect(result.FilterExpression).toBe("size(attachments) > :zero");
		expect(result.ExpressionAttributeValues).toEqual({ ":zero": 0 });
	});

	test("builds hasAttachments false condition", () => {
		const result = buildFilterExpression({ hasAttachments: false });
		if (!result) throw new Error("expected filter expression");

		expect(result.FilterExpression).toBe("size(attachments) = :zero");
		expect(result.ExpressionAttributeValues).toEqual({ ":zero": 0 });
	});

	test("combines multiple filters with AND", () => {
		const filters: EmailFilters = {
			sender: "alice",
			subject: "hello",
			receivedAfter: 1000,
			receivedBefore: 2000,
			hasAttachments: true,
		};
		const result = buildFilterExpression(filters);
		if (!result) throw new Error("expected filter expression");

		expect(result.FilterExpression).toBe(
			"contains(#sender, :sender) AND contains(#subject, :subj) AND receivedAt >= :rAfter AND receivedAt <= :rBefore AND size(attachments) > :zero",
		);
		expect(result.ExpressionAttributeValues).toEqual({
			":sender": "alice",
			":subj": "hello",
			":rAfter": 1000,
			":rBefore": 2000,
			":zero": 0,
		});
		expect(result.ExpressionAttributeNames).toEqual({
			"#sender": "sender",
			"#subject": "subject",
		});
	});

	test("omits ExpressionAttributeNames when no reserved words used", () => {
		const result = buildFilterExpression({ receivedAfter: 1000 });
		if (!result) throw new Error("expected filter expression");

		expect(result.ExpressionAttributeNames).toBeUndefined();
	});

	test("ignores explicitly undefined filter values", () => {
		const result = buildFilterExpression({
			sender: undefined,
			subject: undefined,
			receivedAfter: undefined,
			receivedBefore: undefined,
			hasAttachments: undefined,
		});

		expect(result).toBeUndefined();
	});
});

describe("mapEmailItem", () => {
	function makeRawItem(overrides: Record<string, unknown> = {}) {
		return {
			PK: "test-inbox",
			SK: "2025-03-10T12:00:00.000Z#msg-1",
			messageId: "msg-1",
			sender: "a@b.com",
			recipient: "test@domain.com",
			subject: "Hello",
			body: "plain text",
			htmlBody: "<p>html</p>",
			attachments: [],
			receivedAt: 1710072000000,
			s3Key: "incoming/abc",
			ttl: 9999999,
			...overrides,
		};
	}

	test("maps PK to inbox", () => {
		const result = mapEmailItem(makeRawItem());

		expect(result.inbox).toBe("test-inbox");
	});

	test("maps all standard fields", () => {
		const result = mapEmailItem(makeRawItem());

		expect(result.messageId).toBe("msg-1");
		expect(result.sender).toBe("a@b.com");
		expect(result.recipient).toBe("test@domain.com");
		expect(result.subject).toBe("Hello");
		expect(result.body).toBe("plain text");
		expect(result.htmlBody).toBe("<p>html</p>");
		expect(result.attachments).toEqual([]);
		expect(result.receivedAt).toBe(1710072000000);
		expect(result.s3Key).toBe("incoming/abc");
	});

	test("does not include DynamoDB-internal fields", () => {
		const result = mapEmailItem(makeRawItem()) as Record<string, unknown>;

		expect(result.PK).toBeUndefined();
		expect(result.SK).toBeUndefined();
		expect(result.ttl).toBeUndefined();
	});

	test.each([undefined, null])("defaults body to empty string when %s", (val:
		| undefined
		| null) => {
		const result = mapEmailItem(makeRawItem({ body: val }));

		expect(result.body).toBe("");
	});

	test.each([
		undefined,
		null,
	])("defaults htmlBody to empty string when %s", (val: undefined | null) => {
		const result = mapEmailItem(makeRawItem({ htmlBody: val }));

		expect(result.htmlBody).toBe("");
	});

	test.each([
		undefined,
		null,
	])("defaults attachments to empty array when %s", (val: undefined | null) => {
		const result = mapEmailItem(makeRawItem({ attachments: val }));

		expect(result.attachments).toEqual([]);
	});

	test("preserves attachment metadata", () => {
		const attachments = [
			{
				filename: "doc.pdf",
				contentType: "application/pdf",
				size: 1024,
				s3Key: "attachments/msg-1/doc.pdf",
				contentId: undefined,
			},
		];
		const result = mapEmailItem(makeRawItem({ attachments }));

		expect(result.attachments).toEqual(attachments);
	});

	test("returns exactly the EmailItem keys and no extras", () => {
		const result = mapEmailItem(makeRawItem());
		const keys = Object.keys(result).sort();

		expect(keys).toEqual([
			"attachments",
			"body",
			"htmlBody",
			"inbox",
			"messageId",
			"receivedAt",
			"recipient",
			"s3Key",
			"sender",
			"subject",
		]);
	});
});

const TABLE = "test-emails-table";

function makeMockClient(sendFn: (...args: unknown[]) => unknown) {
	return { send: mock(sendFn) } as unknown as DynamoDBDocumentClient & {
		send: ReturnType<typeof mock>;
	};
}

const FIXED_TS = 1741608000000;
const FIXED_ISO = new Date(FIXED_TS).toISOString();

function makeEmailItem(overrides: Partial<EmailItem> = {}): EmailItem {
	return {
		inbox: "test-inbox",
		messageId: "msg-1",
		sender: "a@b.com",
		recipient: "test@domain.com",
		subject: "Hello",
		body: "plain text",
		htmlBody: "<p>html</p>",
		attachments: [],
		s3Key: "incoming/abc",
		receivedAt: FIXED_TS,
		...overrides,
	};
}

function makeDynamoItem(overrides: Record<string, unknown> = {}) {
	return {
		PK: "test-inbox",
		SK: `${FIXED_ISO}#msg-1`,
		messageId: "msg-1",
		sender: "a@b.com",
		recipient: "test@domain.com",
		subject: "Hello",
		body: "plain text",
		htmlBody: "<p>html</p>",
		attachments: [],
		receivedAt: FIXED_TS,
		s3Key: "incoming/abc",
		ttl: 9999999,
		...overrides,
	};
}

describe("EmailRepository.putEmail", () => {
	test("sends PutCommand with correct table, keys, and all fields", async () => {
		const client = makeMockClient(() => ({}));
		const repo = createEmailRepository(client, TABLE);
		const item = makeEmailItem();

		await repo.putEmail(item);

		expect(client.send).toHaveBeenCalledTimes(1);
		const cmd = (client.send as ReturnType<typeof mock>).mock.calls[0][0];
		expect(cmd).toBeInstanceOf(PutCommand);
		expect(cmd.input.TableName).toBe(TABLE);
		expect(cmd.input.Item.PK).toBe("test-inbox");
		expect(cmd.input.Item.SK).toBe(`${FIXED_ISO}#msg-1`);
		expect(cmd.input.Item.messageId).toBe("msg-1");
		expect(cmd.input.Item.sender).toBe("a@b.com");
		expect(cmd.input.Item.recipient).toBe("test@domain.com");
		expect(cmd.input.Item.subject).toBe("Hello");
		expect(cmd.input.Item.body).toBe("plain text");
		expect(cmd.input.Item.htmlBody).toBe("<p>html</p>");
		expect(cmd.input.Item.attachments).toEqual([]);
		expect(cmd.input.Item.s3Key).toBe("incoming/abc");
		expect(cmd.input.Item.receivedAt).toBe(FIXED_TS);
		expect(cmd.input.Item.ttl).toBeGreaterThan(0);
	});

	test("builds sort key from receivedAt and messageId", async () => {
		const client = makeMockClient(() => ({}));
		const repo = createEmailRepository(client, TABLE);

		await repo.putEmail(
			makeEmailItem({
				receivedAt: new Date("2025-06-15T08:30:00.000Z").getTime(),
				messageId: "custom-id",
			}),
		);

		const cmd = (client.send as ReturnType<typeof mock>).mock.calls[0][0];
		expect(cmd.input.Item.SK).toBe("2025-06-15T08:30:00.000Z#custom-id");
	});
});

describe("EmailRepository.queryEmails", () => {
	test("queries with descending order and default limit of 50", async () => {
		const client = makeMockClient(() => ({
			Items: [],
			LastEvaluatedKey: undefined,
		}));
		const repo = createEmailRepository(client, TABLE);

		await repo.queryEmails({ inbox: "my-inbox" });

		const cmd = (client.send as ReturnType<typeof mock>).mock.calls[0][0];
		expect(cmd).toBeInstanceOf(QueryCommand);
		expect(cmd.input.TableName).toBe(TABLE);
		expect(cmd.input.ScanIndexForward).toBe(false);
		expect(cmd.input.Limit).toBe(50);
		expect(cmd.input.KeyConditionExpression).toBe("PK = :pk");
		expect(cmd.input.ExpressionAttributeValues[":pk"]).toBe("my-inbox");
	});

	test("returns mapped emails from single page", async () => {
		const items = [
			makeDynamoItem(),
			makeDynamoItem({
				PK: "test-inbox",
				messageId: "msg-2",
				SK: "2025-03-10T11:00:00.000Z#msg-2",
			}),
		];
		const client = makeMockClient(() => ({ Items: items }));
		const repo = createEmailRepository(client, TABLE);

		const result = await repo.queryEmails({ inbox: "test-inbox" });

		expect(result.emails).toHaveLength(2);
		expect(result.emails[0].messageId).toBe("msg-1");
		expect(result.emails[1].messageId).toBe("msg-2");
		expect(result.hasMore).toBe(false);
		expect(result.nextCursor).toBeUndefined();
	});

	test("uses cursor as SK upper bound on first page", async () => {
		const client = makeMockClient(() => ({ Items: [] }));
		const repo = createEmailRepository(client, TABLE);

		await repo.queryEmails({
			inbox: "my-inbox",
			cursor: "2025-03-10T12:00:00.000Z#msg-1",
		});

		const cmd = (client.send as ReturnType<typeof mock>).mock.calls[0][0];
		expect(cmd.input.KeyConditionExpression).toBe("PK = :pk AND SK < :sk");
		expect(cmd.input.ExpressionAttributeValues[":sk"]).toBe(
			"2025-03-10T12:00:00.000Z#msg-1",
		);
	});

	test("respects custom limit", async () => {
		const client = makeMockClient(() => ({ Items: [] }));
		const repo = createEmailRepository(client, TABLE);

		await repo.queryEmails({ inbox: "x", limit: 10 });

		const cmd = (client.send as ReturnType<typeof mock>).mock.calls[0][0];
		expect(cmd.input.Limit).toBe(10);
	});

	test("reports hasMore and nextCursor when LastEvaluatedKey present without filters", async () => {
		const client = makeMockClient(() => ({
			Items: [makeDynamoItem()],
			LastEvaluatedKey: { PK: "test-inbox", SK: "some-cursor" },
		}));
		const repo = createEmailRepository(client, TABLE);

		const result = await repo.queryEmails({ inbox: "test-inbox", limit: 1 });

		expect(result.hasMore).toBe(true);
		expect(result.nextCursor).toBe("some-cursor");
		expect(client.send).toHaveBeenCalledTimes(1);
	});

	test("does not paginate without filters even when LastEvaluatedKey exists", async () => {
		const client = makeMockClient(() => ({
			Items: [makeDynamoItem()],
			LastEvaluatedKey: { PK: "test-inbox", SK: "cursor" },
		}));
		const repo = createEmailRepository(client, TABLE);

		const result = await repo.queryEmails({ inbox: "test-inbox", limit: 5 });

		expect(client.send).toHaveBeenCalledTimes(1);
		expect(result.emails).toHaveLength(1);
		expect(result.hasMore).toBe(true);
	});

	test("paginates when filter reduces results below limit", async () => {
		let callCount = 0;
		const client = makeMockClient(() => {
			callCount++;
			if (callCount === 1) {
				return {
					Items: [makeDynamoItem()],
					LastEvaluatedKey: { PK: "test-inbox", SK: "page1-cursor" },
				};
			}
			return {
				Items: [
					makeDynamoItem({
						messageId: "msg-2",
						SK: "2025-03-09T12:00:00.000Z#msg-2",
					}),
				],
				LastEvaluatedKey: undefined,
			};
		});
		const repo = createEmailRepository(client, TABLE);

		const result = await repo.queryEmails({
			inbox: "test-inbox",
			limit: 5,
			filters: { sender: "a@b.com" },
		});

		expect(client.send).toHaveBeenCalledTimes(2);
		expect(result.emails).toHaveLength(2);
		expect(result.hasMore).toBe(false);
	});

	test("stops paginating when collected items reach limit with filters", async () => {
		let callCount = 0;
		const client = makeMockClient(() => {
			callCount++;
			return {
				Items: [
					makeDynamoItem({
						messageId: `msg-${callCount}`,
						SK: `2025-03-10T${10 - callCount}:00:00.000Z#msg-${callCount}`,
					}),
				],
				LastEvaluatedKey: { PK: "test-inbox", SK: `cursor-${callCount}` },
			};
		});
		const repo = createEmailRepository(client, TABLE);

		const result = await repo.queryEmails({
			inbox: "test-inbox",
			limit: 2,
			filters: { sender: "a@b.com" },
		});

		expect(client.send).toHaveBeenCalledTimes(2);
		expect(result.emails).toHaveLength(2);
		expect(result.hasMore).toBe(true);
	});

	test("merges filter expression attributes with key condition values", async () => {
		const client = makeMockClient(() => ({ Items: [] }));
		const repo = createEmailRepository(client, TABLE);

		await repo.queryEmails({
			inbox: "test-inbox",
			filters: { sender: "alice", receivedAfter: 1000 },
		});

		const cmd = (client.send as ReturnType<typeof mock>).mock.calls[0][0];
		expect(cmd.input.ExpressionAttributeValues).toEqual({
			":pk": "test-inbox",
			":sender": "alice",
			":rAfter": 1000,
		});
		expect(cmd.input.FilterExpression).toBe(
			"contains(#sender, :sender) AND receivedAt >= :rAfter",
		);
	});
});

describe("EmailRepository.getEmailByMessageId", () => {
	test("queries MessageIdIndex GSI with correct params", async () => {
		const client = makeMockClient(() => ({ Items: [] }));
		const repo = createEmailRepository(client, TABLE);

		await repo.getEmailByMessageId("msg-123");

		const cmd = (client.send as ReturnType<typeof mock>).mock.calls[0][0];
		expect(cmd).toBeInstanceOf(QueryCommand);
		expect(cmd.input.TableName).toBe(TABLE);
		expect(cmd.input.IndexName).toBe("MessageIdIndex");
		expect(cmd.input.KeyConditionExpression).toBe("messageId = :mid");
		expect(cmd.input.ExpressionAttributeValues).toEqual({ ":mid": "msg-123" });
		expect(cmd.input.Limit).toBe(1);
	});

	test("returns mapped EmailItem when found", async () => {
		const client = makeMockClient(() => ({ Items: [makeDynamoItem()] }));
		const repo = createEmailRepository(client, TABLE);

		const result = await repo.getEmailByMessageId("msg-1");

		if (!result) throw new Error("expected email item");
		expect(result.messageId).toBe("msg-1");
		expect(result.inbox).toBe("test-inbox");
		expect(result.sender).toBe("a@b.com");
	});

	test("returns null when no items found", async () => {
		const client = makeMockClient(() => ({ Items: [] }));
		const repo = createEmailRepository(client, TABLE);

		const result = await repo.getEmailByMessageId("nonexistent");

		expect(result).toBeNull();
	});

	test("returns null when Items is undefined", async () => {
		const client = makeMockClient(() => ({}));
		const repo = createEmailRepository(client, TABLE);

		const result = await repo.getEmailByMessageId("msg-1");

		expect(result).toBeNull();
	});
});

describe("EmailRepository.getEmailRawByMessageId", () => {
	test("returns PK and SK alongside mapped email fields", async () => {
		const client = makeMockClient(() => ({ Items: [makeDynamoItem()] }));
		const repo = createEmailRepository(client, TABLE);

		const result = await repo.getEmailRawByMessageId("msg-1");

		if (!result) throw new Error("expected raw email item");
		expect(result.PK).toBe("test-inbox");
		expect(result.SK).toBe(`${FIXED_ISO}#msg-1`);
		expect(result.messageId).toBe("msg-1");
		expect(result.inbox).toBe("test-inbox");
	});

	test("returns null when no items found", async () => {
		const client = makeMockClient(() => ({ Items: [] }));
		const repo = createEmailRepository(client, TABLE);

		const result = await repo.getEmailRawByMessageId("nonexistent");

		expect(result).toBeNull();
	});
});

describe("EmailRepository.deleteEmail", () => {
	test("sends DeleteCommand with correct table and key", async () => {
		const client = makeMockClient(() => ({}));
		const repo = createEmailRepository(client, TABLE);

		await repo.deleteEmail("inbox-pk", "2025-03-10T12:00:00.000Z#msg-1");

		expect(client.send).toHaveBeenCalledTimes(1);
		const cmd = (client.send as ReturnType<typeof mock>).mock.calls[0][0];
		expect(cmd).toBeInstanceOf(DeleteCommand);
		expect(cmd.input.TableName).toBe(TABLE);
		expect(cmd.input.Key).toEqual({
			PK: "inbox-pk",
			SK: "2025-03-10T12:00:00.000Z#msg-1",
		});
	});
});

describe("EmailRepository.queryAllEmailKeys", () => {
	test("returns all items from single page", async () => {
		const items = [
			{ PK: "inbox", SK: "sk-1", s3Key: "key-1", attachments: [] },
			{ PK: "inbox", SK: "sk-2", s3Key: "key-2", attachments: [] },
		];
		const client = makeMockClient(() => ({ Items: items }));
		const repo = createEmailRepository(client, TABLE);

		const result = await repo.queryAllEmailKeys("inbox");

		expect(result).toHaveLength(2);
		expect(result[0]).toEqual({
			PK: "inbox",
			SK: "sk-1",
			s3Key: "key-1",
			attachments: [],
		});
		expect(result[1]).toEqual({
			PK: "inbox",
			SK: "sk-2",
			s3Key: "key-2",
			attachments: [],
		});
	});

	test("paginates through multiple pages", async () => {
		let callCount = 0;
		const client = makeMockClient(() => {
			callCount++;
			if (callCount === 1) {
				return {
					Items: [{ PK: "inbox", SK: "sk-1", s3Key: "key-1", attachments: [] }],
					LastEvaluatedKey: { PK: "inbox", SK: "sk-1" },
				};
			}
			return {
				Items: [{ PK: "inbox", SK: "sk-2", s3Key: "key-2", attachments: [] }],
			};
		});
		const repo = createEmailRepository(client, TABLE);

		const result = await repo.queryAllEmailKeys("inbox");

		expect(client.send).toHaveBeenCalledTimes(2);
		expect(result).toHaveLength(2);
		expect(result[0].s3Key).toBe("key-1");
		expect(result[1].s3Key).toBe("key-2");
	});

	test("uses ProjectionExpression and correct key condition", async () => {
		const client = makeMockClient(() => ({ Items: [] }));
		const repo = createEmailRepository(client, TABLE);

		await repo.queryAllEmailKeys("my-inbox");

		const cmd = (client.send as ReturnType<typeof mock>).mock.calls[0][0];
		expect(cmd).toBeInstanceOf(QueryCommand);
		expect(cmd.input.ProjectionExpression).toBe("PK, SK, s3Key, attachments");
		expect(cmd.input.KeyConditionExpression).toBe("PK = :pk");
		expect(cmd.input.ExpressionAttributeValues).toEqual({ ":pk": "my-inbox" });
	});

	test("defaults attachments to empty array when null in item", async () => {
		const client = makeMockClient(() => ({
			Items: [{ PK: "inbox", SK: "sk-1", s3Key: "key-1", attachments: null }],
		}));
		const repo = createEmailRepository(client, TABLE);

		const result = await repo.queryAllEmailKeys("inbox");

		expect(result[0].attachments).toEqual([]);
	});
});

describe("EmailRepository.batchDeleteEmails", () => {
	test("sends BatchWriteCommand with correct delete requests", async () => {
		const client = makeMockClient(() => ({}));
		const repo = createEmailRepository(client, TABLE);
		const keys = [
			{ PK: "inbox", SK: "sk-1" },
			{ PK: "inbox", SK: "sk-2" },
		];

		await repo.batchDeleteEmails(keys);

		expect(client.send).toHaveBeenCalledTimes(1);
		const cmd = (client.send as ReturnType<typeof mock>).mock.calls[0][0];
		expect(cmd).toBeInstanceOf(BatchWriteCommand);
		expect(cmd.input.RequestItems[TABLE]).toEqual([
			{ DeleteRequest: { Key: { PK: "inbox", SK: "sk-1" } } },
			{ DeleteRequest: { Key: { PK: "inbox", SK: "sk-2" } } },
		]);
	});

	test("chunks into batches of 25", async () => {
		const client = makeMockClient(() => ({}));
		const repo = createEmailRepository(client, TABLE);
		const keys = Array.from({ length: 30 }, (_, i) => ({
			PK: "inbox",
			SK: `sk-${i}`,
		}));

		await repo.batchDeleteEmails(keys);

		expect(client.send).toHaveBeenCalledTimes(2);
		const cmd1 = (client.send as ReturnType<typeof mock>).mock.calls[0][0];
		const cmd2 = (client.send as ReturnType<typeof mock>).mock.calls[1][0];
		expect(cmd1.input.RequestItems[TABLE]).toHaveLength(25);
		expect(cmd2.input.RequestItems[TABLE]).toHaveLength(5);
	});

	test("retries unprocessed items", async () => {
		let callCount = 0;
		const client = makeMockClient(() => {
			callCount++;
			if (callCount === 1) {
				return {
					UnprocessedItems: {
						[TABLE]: [{ DeleteRequest: { Key: { PK: "inbox", SK: "sk-2" } } }],
					},
				};
			}
			return {};
		});
		const repo = createEmailRepository(client, TABLE);

		await repo.batchDeleteEmails([
			{ PK: "inbox", SK: "sk-1" },
			{ PK: "inbox", SK: "sk-2" },
		]);

		expect(client.send).toHaveBeenCalledTimes(2);
		const retryCmd = (client.send as ReturnType<typeof mock>).mock.calls[1][0];
		expect(retryCmd.input.RequestItems[TABLE]).toEqual([
			{ DeleteRequest: { Key: { PK: "inbox", SK: "sk-2" } } },
		]);
	});

	test("handles empty input without sending any commands", async () => {
		const client = makeMockClient(() => ({}));
		const repo = createEmailRepository(client, TABLE);

		await repo.batchDeleteEmails([]);

		expect(client.send).toHaveBeenCalledTimes(0);
	});
});
