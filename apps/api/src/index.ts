import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
	DeleteObjectsCommand,
	GetObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
	batchDeleteEmails,
	deleteEmail,
	getEmailByMessageId,
	getEmailRawByMessageId,
	queryAllEmailKeys,
	queryEmails,
} from "@ses-inbox/core";
import { Scalar } from "@scalar/hono-api-reference";
import { Hono } from "hono";
import { openAPIRouteHandler } from "hono-openapi";
import { handle } from "hono/aws-lambda";
import { Resource } from "sst";
import { CURRENT_API_VERSION } from "./lib/versioning";
import { hashKey } from "./middleware/auth";
import { createV1Routes } from "./routes/v1";
import type { AppDeps } from "./types";

export { formatEmailsResponse } from "./lib/format";
export type { ApiPrefix, ApiVersion } from "./lib/versioning";
export { CURRENT_API_PREFIX, CURRENT_API_VERSION } from "./lib/versioning";
export type { AppDeps, EmailQueryResult } from "./types";

export function createApp(deps: AppDeps) {
	const v1 = createV1Routes(deps);

	const app = new Hono()
		.get("/health", (c) => c.json({ status: "ok", timestamp: Date.now() }))
		.get("/version", (c) =>
			c.json({
				version: deps.version,
				apiVersions: [`v${CURRENT_API_VERSION}`],
			}),
		)
		.route("/v1", v1);

	return app
		.get(
			"/openapi.json",
			openAPIRouteHandler(app, {
				documentation: {
					info: {
						title: "ses-inbox",
						version: deps.version,
						description: "Serverless email receiving API powered by AWS SES",
					},
					components: {
						securitySchemes: {
							BearerAuth: { type: "http", scheme: "bearer" },
						},
					},
				},
			}),
		)
		.get("/docs", Scalar({ url: "/openapi.json" }));
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

const S3_DELETE_BATCH_SIZE = 1000;

const deleteS3Objects = async (keys: string[]) => {
	for (let i = 0; i < keys.length; i += S3_DELETE_BATCH_SIZE) {
		const batch = keys.slice(i, i + S3_DELETE_BATCH_SIZE);
		await s3.send(
			new DeleteObjectsCommand({
				Bucket: Resource.EmailBucket.name,
				Delete: { Objects: batch.map((Key) => ({ Key })) },
			}),
		);
	}
};

const app = createApp({
	queryEmails,
	getEmailByMessageId,
	getEmailRawByMessageId,
	deleteEmail,
	queryAllEmailKeys,
	batchDeleteEmails,
	deleteS3Objects,
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
