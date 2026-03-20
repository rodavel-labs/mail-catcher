import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
	GetObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
	type AttachmentMeta,
	createEmailRepository,
	type EmailItem,
} from "@rodavel/mail-catcher-core";
import type { S3Event } from "aws-lambda";
import { type AddressObject, simpleParser } from "mailparser";
import { Resource } from "sst";
import { extractInbox } from "./email-parser";
import { env } from "./env";

export interface IngestDeps {
	getObject: (bucket: string, key: string) => Promise<string>;
	putObject: (
		bucket: string,
		key: string,
		body: Buffer,
		contentType: string,
	) => Promise<void>;
	putEmail: (item: EmailItem) => Promise<void>;
	domain: string;
	bucket: string;
	maxAttachmentSize?: number;
	maxAttachments?: number;
}

function getAddressText(
	addr: AddressObject | AddressObject[] | undefined,
): string {
	if (!addr) return "";
	if (Array.isArray(addr)) return addr[0]?.text ?? "";
	return addr.text ?? "";
}

export function createIngestHandler(deps: IngestDeps) {
	return async (event: S3Event) => {
		for (const record of event.Records) {
			const bucket = record.s3.bucket.name;
			const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));

			const raw = await deps.getObject(bucket, key);
			const parsed = await simpleParser(raw, { keepCidLinks: true });

			const to = getAddressText(parsed.to);
			const inbox = extractInbox(to, deps.domain);
			if (!inbox) {
				console.warn(`No matching inbox for recipient: ${to}`);
				continue;
			}

			const messageId = parsed.messageId || key;
			const safeMessageId = messageId.replace(/[<>]/g, "");
			const attachments: AttachmentMeta[] = [];

			for (const att of parsed.attachments) {
				const idx = attachments.length;

				if (deps.maxAttachments != null && idx >= deps.maxAttachments) {
					console.warn(
						`Skipping attachment ${idx}: exceeds maxAttachments (${deps.maxAttachments})`,
					);
					continue;
				}
				if (
					deps.maxAttachmentSize != null &&
					att.size > deps.maxAttachmentSize
				) {
					console.warn(
						`Skipping attachment "${att.filename}": size ${att.size} exceeds maxAttachmentSize (${deps.maxAttachmentSize})`,
					);
					continue;
				}

				const rawName = att.filename || `attachment-${idx}`;
				const safeName = rawName.replace(/[/\\]/g, "_");
				const filename = `${idx}-${safeName}`;
				const s3Key = `attachments/${safeMessageId}/${filename}`;

				await deps.putObject(deps.bucket, s3Key, att.content, att.contentType);

				const meta: AttachmentMeta = {
					filename,
					contentType: att.contentType,
					size: att.size,
					s3Key,
				};

				if (att.contentDisposition === "inline" && att.cid) {
					meta.contentId = att.cid;
				}

				attachments.push(meta);
			}

			await deps.putEmail({
				inbox,
				messageId: safeMessageId,
				sender: getAddressText(parsed.from),
				recipient: to,
				subject: parsed.subject ?? "",
				body: parsed.text ?? "",
				htmlBody: parsed.html || "",
				attachments,
				s3Key: key,
				receivedAt: Date.now(),
			});
		}
	};
}

const s3 = new S3Client();
const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient());

let _handler: ReturnType<typeof createIngestHandler>;

export const handler: typeof _handler = (event) => {
	_handler ??= createIngestHandler({
		getObject: async (bucket, key) => {
			const obj = await s3.send(
				new GetObjectCommand({ Bucket: bucket, Key: key }),
			);
			return (await obj.Body?.transformToString()) ?? "";
		},
		putObject: async (bucket, key, body, contentType) => {
			await s3.send(
				new PutObjectCommand({
					Bucket: bucket,
					Key: key,
					Body: body,
					ContentType: contentType,
				}),
			);
		},
		putEmail: createEmailRepository(ddbClient, Resource.EmailsTable.name)
			.putEmail,
		domain: env.SES_DOMAIN,
		bucket: Resource.EmailBucket.name,
		maxAttachmentSize: env.MAX_ATTACHMENT_SIZE,
		maxAttachments: env.MAX_ATTACHMENTS,
	});
	return _handler(event);
};
