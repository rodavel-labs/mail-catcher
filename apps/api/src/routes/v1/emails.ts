import { type EmailFilters, sleep } from "@ses-inbox/core";
import { Hono } from "hono";
import { describeRoute, resolver, validator } from "hono-openapi";
import { formatEmailResponse, formatEmailsResponse } from "../../lib/format";
import {
	AttachmentParam,
	BulkDeleteQuery,
	DeleteBulkSchema,
	DeleteSingleSchema,
	EmailListSchema,
	EmailSchema,
	ErrorSchema,
	ListEmailsQuery,
	MessageIdParam,
} from "../../schemas";
import type { AppDeps } from "../../types";
import {
	bulkDeleteValidationHook,
	inboxValidationHook,
} from "../../validators";

const security = [{ BearerAuth: [] }];
const errSchema = { schema: resolver(ErrorSchema) };

function parseTimestamp(value: string): number | null {
	const asNum = Number(value);
	if (!Number.isNaN(asNum) && asNum > 0) return asNum;
	const asDate = new Date(value).getTime();
	if (!Number.isNaN(asDate)) return asDate;
	return null;
}

function buildFilters(
	query: Record<string, string | undefined>,
): EmailFilters | undefined {
	const filters: EmailFilters = {};
	let hasFilter = false;

	if (query.sender) {
		filters.sender = query.sender;
		hasFilter = true;
	}
	if (query.subject) {
		filters.subject = query.subject;
		hasFilter = true;
	}
	if (query.receivedAfter) {
		const ts = parseTimestamp(query.receivedAfter);
		if (ts !== null) {
			filters.receivedAfter = ts;
			hasFilter = true;
		}
	}
	if (query.receivedBefore) {
		const ts = parseTimestamp(query.receivedBefore);
		if (ts !== null) {
			filters.receivedBefore = ts;
			hasFilter = true;
		}
	}
	if (query.hasAttachments === "true" || query.hasAttachments === "false") {
		filters.hasAttachments = query.hasAttachments === "true";
		hasFilter = true;
	}

	return hasFilter ? filters : undefined;
}

export function createEmailRoutes(deps: AppDeps) {
	return new Hono()
		.get(
			"/",
			describeRoute({
				tags: ["Emails"],
				summary: "List emails",
				description:
					"Returns emails for a given inbox. Supports long-polling via wait=true.",
				security,
				responses: {
					200: {
						description: "List of emails",
						content: {
							"application/json": { schema: resolver(EmailListSchema) },
						},
					},
					400: {
						description: "Bad request",
						content: { "application/json": errSchema },
					},
					401: {
						description: "Unauthorized",
						content: { "application/json": errSchema },
					},
				},
			}),
			validator("query", ListEmailsQuery, inboxValidationHook),
			async (c) => {
				const { inbox, limit, cursor, wait, timeout, ...filterParams } =
					c.req.valid("query");

				const filters = buildFilters(filterParams);

				if (wait === "true") {
					const deadline = Date.now() + timeout * 1000;
					let delay = 500;
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
						await sleep(Math.min(delay, 10_000));
						delay *= 2;
					}
					return c.json({ emails: [], nextCursor: undefined, hasMore: false });
				}

				const result = await deps.queryEmails({
					inbox,
					cursor,
					limit,
					filters,
				});
				return c.json(formatEmailsResponse(result));
			},
		)
		.get(
			"/:messageId",
			describeRoute({
				tags: ["Emails"],
				summary: "Get email by message ID",
				security,
				responses: {
					200: {
						description: "Email details",
						content: {
							"application/json": { schema: resolver(EmailSchema) },
						},
					},
					401: {
						description: "Unauthorized",
						content: { "application/json": errSchema },
					},
					404: {
						description: "Not found",
						content: { "application/json": errSchema },
					},
				},
			}),
			validator("param", MessageIdParam),
			async (c) => {
				const { messageId } = c.req.valid("param");

				const email = await deps.getEmailByMessageId(messageId);
				if (!email) {
					return c.json({ error: "NOT_FOUND" }, 404);
				}

				return c.json(formatEmailResponse(email));
			},
		)
		.delete(
			"/:messageId",
			describeRoute({
				tags: ["Emails"],
				summary: "Delete email by message ID",
				security,
				responses: {
					200: {
						description: "Email deleted",
						content: {
							"application/json": { schema: resolver(DeleteSingleSchema) },
						},
					},
					401: {
						description: "Unauthorized",
						content: { "application/json": errSchema },
					},
					404: {
						description: "Not found",
						content: { "application/json": errSchema },
					},
				},
			}),
			validator("param", MessageIdParam),
			async (c) => {
				const { messageId } = c.req.valid("param");

				const email = await deps.getEmailRawByMessageId(messageId);
				if (!email) {
					return c.json({ error: "NOT_FOUND" }, 404);
				}

				const s3Keys = [email.s3Key, ...email.attachments.map((a) => a.s3Key)];

				await Promise.all([
					deps.deleteEmail(email.PK, email.SK),
					deps.deleteS3Objects(s3Keys),
				]);

				return c.json({ deleted: true, messageId });
			},
		)
		.delete(
			"/",
			describeRoute({
				tags: ["Emails"],
				summary: "Bulk delete emails by inbox",
				security,
				responses: {
					200: {
						description: "Emails deleted",
						content: {
							"application/json": { schema: resolver(DeleteBulkSchema) },
						},
					},
					400: {
						description: "Bad request",
						content: { "application/json": errSchema },
					},
					401: {
						description: "Unauthorized",
						content: { "application/json": errSchema },
					},
				},
			}),
			validator("query", BulkDeleteQuery, bulkDeleteValidationHook),
			async (c) => {
				const { inbox } = c.req.valid("query");

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
			},
		)
		.get(
			"/:messageId/raw",
			describeRoute({
				tags: ["Emails"],
				summary: "Get raw .eml file",
				description:
					"Redirects to a pre-signed S3 URL for the raw .eml file (15-minute expiry)",
				security,
				responses: {
					302: { description: "Redirect to pre-signed S3 URL" },
					401: {
						description: "Unauthorized",
						content: { "application/json": errSchema },
					},
					404: {
						description: "Not found",
						content: { "application/json": errSchema },
					},
				},
			}),
			validator("param", MessageIdParam),
			async (c) => {
				const { messageId } = c.req.valid("param");

				const email = await deps.getEmailByMessageId(messageId);
				if (!email) {
					return c.json({ error: "NOT_FOUND" }, 404);
				}

				const url = await deps.getSignedRawUrl(email.s3Key);
				return c.redirect(url, 302);
			},
		)
		.get(
			"/:messageId/attachments/:filename",
			describeRoute({
				tags: ["Emails"],
				summary: "Get attachment file",
				description:
					"Redirects to a pre-signed S3 URL for the attachment (15-minute expiry)",
				security,
				responses: {
					302: { description: "Redirect to pre-signed S3 URL" },
					401: {
						description: "Unauthorized",
						content: { "application/json": errSchema },
					},
					404: {
						description: "Not found",
						content: { "application/json": errSchema },
					},
				},
			}),
			validator("param", AttachmentParam),
			async (c) => {
				const { messageId, filename } = c.req.valid("param");

				const email = await deps.getEmailByMessageId(messageId);
				if (!email) {
					return c.json({ error: "NOT_FOUND" }, 404);
				}

				const attachments = email.attachments ?? [];
				const attachment = attachments.find((a) => a.filename === filename);
				if (!attachment) {
					return c.json({ error: "NOT_FOUND" }, 404);
				}

				const url = await deps.getSignedAttachmentUrl(attachment.s3Key);
				return c.redirect(url, 302);
			},
		);
}
