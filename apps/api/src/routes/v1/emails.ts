import { Hono } from "hono";
import { formatEmailsResponse } from "../../lib/format";
import type { AppDeps } from "../../types";

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createEmailRoutes(deps: AppDeps) {
	return new Hono()
		.get("/", async (c) => {
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
					{
						error: "INVALID_LIMIT",
						message: "Limit must be between 1 and 100",
					},
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
		})
		.get("/:messageId/raw", async (c) => {
			const { messageId } = c.req.param();

			const email = await deps.getEmailByMessageId(messageId);
			if (!email) {
				return c.json({ error: "NOT_FOUND", message: "Email not found" }, 404);
			}

			const url = await deps.getSignedRawUrl(email.s3Key);
			return c.redirect(url, 302);
		})
		.get("/:messageId/attachments/:filename", async (c) => {
			const { messageId, filename } = c.req.param();

			const email = await deps.getEmailByMessageId(messageId);
			if (!email) {
				return c.json({ error: "NOT_FOUND", message: "Email not found" }, 404);
			}

			const attachments = email.attachments ?? [];
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
}
