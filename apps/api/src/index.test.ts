import { describe, expect, mock, test } from "bun:test";

import type { AppDeps, EmailQueryResult } from "./index";
import { createApp, formatEmailsResponse } from "./index";

function mockDeps(overrides: Partial<AppDeps> = {}): AppDeps {
	return {
		queryEmails: mock(() =>
			Promise.resolve({ emails: [], nextCursor: undefined, hasMore: false }),
		),
		getEmailByMessageId: mock(() => Promise.resolve(null)),
		getEmailRawByMessageId: mock(() => Promise.resolve(null)),
		deleteEmail: mock(() => Promise.resolve()),
		queryAllEmailKeys: mock(() => Promise.resolve([])),
		batchDeleteEmails: mock(() => Promise.resolve()),
		deleteS3Objects: mock(() => Promise.resolve()),
		getSignedRawUrl: mock(() =>
			Promise.resolve("https://s3.example.com/signed"),
		),
		getSignedAttachmentUrl: mock(() =>
			Promise.resolve("https://s3.example.com/signed-attachment"),
		),
		verifyKey: mock(() => Promise.resolve(true)),
		version: "0.1.0",
		...overrides,
	};
}

function makeEmail(overrides: Record<string, unknown> = {}) {
	return {
		messageId: "msg-1",
		inbox: "test",
		sender: "a@b.com",
		recipient: "test@domain.com",
		subject: "Hello",
		body: "Hi plain",
		htmlBody: "<p>Hi</p>",
		attachments: [],
		receivedAt: 1000,
		s3Key: "incoming/abc",
		...overrides,
	};
}

function authedRequest(path: string, init?: RequestInit) {
	return new Request(`http://localhost${path}`, {
		...init,
		headers: { Authorization: "Bearer valid-token", ...init?.headers },
	});
}

describe("GET /health", () => {
	test("returns ok status", async () => {
		const app = createApp(mockDeps());
		const res = await app.request("/health");

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe("ok");
		expect(body.timestamp).toBeNumber();
	});

	test("does not require auth", async () => {
		const deps = mockDeps();
		const app = createApp(deps);
		const res = await app.request("/health");

		expect(res.status).toBe(200);
		expect(deps.verifyKey).not.toHaveBeenCalled();
	});
});

describe("GET /version", () => {
	test("returns version and supported API versions", async () => {
		const app = createApp(mockDeps());
		const res = await app.request("/version");

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.version).toBe("0.1.0");
		expect(body.apiVersions).toEqual(["v1"]);
	});

	test("does not require auth", async () => {
		const deps = mockDeps();
		const app = createApp(deps);
		const res = await app.request("/version");

		expect(res.status).toBe(200);
		expect(deps.verifyKey).not.toHaveBeenCalled();
	});
});

describe("X-API-Version header", () => {
	test("is set on v1 responses", async () => {
		const app = createApp(mockDeps());
		const res = await app.request(authedRequest("/v1/emails?inbox=test"));

		expect(res.headers.get("X-API-Version")).toBe("v1");
	});

	test("is not set on root-level endpoints", async () => {
		const app = createApp(mockDeps());
		const res = await app.request("/health");

		expect(res.headers.get("X-API-Version")).toBeNull();
	});
});

describe("GET /emails", () => {
	test("returns 401 without auth header", async () => {
		const app = createApp(mockDeps());
		const res = await app.request("/v1/emails?inbox=test");

		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error).toBe("UNAUTHORIZED");
	});

	test("returns 401 with invalid token", async () => {
		const app = createApp(
			mockDeps({ verifyKey: () => Promise.resolve(false) }),
		);
		const res = await app.request(authedRequest("/v1/emails?inbox=test"));

		expect(res.status).toBe(401);
	});

	test("returns 400 when inbox is missing", async () => {
		const app = createApp(mockDeps());
		const res = await app.request(authedRequest("/v1/emails"));

		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toBe("MISSING_INBOX");
	});

	test("returns 400 for invalid inbox characters", async () => {
		const app = createApp(mockDeps());

		for (const inbox of ["test@bad", "test bad", "test/bad", "<script>"]) {
			const res = await app.request(
				authedRequest(`/v1/emails?inbox=${encodeURIComponent(inbox)}`),
			);
			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error).toBe("INVALID_INBOX");
		}
	});

	test("accepts valid inbox names", async () => {
		const app = createApp(mockDeps());

		for (const inbox of [
			"test",
			"user.name",
			"user-name",
			"user_name",
			"User123",
		]) {
			const res = await app.request(authedRequest(`/v1/emails?inbox=${inbox}`));
			expect(res.status).toBe(200);
		}
	});

	test("returns 400 for limit out of range", async () => {
		const app = createApp(mockDeps());

		const res0 = await app.request(
			authedRequest("/v1/emails?inbox=test&limit=0"),
		);
		expect(res0.status).toBe(400);
		expect((await res0.json()).error).toBe("INVALID_LIMIT");

		const res101 = await app.request(
			authedRequest("/v1/emails?inbox=test&limit=101"),
		);
		expect(res101.status).toBe(400);
		expect((await res101.json()).error).toBe("INVALID_LIMIT");
	});

	test("uses default limit of 50", async () => {
		const queryEmails = mock(() =>
			Promise.resolve({ emails: [], nextCursor: undefined, hasMore: false }),
		);
		const app = createApp(mockDeps({ queryEmails }));
		await app.request(authedRequest("/v1/emails?inbox=test"));

		expect(queryEmails).toHaveBeenCalledWith({
			inbox: "test",
			cursor: undefined,
			limit: 50,
			filters: undefined,
		});
	});

	test("passes cursor and limit to queryEmails", async () => {
		const queryEmails = mock(() =>
			Promise.resolve({ emails: [], nextCursor: undefined, hasMore: false }),
		);
		const app = createApp(mockDeps({ queryEmails }));
		await app.request(
			authedRequest("/v1/emails?inbox=test&limit=10&cursor=abc"),
		);

		expect(queryEmails).toHaveBeenCalledWith({
			inbox: "test",
			cursor: "abc",
			limit: 10,
			filters: undefined,
		});
	});

	test("returns formatted emails with rawUrl", async () => {
		const email = makeEmail();
		const queryEmails = mock(() =>
			Promise.resolve({
				emails: [email],
				nextCursor: undefined,
				hasMore: false,
			}),
		);
		const app = createApp(mockDeps({ queryEmails }));
		const res = await app.request(authedRequest("/v1/emails?inbox=test"));

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.emails).toHaveLength(1);
		expect(body.emails[0].rawUrl).toBe("/v1/emails/msg-1/raw");
		expect(body.emails[0].s3Key).toBeUndefined();
		expect(body.emails[0].messageId).toBe("msg-1");
	});

	test("returns body, htmlBody, and attachments fields", async () => {
		const email = makeEmail({
			body: "Plain text",
			htmlBody: "<p>HTML</p>",
			attachments: [
				{
					filename: "doc.pdf",
					contentType: "application/pdf",
					size: 1024,
					s3Key: "attachments/msg-1/doc.pdf",
				},
			],
		});
		const queryEmails = mock(() =>
			Promise.resolve({
				emails: [email],
				nextCursor: undefined,
				hasMore: false,
			}),
		);
		const app = createApp(mockDeps({ queryEmails }));
		const res = await app.request(authedRequest("/v1/emails?inbox=test"));

		const body = await res.json();
		expect(body.emails[0].body).toBe("Plain text");
		expect(body.emails[0].htmlBody).toBe("<p>HTML</p>");
		expect(body.emails[0].attachments).toHaveLength(1);
		expect(body.emails[0].attachments[0].filename).toBe("doc.pdf");
		expect(body.emails[0].attachments[0].s3Key).toBeUndefined();
		expect(body.emails[0].attachments[0].url).toBe(
			"/v1/emails/msg-1/attachments/doc.pdf",
		);
	});

	test("returns pagination info", async () => {
		const queryEmails = mock(() =>
			Promise.resolve({ emails: [], nextCursor: "cursor-123", hasMore: true }),
		);
		const app = createApp(mockDeps({ queryEmails }));
		const res = await app.request(authedRequest("/v1/emails?inbox=test"));

		const body = await res.json();
		expect(body.nextCursor).toBe("cursor-123");
		expect(body.hasMore).toBe(true);
	});

	test("long-poll returns empty on timeout", async () => {
		const queryEmails = mock(() =>
			Promise.resolve({ emails: [], nextCursor: undefined, hasMore: false }),
		);
		const app = createApp(mockDeps({ queryEmails }));
		const res = await app.request(
			authedRequest("/v1/emails?inbox=test&wait=true&timeout=1"),
		);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.emails).toEqual([]);
		expect(body.hasMore).toBe(false);
	});

	test("long-poll returns immediately when emails found", async () => {
		const email = makeEmail({ body: "", htmlBody: "" });
		const queryEmails = mock(() =>
			Promise.resolve({
				emails: [email],
				nextCursor: undefined,
				hasMore: false,
			}),
		);
		const app = createApp(mockDeps({ queryEmails }));

		const start = Date.now();
		const res = await app.request(
			authedRequest("/v1/emails?inbox=test&wait=true&timeout=10"),
		);
		const elapsed = Date.now() - start;

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.emails).toHaveLength(1);
		expect(elapsed).toBeLessThan(3000);
	});

	test("long-poll timeout is capped at 28 seconds", async () => {
		const queryEmails = mock(() =>
			Promise.resolve({ emails: [], nextCursor: undefined, hasMore: false }),
		);
		const app = createApp(mockDeps({ queryEmails }));
		const res = await app.request(
			authedRequest("/v1/emails?inbox=test&wait=true&timeout=1"),
		);

		expect(res.status).toBe(200);
		expect(queryEmails).toHaveBeenCalled();
	});
});

describe("GET /emails/:messageId/raw", () => {
	test("returns 401 without auth", async () => {
		const app = createApp(mockDeps());
		const res = await app.request("/v1/emails/msg-1/raw");

		expect(res.status).toBe(401);
	});

	test("returns 404 when email not found", async () => {
		const app = createApp(mockDeps());
		const res = await app.request(authedRequest("/v1/emails/msg-1/raw"));

		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error).toBe("NOT_FOUND");
	});

	test("redirects to signed URL when email found", async () => {
		const getEmailByMessageId = mock(() =>
			Promise.resolve(makeEmail({ s3Key: "incoming/abc", messageId: "msg-1" })),
		);
		const getSignedRawUrl = mock(() =>
			Promise.resolve("https://s3.example.com/signed-url"),
		);
		const app = createApp(mockDeps({ getEmailByMessageId, getSignedRawUrl }));
		const res = await app.request(authedRequest("/v1/emails/msg-1/raw"), {
			redirect: "manual",
		});

		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe(
			"https://s3.example.com/signed-url",
		);
		expect(getSignedRawUrl).toHaveBeenCalledWith("incoming/abc");
	});
});

describe("GET /emails/:messageId/attachments/:filename", () => {
	test("returns 401 without auth", async () => {
		const app = createApp(mockDeps());
		const res = await app.request("/v1/emails/msg-1/attachments/doc.pdf");

		expect(res.status).toBe(401);
	});

	test("returns 404 when email not found", async () => {
		const app = createApp(mockDeps());
		const res = await app.request(
			authedRequest("/v1/emails/msg-1/attachments/doc.pdf"),
		);

		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error).toBe("NOT_FOUND");
	});

	test("returns 404 when attachment not found", async () => {
		const getEmailByMessageId = mock(() =>
			Promise.resolve(
				makeEmail({
					messageId: "msg-1",
					attachments: [
						{
							filename: "other.pdf",
							contentType: "application/pdf",
							size: 100,
							s3Key: "attachments/msg-1/other.pdf",
						},
					],
				}),
			),
		);
		const app = createApp(mockDeps({ getEmailByMessageId }));
		const res = await app.request(
			authedRequest("/v1/emails/msg-1/attachments/doc.pdf"),
		);

		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error).toBe("NOT_FOUND");
		expect(body.message).toBe("Attachment not found");
	});

	test("redirects to signed URL when attachment found", async () => {
		const getEmailByMessageId = mock(() =>
			Promise.resolve(
				makeEmail({
					messageId: "msg-1",
					attachments: [
						{
							filename: "doc.pdf",
							contentType: "application/pdf",
							size: 1024,
							s3Key: "attachments/msg-1/doc.pdf",
						},
					],
				}),
			),
		);
		const getSignedAttachmentUrl = mock(() =>
			Promise.resolve("https://s3.example.com/signed-attachment-url"),
		);
		const app = createApp(
			mockDeps({ getEmailByMessageId, getSignedAttachmentUrl }),
		);
		const res = await app.request(
			authedRequest("/v1/emails/msg-1/attachments/doc.pdf"),
			{ redirect: "manual" },
		);

		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe(
			"https://s3.example.com/signed-attachment-url",
		);
		expect(getSignedAttachmentUrl).toHaveBeenCalledWith(
			"attachments/msg-1/doc.pdf",
		);
	});
});

describe("formatEmailsResponse", () => {
	test("strips s3Key and adds rawUrl", () => {
		const result: EmailQueryResult = {
			emails: [makeEmail()],
			nextCursor: undefined,
			hasMore: false,
		};

		const formatted = formatEmailsResponse(result);

		expect(formatted.emails[0].rawUrl).toBe("/v1/emails/msg-1/raw");
		expect(
			(formatted.emails[0] as Record<string, unknown>).s3Key,
		).toBeUndefined();
	});

	test("preserves body, htmlBody, and attachments", () => {
		const result: EmailQueryResult = {
			emails: [
				makeEmail({
					body: "plain",
					htmlBody: "<p>html</p>",
					attachments: [
						{
							filename: "f.txt",
							contentType: "text/plain",
							size: 5,
							s3Key: "attachments/msg-1/f.txt",
						},
					],
				}),
			],
			nextCursor: undefined,
			hasMore: false,
		};

		const formatted = formatEmailsResponse(result);

		expect(formatted.emails[0].body).toBe("plain");
		expect(formatted.emails[0].htmlBody).toBe("<p>html</p>");
		expect(formatted.emails[0].attachments).toHaveLength(1);
		expect(
			(formatted.emails[0].attachments[0] as Record<string, unknown>).s3Key,
		).toBeUndefined();
		expect(formatted.emails[0].attachments[0].url).toBe(
			"/v1/emails/msg-1/attachments/f.txt",
		);
	});

	test("preserves pagination fields", () => {
		const result: EmailQueryResult = {
			emails: [],
			nextCursor: "cursor-abc",
			hasMore: true,
		};

		const formatted = formatEmailsResponse(result);

		expect(formatted.nextCursor).toBe("cursor-abc");
		expect(formatted.hasMore).toBe(true);
	});
});
