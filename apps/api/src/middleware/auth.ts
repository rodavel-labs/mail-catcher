import { createHash } from "node:crypto";
import { createMiddleware } from "hono/factory";

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
