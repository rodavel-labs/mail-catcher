import { describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";

import { createApiKeyAuth, hashKey } from "./auth";

function createTestApp(verifyKey: (token: string) => Promise<boolean>) {
	const app = new Hono();
	const auth = createApiKeyAuth(verifyKey);

	app.use("/protected/*", auth);
	app.get("/protected/resource", (c) => c.json({ ok: true }));

	return app;
}

describe("createApiKeyAuth", () => {
	test("returns 401 when Authorization header is missing", async () => {
		const app = createTestApp(() => Promise.resolve(true));
		const res = await app.request("/protected/resource");

		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error).toBe("UNAUTHORIZED");
		expect(body.message).toContain("bearer token");
	});

	test("returns 401 when Authorization header is not Bearer", async () => {
		const app = createTestApp(() => Promise.resolve(true));
		const res = await app.request("/protected/resource", {
			headers: { Authorization: "Basic abc123" },
		});

		expect(res.status).toBe(401);
	});

	test("returns 401 when token is invalid", async () => {
		const verifyKey = mock(() => Promise.resolve(false));
		const app = createTestApp(verifyKey);
		const res = await app.request("/protected/resource", {
			headers: { Authorization: "Bearer bad-token" },
		});

		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error).toBe("UNAUTHORIZED");
		expect(body.message).toContain("Invalid API key");
		expect(verifyKey).toHaveBeenCalledWith("bad-token");
	});

	test("allows request when token is valid", async () => {
		const verifyKey = mock(() => Promise.resolve(true));
		const app = createTestApp(verifyKey);
		const res = await app.request("/protected/resource", {
			headers: { Authorization: "Bearer good-token" },
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(verifyKey).toHaveBeenCalledWith("good-token");
	});

	test("extracts token correctly from Bearer header", async () => {
		const verifyKey = mock(() => Promise.resolve(true));
		const app = createTestApp(verifyKey);
		await app.request("/protected/resource", {
			headers: { Authorization: "Bearer my-secret-token-123" },
		});

		expect(verifyKey).toHaveBeenCalledWith("my-secret-token-123");
	});
});

describe("hashKey", () => {
	test("returns consistent SHA-256 hex digest", () => {
		const hash1 = hashKey("test-token");
		const hash2 = hashKey("test-token");

		expect(hash1).toBe(hash2);
		expect(hash1).toMatch(/^[a-f0-9]{64}$/);
	});

	test("produces different hashes for different inputs", () => {
		expect(hashKey("token-a")).not.toBe(hashKey("token-b"));
	});
});
