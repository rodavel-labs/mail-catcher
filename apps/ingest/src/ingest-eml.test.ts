import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { EmailItem } from "@rodavel/mail-catcher-core";
import type { S3Event, S3EventRecord } from "aws-lambda";
import { createIngestHandler, type IngestDeps } from "./ingest";

const FIXTURES = join(import.meta.dir, "fixtures");

function loadFixture(name: string): string {
	return readFileSync(join(FIXTURES, name), "utf-8");
}

function makeS3Event(bucket: string, key: string): S3Event {
	return {
		Records: [
			{
				s3: {
					bucket: { name: bucket },
					object: { key },
				},
			} as unknown as S3EventRecord,
		],
	};
}

function mockDeps(
	raw: string,
	overrides: Partial<Omit<IngestDeps, "putEmail" | "putObject">> = {},
) {
	const putEmail = mock((_item: EmailItem) => Promise.resolve());
	const putObject = mock((_b: string, _k: string, _body: Buffer, _ct: string) =>
		Promise.resolve(),
	);
	return {
		getObject: () => Promise.resolve(raw),
		domain: "receive.example.com",
		bucket: "test-bucket",
		...overrides,
		putObject,
		putEmail,
	};
}

describe("ingest with .eml fixtures", () => {
	test("plain-text.eml: extracts text body with no HTML", async () => {
		const raw = loadFixture("plain-text.eml");
		const deps = mockDeps(raw);
		const handler = createIngestHandler(deps);
		const before = Date.now();

		await handler(makeS3Event("b", "incoming/plain"));

		expect(deps.putEmail).toHaveBeenCalledTimes(1);
		const item = (deps.putEmail as ReturnType<typeof mock>).mock
			.calls[0][0] as EmailItem;
		expect(item.inbox).toBe("inbox");
		expect(item.sender).toBe("alice@example.com");
		expect(item.subject).toBe("Plain text email");
		expect(item.messageId).toBe("plain-001@example.com");
		expect(item.body).toContain("simple plain text email body");
		expect(item.htmlBody).toBe("");
		expect(item.attachments).toEqual([]);
		expect(item.s3Key).toBe("incoming/plain");
		expect(item.receivedAt).toBeGreaterThanOrEqual(before);
		expect(item.receivedAt).toBeLessThanOrEqual(Date.now());
	});

	test("html-only.eml: extracts HTML body", async () => {
		const raw = loadFixture("html-only.eml");
		const deps = mockDeps(raw);
		const handler = createIngestHandler(deps);

		await handler(makeS3Event("b", "incoming/html"));

		expect(deps.putEmail).toHaveBeenCalledTimes(1);
		const item = (deps.putEmail as ReturnType<typeof mock>).mock
			.calls[0][0] as EmailItem;
		expect(item.inbox).toBe("inbox");
		expect(item.sender).toBe("bob@example.com");
		expect(item.subject).toBe("HTML only email");
		expect(item.htmlBody).toContain("<strong>HTML only</strong>");
	});

	test("multipart.eml: extracts both text and HTML parts", async () => {
		const raw = loadFixture("multipart.eml");
		const deps = mockDeps(raw);
		const handler = createIngestHandler(deps);

		await handler(makeS3Event("b", "incoming/multi"));

		expect(deps.putEmail).toHaveBeenCalledTimes(1);
		const item = (deps.putEmail as ReturnType<typeof mock>).mock
			.calls[0][0] as EmailItem;
		expect(item.inbox).toBe("inbox");
		expect(item.sender).toBe("charlie@example.com");
		expect(item.subject).toBe("Multipart email");
		expect(item.body).toContain("plain text part");
		expect(item.htmlBody).toContain("<em>HTML</em>");
		expect(item.attachments).toEqual([]);
	});

	test("with-attachment.eml: uploads attachment and stores metadata", async () => {
		const raw = loadFixture("with-attachment.eml");
		const deps = mockDeps(raw);
		const handler = createIngestHandler(deps);

		await handler(makeS3Event("b", "incoming/attach"));

		expect(deps.putEmail).toHaveBeenCalledTimes(1);
		const item = (deps.putEmail as ReturnType<typeof mock>).mock
			.calls[0][0] as EmailItem;
		expect(item.inbox).toBe("inbox");
		expect(item.sender).toBe("dave@example.com");
		expect(item.subject).toBe("Email with attachment");
		expect(item.body).toContain("See attached document");
		expect(item.s3Key).toBe("incoming/attach");
		expect(item.attachments).toHaveLength(1);
		expect(item.attachments[0].filename).toBe("0-report.pdf");
		expect(item.attachments[0].contentType).toBe("application/pdf");
		expect(item.attachments[0].size).toBeGreaterThan(0);
		expect(item.attachments[0].s3Key).toContain("attachments/");

		expect(deps.putObject).toHaveBeenCalledTimes(1);
		const [bucket, key] = (deps.putObject as ReturnType<typeof mock>).mock
			.calls[0];
		expect(bucket).toBe("test-bucket");
		expect(key).toContain("attachments/");
		expect(key).toContain("0-report.pdf");
	});

	test("inline-image.eml: detects inline image with Content-ID", async () => {
		const raw = loadFixture("inline-image.eml");
		const deps = mockDeps(raw);
		const handler = createIngestHandler(deps);

		await handler(makeS3Event("b", "incoming/inline"));

		expect(deps.putEmail).toHaveBeenCalledTimes(1);
		const item = (deps.putEmail as ReturnType<typeof mock>).mock
			.calls[0][0] as EmailItem;
		expect(item.inbox).toBe("inbox");
		expect(item.sender).toBe("eve@example.com");
		expect(item.subject).toBe("Email with inline image");
		expect(item.htmlBody).toContain("cid:logo123@example.com");
		expect(item.attachments).toHaveLength(1);
		expect(item.attachments[0].filename).toBe("0-logo.png");
		expect(item.attachments[0].contentType).toBe("image/png");
		expect(item.attachments[0].contentId).toBe("logo123@example.com");
	});

	test("missing-headers.eml: handles email with minimal headers", async () => {
		const raw = loadFixture("missing-headers.eml");
		const deps = mockDeps(raw);
		const handler = createIngestHandler(deps);

		await handler(makeS3Event("b", "incoming/missing-key"));

		expect(deps.putEmail).toHaveBeenCalledTimes(1);
		const item = (deps.putEmail as ReturnType<typeof mock>).mock
			.calls[0][0] as EmailItem;
		expect(item.inbox).toBe("inbox");
		expect(item.sender).toBe("");
		expect(item.subject).toBe("");
		expect(item.messageId).toBe("incoming/missing-key");
		expect(item.body).toContain("no From, Subject, or Message-ID");
		expect(item.htmlBody).toBe("");
		expect(item.attachments).toEqual([]);
		expect(item.s3Key).toBe("incoming/missing-key");
	});

	test("malformed-mime.eml: handles broken MIME boundaries gracefully", async () => {
		const raw = loadFixture("malformed-mime.eml");
		const deps = mockDeps(raw);
		const handler = createIngestHandler(deps);

		await handler(makeS3Event("b", "incoming/malformed"));

		expect(deps.putEmail).toHaveBeenCalledTimes(1);
		const item = (deps.putEmail as ReturnType<typeof mock>).mock
			.calls[0][0] as EmailItem;
		expect(item.inbox).toBe("inbox");
		expect(item.sender).toBe("mallory@example.com");
		expect(item.subject).toBe("Malformed MIME");
		expect(item.body).toContain("Text before broken boundary");
		expect(item.attachments).toHaveLength(0);
		expect(deps.putObject).toHaveBeenCalledTimes(0);
	});

	test("skips record when recipient domain does not match configured domain", async () => {
		const raw = loadFixture("plain-text.eml");
		const deps = mockDeps(raw, { domain: "nomatch.example.org" });
		const handler = createIngestHandler(deps);

		await handler(makeS3Event("b", "incoming/plain"));

		expect(deps.putEmail).toHaveBeenCalledTimes(0);
	});

	test("maxAttachments: skips attachments beyond the configured limit", async () => {
		const raw = loadFixture("with-attachment.eml");
		const deps = mockDeps(raw, { maxAttachments: 0 });
		const handler = createIngestHandler(deps);

		await handler(makeS3Event("b", "incoming/attach"));

		expect(deps.putEmail).toHaveBeenCalledTimes(1);
		const item = deps.putEmail.mock.calls[0][0] as EmailItem;
		expect(item.attachments).toHaveLength(0);
		expect(deps.putObject).toHaveBeenCalledTimes(0);
	});

	test("maxAttachmentSize: skips attachments exceeding the size limit", async () => {
		const raw = loadFixture("with-attachment.eml");
		const deps = mockDeps(raw, { maxAttachmentSize: 1 });
		const handler = createIngestHandler(deps);

		await handler(makeS3Event("b", "incoming/attach"));

		expect(deps.putEmail).toHaveBeenCalledTimes(1);
		const item = deps.putEmail.mock.calls[0][0] as EmailItem;
		expect(item.attachments).toHaveLength(0);
		expect(deps.putObject).toHaveBeenCalledTimes(0);
	});
});
