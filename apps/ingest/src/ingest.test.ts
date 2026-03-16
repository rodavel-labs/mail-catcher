import { describe, expect, mock, test } from "bun:test";
import type { EmailItem } from "@ses-inbox/core";
import type { S3Event, S3EventRecord } from "aws-lambda";
import { createIngestHandler, type IngestDeps } from "./ingest";

function makeS3Event(...records: { bucket: string; key: string }[]): S3Event {
	return {
		Records: records.map(
			(r) =>
				({
					s3: {
						bucket: { name: r.bucket },
						object: { key: r.key },
					},
				}) as unknown as S3EventRecord,
		),
	};
}

function makeRawEmail(
	opts: {
		from?: string;
		to?: string;
		subject?: string;
		messageId?: string;
		body?: string;
	} = {},
) {
	return [
		`From: ${opts.from ?? "sender@example.com"}`,
		`To: ${opts.to ?? "test@receive.example.com"}`,
		`Subject: ${opts.subject ?? "Test Subject"}`,
		`Message-ID: ${opts.messageId ?? "<msg-001@example.com>"}`,
		"MIME-Version: 1.0",
		"Content-Type: text/html; charset=utf-8",
		"",
		opts.body ?? "<p>Hello</p>",
	].join("\r\n");
}

function makeMultipartEmail(
	opts: {
		from?: string;
		to?: string;
		subject?: string;
		messageId?: string;
		text?: string;
		html?: string;
	} = {},
) {
	const boundary = "----=_Part_001";
	return [
		`From: ${opts.from ?? "sender@example.com"}`,
		`To: ${opts.to ?? "test@receive.example.com"}`,
		`Subject: ${opts.subject ?? "Test Subject"}`,
		`Message-ID: ${opts.messageId ?? "<msg-001@example.com>"}`,
		"MIME-Version: 1.0",
		`Content-Type: multipart/alternative; boundary="${boundary}"`,
		"",
		`--${boundary}`,
		"Content-Type: text/plain; charset=utf-8",
		"",
		opts.text ?? "Hello plain",
		`--${boundary}`,
		"Content-Type: text/html; charset=utf-8",
		"",
		opts.html ?? "<p>Hello html</p>",
		`--${boundary}--`,
	].join("\r\n");
}

function makeEmailWithAttachment(
	opts: {
		to?: string;
		messageId?: string;
		filename?: string;
		contentType?: string;
		contentDisposition?: string;
		cid?: string;
	} = {},
) {
	const boundary = "----=_Part_002";
	const disposition = opts.contentDisposition ?? "attachment";
	const cidHeader = opts.cid ? `Content-ID: <${opts.cid}>\r\n` : "";
	const content = Buffer.from("file-content").toString("base64");

	return [
		`From: sender@example.com`,
		`To: ${opts.to ?? "test@receive.example.com"}`,
		"Subject: With Attachment",
		`Message-ID: ${opts.messageId ?? "<msg-att@example.com>"}`,
		"MIME-Version: 1.0",
		`Content-Type: multipart/mixed; boundary="${boundary}"`,
		"",
		`--${boundary}`,
		"Content-Type: text/plain; charset=utf-8",
		"",
		"Hello",
		`--${boundary}`,
		`Content-Type: ${opts.contentType ?? "application/pdf"}`,
		`Content-Disposition: ${disposition}; filename="${opts.filename ?? "doc.pdf"}"`,
		"Content-Transfer-Encoding: base64",
		`${cidHeader}`,
		content,
		`--${boundary}--`,
	].join("\r\n");
}

function mockDeps(overrides: Partial<IngestDeps> = {}): IngestDeps {
	return {
		getObject: mock(() => Promise.resolve(makeRawEmail())),
		putObject: mock(() => Promise.resolve()),
		putEmail: mock((_item: EmailItem) => Promise.resolve()),
		domain: "receive.example.com",
		bucket: "test-bucket",
		...overrides,
	};
}

describe("createIngestHandler", () => {
	test("parses email and writes to DynamoDB", async () => {
		const putEmail = mock((_item: EmailItem) => Promise.resolve());
		const deps = mockDeps({ putEmail });
		const handler = createIngestHandler(deps);

		await handler(makeS3Event({ bucket: "my-bucket", key: "incoming/abc" }));

		expect(putEmail).toHaveBeenCalledTimes(1);
		const item = putEmail.mock.calls[0][0];
		expect(item.inbox).toBe("test");
		expect(item.sender).toBe("sender@example.com");
		expect(item.recipient).toBe("test@receive.example.com");
		expect(item.subject).toBe("Test Subject");
		expect(item.s3Key).toBe("incoming/abc");
		expect(item.receivedAt).toBeNumber();
	});

	test("decodes URL-encoded S3 keys", async () => {
		const getObject = mock(() => Promise.resolve(makeRawEmail()));
		const deps = mockDeps({ getObject });
		const handler = createIngestHandler(deps);

		await handler(
			makeS3Event({ bucket: "b", key: "incoming/hello+world%20test" }),
		);

		expect(getObject).toHaveBeenCalledWith("b", "incoming/hello world test");
	});

	test("skips emails with non-matching domain", async () => {
		const raw = makeRawEmail({ to: "user@other-domain.com" });
		const putEmail = mock((_item: EmailItem) => Promise.resolve());
		const deps = mockDeps({
			getObject: () => Promise.resolve(raw),
			putEmail,
		});
		const handler = createIngestHandler(deps);

		await handler(makeS3Event({ bucket: "b", key: "incoming/abc" }));

		expect(putEmail).not.toHaveBeenCalled();
	});

	test("uses S3 key as messageId fallback when header is missing", async () => {
		const raw = [
			"From: sender@example.com",
			"To: test@receive.example.com",
			"Subject: No ID",
			"MIME-Version: 1.0",
			"Content-Type: text/html; charset=utf-8",
			"",
			"<p>Hello</p>",
		].join("\r\n");

		const putEmail = mock((_item: EmailItem) => Promise.resolve());
		const deps = mockDeps({
			getObject: () => Promise.resolve(raw),
			putEmail,
		});
		const handler = createIngestHandler(deps);

		await handler(makeS3Event({ bucket: "b", key: "incoming/fallback-key" }));

		const item = putEmail.mock.calls[0][0];
		expect(item.messageId).toBe("incoming/fallback-key");
	});

	test("processes multiple records in a single event", async () => {
		const putEmail = mock((_item: EmailItem) => Promise.resolve());
		const deps = mockDeps({ putEmail });
		const handler = createIngestHandler(deps);

		await handler(
			makeS3Event(
				{ bucket: "b", key: "incoming/a" },
				{ bucket: "b", key: "incoming/b" },
				{ bucket: "b", key: "incoming/c" },
			),
		);

		expect(putEmail).toHaveBeenCalledTimes(3);
	});

	test("extracts inbox as lowercase", async () => {
		const raw = makeRawEmail({ to: "TestInbox@receive.example.com" });
		const putEmail = mock((_item: EmailItem) => Promise.resolve());
		const deps = mockDeps({
			getObject: () => Promise.resolve(raw),
			putEmail,
		});
		const handler = createIngestHandler(deps);

		await handler(makeS3Event({ bucket: "b", key: "incoming/abc" }));

		const item = putEmail.mock.calls[0][0];
		expect(item.inbox).toBe("testinbox");
	});

	test("stores plaintext in body and HTML in htmlBody", async () => {
		const raw = makeMultipartEmail({
			text: "Plain text content",
			html: "<p>HTML content</p>",
		});
		const putEmail = mock((_item: EmailItem) => Promise.resolve());
		const deps = mockDeps({
			getObject: () => Promise.resolve(raw),
			putEmail,
		});
		const handler = createIngestHandler(deps);

		await handler(makeS3Event({ bucket: "b", key: "incoming/abc" }));

		const item = putEmail.mock.calls[0][0];
		expect(item.body).toBe("Plain text content");
		expect(item.htmlBody).toBe("<p>HTML content</p>");
	});

	test("uploads attachments to S3 and stores metadata", async () => {
		const raw = makeEmailWithAttachment({
			messageId: "<msg-att@example.com>",
			filename: "doc.pdf",
			contentType: "application/pdf",
		});
		const putObject = mock(
			(_b: string, _k: string, _body: Buffer, _ct: string) => Promise.resolve(),
		);
		const putEmail = mock((_item: EmailItem) => Promise.resolve());
		const deps = mockDeps({
			getObject: () => Promise.resolve(raw),
			putObject,
			putEmail,
		});
		const handler = createIngestHandler(deps);

		await handler(makeS3Event({ bucket: "b", key: "incoming/abc" }));

		expect(putObject).toHaveBeenCalledTimes(1);
		const [bucket, key, , contentType] = putObject.mock.calls[0];
		expect(bucket).toBe("test-bucket");
		expect(key).toBe("attachments/msg-att@example.com/0-doc.pdf");
		expect(contentType).toBe("application/pdf");

		const item = putEmail.mock.calls[0][0];
		expect(item.attachments).toHaveLength(1);
		expect(item.attachments[0].filename).toBe("0-doc.pdf");
		expect(item.attachments[0].contentType).toBe("application/pdf");
		expect(item.attachments[0].s3Key).toBe(
			"attachments/msg-att@example.com/0-doc.pdf",
		);
		expect(item.attachments[0].size).toBeGreaterThan(0);
		expect(item.attachments[0].contentId).toBeUndefined();
	});

	test("detects inline images with Content-ID", async () => {
		const raw = makeEmailWithAttachment({
			messageId: "<msg-inline@example.com>",
			filename: "logo.png",
			contentType: "image/png",
			contentDisposition: "inline",
			cid: "logo-cid@example.com",
		});
		const putEmail = mock((_item: EmailItem) => Promise.resolve());
		const deps = mockDeps({
			getObject: () => Promise.resolve(raw),
			putEmail,
		});
		const handler = createIngestHandler(deps);

		await handler(makeS3Event({ bucket: "b", key: "incoming/abc" }));

		const item = putEmail.mock.calls[0][0];
		expect(item.attachments).toHaveLength(1);
		expect(item.attachments[0].contentId).toBe("logo-cid@example.com");
	});

	test("sanitizes path separators in attachment filenames", async () => {
		const raw = makeEmailWithAttachment({
			filename: "../../evil.txt",
			contentType: "text/plain",
		});
		const putObject = mock(
			(_b: string, _k: string, _body: Buffer, _ct: string) => Promise.resolve(),
		);
		const putEmail = mock((_item: EmailItem) => Promise.resolve());
		const deps = mockDeps({
			getObject: () => Promise.resolve(raw),
			putObject,
			putEmail,
		});
		const handler = createIngestHandler(deps);

		await handler(makeS3Event({ bucket: "b", key: "incoming/abc" }));

		const [, key] = putObject.mock.calls[0];
		expect(key).not.toContain("/evil.txt");
		expect(key).not.toContain("\\");
		expect(key).toContain("0-.._.._evil.txt");
	});

	test("skips attachments exceeding maxAttachments", async () => {
		const raw = makeEmailWithAttachment();
		const putObject = mock(() => Promise.resolve());
		const putEmail = mock((_item: EmailItem) => Promise.resolve());
		const deps = mockDeps({
			getObject: () => Promise.resolve(raw),
			putObject,
			putEmail,
			maxAttachments: 0,
		});
		const handler = createIngestHandler(deps);

		await handler(makeS3Event({ bucket: "b", key: "incoming/abc" }));

		expect(putObject).not.toHaveBeenCalled();
		const item = putEmail.mock.calls[0][0];
		expect(item.attachments).toEqual([]);
	});

	test("skips attachments exceeding maxAttachmentSize", async () => {
		const raw = makeEmailWithAttachment();
		const putObject = mock(() => Promise.resolve());
		const putEmail = mock((_item: EmailItem) => Promise.resolve());
		const deps = mockDeps({
			getObject: () => Promise.resolve(raw),
			putObject,
			putEmail,
			maxAttachmentSize: 1,
		});
		const handler = createIngestHandler(deps);

		await handler(makeS3Event({ bucket: "b", key: "incoming/abc" }));

		expect(putObject).not.toHaveBeenCalled();
		const item = putEmail.mock.calls[0][0];
		expect(item.attachments).toEqual([]);
	});

	test("emails without attachments have empty attachments array", async () => {
		const putEmail = mock((_item: EmailItem) => Promise.resolve());
		const deps = mockDeps({ putEmail });
		const handler = createIngestHandler(deps);

		await handler(makeS3Event({ bucket: "b", key: "incoming/abc" }));

		const item = putEmail.mock.calls[0][0];
		expect(item.attachments).toEqual([]);
	});
});
