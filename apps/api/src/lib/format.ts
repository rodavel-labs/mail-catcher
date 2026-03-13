import type { EmailQueryResult } from "../types";
import { CURRENT_API_PREFIX } from "./versioning";

export function formatEmailsResponse(result: EmailQueryResult) {
	return {
		emails: result.emails.map(({ s3Key, ...rest }) => ({
			...rest,
			attachments: rest.attachments.map(({ s3Key: _, ...att }) => ({
				...att,
				url: `${CURRENT_API_PREFIX}/emails/${encodeURIComponent(rest.messageId)}/attachments/${encodeURIComponent(att.filename)}`,
			})),
			rawUrl: `${CURRENT_API_PREFIX}/emails/${encodeURIComponent(rest.messageId)}/raw`,
		})),
		nextCursor: result.nextCursor,
		hasMore: result.hasMore,
	};
}
