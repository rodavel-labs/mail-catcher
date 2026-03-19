import type { EmailItem } from "@rodavel/mail-catcher-core";
import type { EmailQueryResult } from "../types";
import { CURRENT_API_PREFIX } from "./versioning";

function formatEmail({ s3Key, ...rest }: EmailQueryResult["emails"][number]) {
	return {
		...rest,
		attachments: rest.attachments.map(({ s3Key: _, ...att }) => ({
			...att,
			url: `${CURRENT_API_PREFIX}/emails/${encodeURIComponent(rest.messageId)}/attachments/${encodeURIComponent(att.filename)}`,
		})),
		rawUrl: `${CURRENT_API_PREFIX}/emails/${encodeURIComponent(rest.messageId)}/raw`,
	};
}

export function formatEmailResponse(email: EmailItem) {
	return formatEmail(email);
}

export function formatEmailsResponse(result: EmailQueryResult) {
	return {
		emails: result.emails.map(formatEmail),
		nextCursor: result.nextCursor,
		hasMore: result.hasMore,
	};
}
