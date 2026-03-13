import type { AttachmentMeta, EmailItem } from "@ses-inbox/core";
import type { VerifyKey } from "./middleware/auth";

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
	) => Promise<EmailItem | null>;
	getSignedRawUrl: (s3Key: string) => Promise<string>;
	getSignedAttachmentUrl: (s3Key: string) => Promise<string>;
	verifyKey: VerifyKey;
	version: string;
}
