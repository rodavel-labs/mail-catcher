import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import { Resource } from "sst";

import { getEmailByMessageId, queryEmails } from "./lib/dynamo";
import { CURRENT_API_VERSION } from "./lib/versioning";
import { hashKey } from "./middleware/auth";
import { createV1Routes } from "./routes/v1";
import type { AppDeps } from "./types";

export type { AppDeps, EmailQueryResult } from "./types";
export type { ApiPrefix, ApiVersion } from "./lib/versioning";
export { CURRENT_API_PREFIX, CURRENT_API_VERSION } from "./lib/versioning";
export { formatEmailsResponse } from "./lib/format";

export function createApp(deps: AppDeps) {
	const v1 = createV1Routes(deps);

	return new Hono()
		.get("/health", (c) => c.json({ status: "ok", timestamp: Date.now() }))
		.get("/version", (c) =>
			c.json({ version: deps.version, apiVersions: [`v${CURRENT_API_VERSION}`] }),
		)
		.route("/v1", v1);
}

export type AppType = ReturnType<typeof createApp>;

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
	version: "0.1.0",
});

export const handler = handle(app);
