import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
	BatchWriteCommand,
	DeleteCommand,
	DynamoDBDocumentClient,
	PutCommand,
	QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { Resource } from "sst";

const client = DynamoDBDocumentClient.from(new DynamoDBClient());

const SEVEN_DAYS_SEC = 7 * 24 * 60 * 60;
const BATCH_DELETE_SIZE = 25;

export interface AttachmentMeta {
	filename: string;
	contentType: string;
	size: number;
	s3Key: string;
	contentId?: string;
}

export interface EmailItem {
	inbox: string;
	messageId: string;
	sender: string;
	recipient: string;
	subject: string;
	body: string;
	htmlBody: string;
	attachments: AttachmentMeta[];
	s3Key: string;
	receivedAt: number;
}

export interface RawEmailRecord extends EmailItem {
	PK: string;
	SK: string;
}

export interface EmailFilters {
	sender?: string;
	subject?: string;
	receivedAfter?: number;
	receivedBefore?: number;
	hasAttachments?: boolean;
}

/** @returns TTL in unix epoch seconds, 7 days from now */
function ttl(): number {
	return Math.floor(Date.now() / 1000) + SEVEN_DAYS_SEC;
}

export async function putEmail(item: EmailItem) {
	const sk = `${new Date(item.receivedAt).toISOString()}#${item.messageId}`;

	await client.send(
		new PutCommand({
			TableName: Resource.EmailsTable.name,
			Item: {
				PK: item.inbox,
				SK: sk,
				messageId: item.messageId,
				sender: item.sender,
				recipient: item.recipient,
				subject: item.subject,
				body: item.body,
				htmlBody: item.htmlBody,
				attachments: item.attachments,
				s3Key: item.s3Key,
				receivedAt: item.receivedAt,
				ttl: ttl(),
			},
		}),
	);
}

export interface QueryEmailsOpts {
	inbox: string;
	cursor?: string;
	limit?: number;
	filters?: EmailFilters;
}

function buildFilterExpression(filters: EmailFilters) {
	const conditions: string[] = [];
	const values: Record<string, unknown> = {};
	const names: Record<string, string> = {};

	if (filters.sender !== undefined) {
		conditions.push("contains(#sender, :sender)");
		names["#sender"] = "sender";
		values[":sender"] = filters.sender;
	}

	if (filters.subject !== undefined) {
		conditions.push("contains(#subject, :subj)");
		names["#subject"] = "subject";
		values[":subj"] = filters.subject;
	}

	if (filters.receivedAfter !== undefined) {
		conditions.push("receivedAt >= :rAfter");
		values[":rAfter"] = filters.receivedAfter;
	}

	if (filters.receivedBefore !== undefined) {
		conditions.push("receivedAt <= :rBefore");
		values[":rBefore"] = filters.receivedBefore;
	}

	if (filters.hasAttachments === true) {
		conditions.push("size(attachments) > :zero");
		values[":zero"] = 0;
	} else if (filters.hasAttachments === false) {
		conditions.push("size(attachments) = :zero");
		values[":zero"] = 0;
	}

	if (conditions.length === 0) return undefined;

	return {
		FilterExpression: conditions.join(" AND "),
		ExpressionAttributeValues: values,
		ExpressionAttributeNames: Object.keys(names).length > 0 ? names : undefined,
	};
}

export async function queryEmails({
	inbox,
	cursor,
	limit = 50,
	filters,
}: QueryEmailsOpts) {
	const keyCondition = cursor ? "PK = :pk AND SK < :sk" : "PK = :pk";
	const keyValues: Record<string, unknown> = cursor
		? { ":pk": inbox, ":sk": cursor }
		: { ":pk": inbox };

	const filter = filters ? buildFilterExpression(filters) : undefined;

	const result = await client.send(
		new QueryCommand({
			TableName: Resource.EmailsTable.name,
			KeyConditionExpression: keyCondition,
			ExpressionAttributeValues: {
				...keyValues,
				...filter?.ExpressionAttributeValues,
			},
			ExpressionAttributeNames: filter?.ExpressionAttributeNames,
			FilterExpression: filter?.FilterExpression,
			ScanIndexForward: false,
			Limit: limit,
		}),
	);

	const items = result.Items ?? [];
	const lastEvaluatedKey = result.LastEvaluatedKey;

	return {
		emails: items.map((item) => ({
			messageId: item.messageId as string,
			inbox: item.PK as string,
			sender: item.sender as string,
			recipient: item.recipient as string,
			subject: item.subject as string,
			body: (item.body as string) ?? "",
			htmlBody: (item.htmlBody as string) ?? "",
			attachments: (item.attachments as AttachmentMeta[]) ?? [],
			receivedAt: item.receivedAt as number,
			s3Key: item.s3Key as string,
		})),
		nextCursor: (lastEvaluatedKey?.SK as string) ?? undefined,
		hasMore: lastEvaluatedKey !== undefined,
	};
}

export async function getEmailByMessageId(
	messageId: string,
): Promise<EmailItem | null> {
	const result = await client.send(
		new QueryCommand({
			TableName: Resource.EmailsTable.name,
			IndexName: "MessageIdIndex",
			KeyConditionExpression: "messageId = :mid",
			ExpressionAttributeValues: { ":mid": messageId },
			Limit: 1,
		}),
	);

	return (result.Items?.[0] as EmailItem) ?? null;
}

export async function getEmailRawByMessageId(
	messageId: string,
): Promise<RawEmailRecord | null> {
	const result = await client.send(
		new QueryCommand({
			TableName: Resource.EmailsTable.name,
			IndexName: "MessageIdIndex",
			KeyConditionExpression: "messageId = :mid",
			ExpressionAttributeValues: { ":mid": messageId },
			Limit: 1,
		}),
	);

	return (result.Items?.[0] as RawEmailRecord) ?? null;
}

export async function deleteEmail(pk: string, sk: string): Promise<void> {
	await client.send(
		new DeleteCommand({
			TableName: Resource.EmailsTable.name,
			Key: { PK: pk, SK: sk },
		}),
	);
}

export async function queryAllEmailKeys(inbox: string): Promise<
	Array<{
		PK: string;
		SK: string;
		s3Key: string;
		attachments: AttachmentMeta[];
	}>
> {
	const items: Array<{
		PK: string;
		SK: string;
		s3Key: string;
		attachments: AttachmentMeta[];
	}> = [];
	let lastKey: Record<string, unknown> | undefined;

	do {
		const result = await client.send(
			new QueryCommand({
				TableName: Resource.EmailsTable.name,
				KeyConditionExpression: "PK = :pk",
				ExpressionAttributeValues: { ":pk": inbox },
				ProjectionExpression: "PK, SK, s3Key, attachments",
				ExclusiveStartKey: lastKey,
			}),
		);

		for (const item of result.Items ?? []) {
			items.push({
				PK: item.PK as string,
				SK: item.SK as string,
				s3Key: item.s3Key as string,
				attachments: (item.attachments as AttachmentMeta[]) ?? [],
			});
		}

		lastKey = result.LastEvaluatedKey;
	} while (lastKey);

	return items;
}

export async function batchDeleteEmails(
	keys: Array<{ PK: string; SK: string }>,
): Promise<void> {
	for (let i = 0; i < keys.length; i += BATCH_DELETE_SIZE) {
		const batch = keys.slice(i, i + BATCH_DELETE_SIZE);
		await client.send(
			new BatchWriteCommand({
				RequestItems: {
					[Resource.EmailsTable.name]: batch.map((key) => ({
						DeleteRequest: { Key: { PK: key.PK, SK: key.SK } },
					})),
				},
			}),
		);
	}
}
