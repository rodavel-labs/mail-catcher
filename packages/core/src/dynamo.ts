import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
	DynamoDBDocumentClient,
	PutCommand,
	QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { Resource } from "sst";

const client = DynamoDBDocumentClient.from(new DynamoDBClient());

const SEVEN_DAYS_SEC = 7 * 24 * 60 * 60;

export interface AttachmentMeta {
	filename: string;
	contentType: string;
	size: number;
	s3Key: string;
	contentId?: string;
}

export interface EmailItem {
	inbox: string;
	messageId: string;
	sender: string;
	recipient: string;
	subject: string;
	body: string;
	htmlBody: string;
	attachments: AttachmentMeta[];
	s3Key: string;
	receivedAt: number;
}

/** @returns TTL in unix epoch seconds, 7 days from now */
function ttl(): number {
	return Math.floor(Date.now() / 1000) + SEVEN_DAYS_SEC;
}

export async function putEmail(item: EmailItem) {
	const sk = `${new Date(item.receivedAt).toISOString()}#${item.messageId}`;

	await client.send(
		new PutCommand({
			TableName: Resource.EmailsTable.name,
			Item: {
				PK: item.inbox,
				SK: sk,
				messageId: item.messageId,
				sender: item.sender,
				recipient: item.recipient,
				subject: item.subject,
				body: item.body,
				htmlBody: item.htmlBody,
				attachments: item.attachments,
				s3Key: item.s3Key,
				receivedAt: item.receivedAt,
				ttl: ttl(),
			},
		}),
	);
}

interface QueryEmailsOpts {
	inbox: string;
	cursor?: string;
	limit?: number;
}

export async function queryEmails({
	inbox,
	cursor,
	limit = 50,
}: QueryEmailsOpts) {
	const result = await client.send(
		new QueryCommand({
			TableName: Resource.EmailsTable.name,
			KeyConditionExpression: cursor ? "PK = :pk AND SK < :sk" : "PK = :pk",
			ExpressionAttributeValues: cursor
				? { ":pk": inbox, ":sk": cursor }
				: { ":pk": inbox },
			ScanIndexForward: false,
			Limit: limit,
		}),
	);

	const items = result.Items ?? [];
	const lastKey =
		items.length === limit ? items[items.length - 1]?.SK : undefined;

	return {
		emails: items.map((item) => ({
			messageId: item.messageId as string,
			inbox: item.PK as string,
			sender: item.sender as string,
			recipient: item.recipient as string,
			subject: item.subject as string,
			body: (item.body as string) ?? "",
			htmlBody: (item.htmlBody as string) ?? "",
			attachments: (item.attachments as AttachmentMeta[]) ?? [],
			receivedAt: item.receivedAt as number,
			s3Key: item.s3Key as string,
		})),
		nextCursor: lastKey as string | undefined,
		hasMore: items.length === limit,
	};
}

export async function getEmailByMessageId(
	messageId: string,
): Promise<EmailItem | null> {
	const result = await client.send(
		new QueryCommand({
			TableName: Resource.EmailsTable.name,
			IndexName: "MessageIdIndex",
			KeyConditionExpression: "messageId = :mid",
			ExpressionAttributeValues: { ":mid": messageId },
			Limit: 1,
		}),
	);

	return (result.Items?.[0] as EmailItem) ?? null;
}
