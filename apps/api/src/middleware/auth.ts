import { createHash } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { createMiddleware } from "hono/factory";
import { Resource } from "sst";

export function hashKey(plaintext: string): string {
	return createHash("sha256").update(plaintext).digest("hex");
}

export type VerifyKey = (token: string) => Promise<boolean>;

/**
 * @param verifyKey Resolves to true if the token is valid
 */
export function createApiKeyAuth(verifyKey: VerifyKey) {
	return createMiddleware(async (c, next) => {
		const header = c.req.header("Authorization");
		if (!header?.startsWith("Bearer ")) {
			return c.json({ error: "UNAUTHORIZED" }, 401);
		}

		const token = header.slice(7);
		const valid = await verifyKey(token);

		if (!valid) {
			return c.json({ error: "UNAUTHORIZED" }, 401);
		}

		await next();
	});
}

function createDynamoVerifyKey(): VerifyKey {
	const client = DynamoDBDocumentClient.from(new DynamoDBClient());

	return async (token: string) => {
		const keyHash = hashKey(token);
		const result = await client.send(
			new GetCommand({
				TableName: Resource.ApiKeysTable.name,
				Key: { keyHash },
			}),
		);
		return !!result.Item;
	};
}

export const apiKeyAuth = createApiKeyAuth(createDynamoVerifyKey());
