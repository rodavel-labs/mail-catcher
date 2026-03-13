import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import { Resource } from "sst";

import type { AttachmentMeta } from "./lib/dynamo";
import { getEmailByMessageId, queryEmails } from "./lib/dynamo";
import type { VerifyKey } from "./middleware/auth";
import { createApiKeyAuth, hashKey } from "./middleware/auth";

export interface EmailQueryResult {
	emails: {
		messageId: string;
		inbox: string;
		sender: string;
		recipient: string;
		subject: string;
		body: string;
		htmlBody: string;
		attachments: AttachmentMeta[];
		receivedAt: number;
		s3Key: string;
	}[];
	nextCursor: string | undefined;
	hasMore: boolean;
}

export interface AppDeps {
	queryEmails: (opts: {
		inbox: string;
		cursor?: string;
		limit?: number;
	}) => Promise<EmailQueryResult>;
	getEmailByMessageId: (
		messageId: string,
	) => Promise<Record<string, unknown> | null>;
	getSignedRawUrl: (s3Key: string) => Promise<string>;
	getSignedAttachmentUrl: (s3Key: string) => Promise<string>;
	verifyKey: VerifyKey;
}

export function createApp(deps: AppDeps) {
	const app = new Hono();

	const auth = createApiKeyAuth(deps.verifyKey);

	app.get("/health", (c) => c.json({ status: "ok", timestamp: Date.now() }));

	app.use("/emails/*", auth);
	app.use("/emails", auth);

	app.get("/emails", async (c) => {
		const inbox = c.req.query("inbox");
		if (!inbox) {
			return c.json(
				{
					error: "MISSING_INBOX",
					message: "inbox query parameter is required",
				},
				400,
			);
		}

		if (!/^[a-z0-9._-]+$/i.test(inbox)) {
			return c.json(
				{
					error: "INVALID_INBOX",
					message: "Inbox contains invalid characters",
				},
				400,
			);
		}

		const limitStr = c.req.query("limit");
		const limit = limitStr ? Number.parseInt(limitStr, 10) : 50;
		if (limit < 1 || limit > 100) {
			return c.json(
				{ error: "INVALID_LIMIT", message: "Limit must be between 1 and 100" },
				400,
			);
		}

		const wait = c.req.query("wait") === "true";
		const timeout = Math.min(
			Number.parseInt(c.req.query("timeout") ?? "28", 10),
			28,
		);
		const cursor = c.req.query("cursor");

		if (wait) {
			const deadline = Date.now() + timeout * 1000;
			while (Date.now() < deadline) {
				const result = await deps.queryEmails({ inbox, cursor, limit });
				if (result.emails.length > 0) {
					return c.json(formatEmailsResponse(result));
				}
				await sleep(2000);
			}
			return c.json({ emails: [], nextCursor: undefined, hasMore: false });
		}

		const result = await deps.queryEmails({ inbox, cursor, limit });
		return c.json(formatEmailsResponse(result));
	});

	app.get("/emails/:messageId/raw", async (c) => {
		const { messageId } = c.req.param();

		const email = await deps.getEmailByMessageId(messageId);
		if (!email) {
			return c.json({ error: "NOT_FOUND", message: "Email not found" }, 404);
		}

		const url = await deps.getSignedRawUrl(email.s3Key as string);
		return c.redirect(url, 302);
	});

	app.get("/emails/:messageId/attachments/:filename", async (c) => {
		const { messageId, filename } = c.req.param();

		const email = await deps.getEmailByMessageId(messageId);
		if (!email) {
			return c.json({ error: "NOT_FOUND", message: "Email not found" }, 404);
		}

		const attachments = (email.attachments as AttachmentMeta[]) ?? [];
		const attachment = attachments.find((a) => a.filename === filename);
		if (!attachment) {
			return c.json(
				{ error: "NOT_FOUND", message: "Attachment not found" },
				404,
			);
		}

		const url = await deps.getSignedAttachmentUrl(attachment.s3Key);
		return c.redirect(url, 302);
	});

	return app;
}

export function formatEmailsResponse(result: EmailQueryResult) {
	return {
		emails: result.emails.map(({ s3Key, ...rest }) => ({
			...rest,
			attachments: rest.attachments.map(({ s3Key: _, ...att }) => ({
				...att,
				url: `/emails/${rest.messageId}/attachments/${att.filename}`,
			})),
			rawUrl: `/emails/${rest.messageId}/raw`,
		})),
		nextCursor: result.nextCursor,
		hasMore: result.hasMore,
	};
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

const s3 = new S3Client();
const ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient());

const signUrl = (s3Key: string) =>
	getSignedUrl(
		s3,
		new GetObjectCommand({
			Bucket: Resource.EmailBucket.name,
			Key: s3Key,
		}),
		{ expiresIn: 900 },
	);

const app = createApp({
	queryEmails,
	getEmailByMessageId,
	getSignedRawUrl: signUrl,
	getSignedAttachmentUrl: signUrl,
	verifyKey: async (token) => {
		const result = await ddbClient.send(
			new GetCommand({
				TableName: Resource.ApiKeysTable.name,
				Key: { keyHash: hashKey(token) },
			}),
		);
		return !!result.Item;
	},
});

export const handler = handle(app);
