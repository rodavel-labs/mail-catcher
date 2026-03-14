import type { Context } from "hono";

type Issue = {
	message: string;
	path?: ReadonlyArray<PropertyKey>;
	code?: string;
};

type ValidationResult = {
	success: boolean;
	error?: ReadonlyArray<Issue>;
};

function firstField(result: ValidationResult): string {
	const path = result.error?.[0]?.path;
	return path && path.length > 0 ? String(path[path.length - 1]) : "";
}

function isMissing(result: ValidationResult): boolean {
	return result.error?.[0]?.code === "invalid_type";
}

export function inboxValidationHook(result: ValidationResult, c: Context) {
	if (result.success) return;

	const field = firstField(result);
	if (field === "inbox") {
		const code = isMissing(result) ? "MISSING_INBOX" : "INVALID_INBOX";
		return c.json({ error: code }, 400);
	}
	if (field === "limit") {
		return c.json({ error: "INVALID_LIMIT" }, 400);
	}
	return c.json({ error: "VALIDATION_ERROR" }, 400);
}

export function bulkDeleteValidationHook(
	result: ValidationResult,
	c: Context,
) {
	if (result.success) return;

	const code = isMissing(result) ? "MISSING_INBOX" : "INVALID_INBOX";
	return c.json({ error: code }, 400);
}
