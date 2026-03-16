import { Hono } from "hono";

import { CURRENT_API_VERSION } from "../../lib/versioning";
import { createApiKeyAuth } from "../../middleware/auth";
import type { AppDeps } from "../../types";
import { createEmailRoutes } from "./emails";

export function createV1Routes(deps: AppDeps) {
	const auth = createApiKeyAuth(deps.verifyKey);
	const emails = createEmailRoutes(deps);

	return new Hono()
		.use("*", async (c, next) => {
			await next();
			c.header("X-API-Version", `v${CURRENT_API_VERSION}`);
		})
		.use("/emails/*", auth)
		.use("/emails", auth)
		.route("/emails", emails);
}
