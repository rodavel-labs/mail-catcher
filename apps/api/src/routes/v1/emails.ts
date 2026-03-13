import type { EmailFilters } from "@ses-inbox/core";
import { Hono } from "hono";
import { formatEmailResponse, formatEmailsResponse } from "../../lib/format";
import type { AppDeps } from "../../types";

const INBOX_PATTERN = /^[a-z0-9._-]+$/i;

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function validateInbox(
	inbox: string | undefined,
):
	| { valid: true; inbox: string }
	| { valid: false; error: { error: string; message: string } } {
	if (!inbox) {
		return {
			valid: false,
			error: {
				error: "MISSING_INBOX",
				message: "inbox query parameter is required",
			},
		};
	}
	if (!INBOX_PATTERN.test(inbox)) {
		return {
			valid: false,
			error: {
				error: "INVALID_INBOX",
				message: "Inbox contains invalid characters",
			},
		};
	}
	return { valid: true, inbox };
}

function parseTimestamp(value: string): number | null {
	const asNum = Number(value);
	if (!Number.isNaN(asNum) && asNum > 0) return asNum;
	const asDate = new Date(value).getTime();
	if (!Number.isNaN(asDate)) return asDate;
	return null;
}

function parseFilters(c: {
	req: { query: (key: string) => string | undefined };
}): EmailFilters | undefined {
	const sender = c.req.query("sender");
	const subject = c.req.query("subject");
	const receivedAfterRaw = c.req.query("receivedAfter");
	const receivedBeforeRaw = c.req.query("receivedBefore");
	const hasAttachmentsRaw = c.req.query("hasAttachments");

	const filters: EmailFilters = {};
	let hasFilter = false;

	if (sender) {
		filters.sender = sender;
		hasFilter = true;
	}
	if (subject) {
		filters.subject = subject;
		hasFilter = true;
	}
	if (receivedAfterRaw) {
		const ts = parseTimestamp(receivedAfterRaw);
		if (ts !== null) {
			filters.receivedAfter = ts;
			hasFilter = true;
		}
	}
	if (receivedBeforeRaw) {
		const ts = parseTimestamp(receivedBeforeRaw);
		if (ts !== null) {
			filters.receivedBefore = ts;
			hasFilter = true;
		}
	}
	if (hasAttachmentsRaw === "true" || hasAttachmentsRaw === "false") {
		filters.hasAttachments = hasAttachmentsRaw === "true";
		hasFilter = true;
	}

	return hasFilter ? filters : undefined;
}

export function createEmailRoutes(deps: AppDeps) {
	return new Hono()
		.get("/", async (c) => {
			const inboxResult = validateInbox(c.req.query("inbox"));
			if (!inboxResult.valid) return c.json(inboxResult.error, 400);
			const { inbox } = inboxResult;

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
			const filters = parseFilters(c);

			if (wait) {
				const deadline = Date.now() + timeout * 1000;
				while (Date.now() < deadline) {
					const result = await deps.queryEmails({
						inbox,
						cursor,
						limit,
						filters,
					});
					if (result.emails.length > 0) {
						return c.json(formatEmailsResponse(result));
					}
					await sleep(2000);
				}
				return c.json({ emails: [], nextCursor: undefined, hasMore: false });
			}

			const result = await deps.queryEmails({ inbox, cursor, limit, filters });
			return c.json(formatEmailsResponse(result));
		})
		.get("/:messageId", async (c) => {
			const { messageId } = c.req.param();

			const email = await deps.getEmailByMessageId(messageId);
			if (!email) {
				return c.json({ error: "NOT_FOUND", message: "Email not found" }, 404);
			}

			return c.json(formatEmailResponse(email));
		})
		.delete("/:messageId", async (c) => {
			const { messageId } = c.req.param();

			const email = await deps.getEmailRawByMessageId(messageId);
			if (!email) {
				return c.json({ error: "NOT_FOUND", message: "Email not found" }, 404);
			}

			const s3Keys = [email.s3Key, ...email.attachments.map((a) => a.s3Key)];

			await Promise.all([
				deps.deleteEmail(email.PK, email.SK),
				deps.deleteS3Objects(s3Keys),
			]);

			return c.json({ deleted: true, messageId });
		})
		.delete("/", async (c) => {
			const inboxResult = validateInbox(c.req.query("inbox"));
			if (!inboxResult.valid) return c.json(inboxResult.error, 400);
			const { inbox } = inboxResult;

			const items = await deps.queryAllEmailKeys(inbox);
			if (items.length === 0) {
				return c.json({ deleted: 0 });
			}

			const s3Keys = items.flatMap((item) => [
				item.s3Key,
				...item.attachments.map((a) => a.s3Key),
			]);

			await Promise.all([
				deps.batchDeleteEmails(items.map(({ PK, SK }) => ({ PK, SK }))),
				deps.deleteS3Objects(s3Keys),
			]);

			return c.json({ deleted: items.length });
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
