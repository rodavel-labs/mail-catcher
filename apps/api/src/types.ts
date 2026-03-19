import type {
	AttachmentMeta,
	EmailFilters,
	EmailItem,
	RawEmailRecord,
} from "@rodavel/mail-catcher-core";
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
		filters?: EmailFilters;
	}) => Promise<EmailQueryResult>;
	getEmailByMessageId: (messageId: string) => Promise<EmailItem | null>;
	getEmailRawByMessageId: (messageId: string) => Promise<RawEmailRecord | null>;
	deleteEmail: (pk: string, sk: string) => Promise<void>;
	queryAllEmailKeys: (inbox: string) => Promise<
		Array<{
			PK: string;
			SK: string;
			s3Key: string;
			attachments: AttachmentMeta[];
		}>
	>;
	batchDeleteEmails: (keys: Array<{ PK: string; SK: string }>) => Promise<void>;
	deleteS3Objects: (keys: string[]) => Promise<void>;
	getSignedRawUrl: (s3Key: string) => Promise<string>;
	getSignedAttachmentUrl: (s3Key: string) => Promise<string>;
	verifyKey: VerifyKey;
	version: string;
}
