import { z } from "zod";

const INBOX_PATTERN = /^[a-z0-9._-]+$/i;

export const InboxParam = z
	.string()
	.regex(INBOX_PATTERN, "Inbox contains invalid characters");

export const ListEmailsQuery = z.object({
	inbox: InboxParam,
	limit: z.coerce.number().int().min(1).max(100).default(50),
	cursor: z.string().optional(),
	wait: z.enum(["true", "false"]).optional(),
	timeout: z.coerce.number().int().min(1).max(28).default(28),
	sender: z.string().optional(),
	subject: z.string().optional(),
	receivedAfter: z.string().optional(),
	receivedBefore: z.string().optional(),
	hasAttachments: z.enum(["true", "false"]).optional(),
});

export const BulkDeleteQuery = z.object({
	inbox: InboxParam,
});

export const MessageIdParam = z.object({
	messageId: z.string(),
});

export const AttachmentParam = z.object({
	messageId: z.string(),
	filename: z.string(),
});

export const AttachmentSchema = z.object({
	filename: z.string(),
	contentType: z.string(),
	size: z.number().int(),
	url: z.string(),
	contentId: z.string().optional(),
});

export const EmailSchema = z.object({
	messageId: z.string(),
	inbox: z.string(),
	sender: z.string(),
	recipient: z.string(),
	subject: z.string(),
	body: z.string(),
	htmlBody: z.string(),
	attachments: z.array(AttachmentSchema),
	receivedAt: z.number().int(),
	rawUrl: z.string(),
});

export const EmailListSchema = z.object({
	emails: z.array(EmailSchema),
	nextCursor: z.string().optional(),
	hasMore: z.boolean(),
});

export const ErrorSchema = z.object({
	error: z.string(),
});

export const DeleteSingleSchema = z.object({
	deleted: z.literal(true),
	messageId: z.string(),
});

export const DeleteBulkSchema = z.object({
	deleted: z.number().int(),
});
