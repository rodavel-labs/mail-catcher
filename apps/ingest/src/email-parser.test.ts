import { describe, expect, test } from "bun:test";
import { extractInbox, parseEmailHeaders } from "./email-parser";

describe("parseEmailHeaders", () => {
	test("extracts all headers from a standard email", () => {
		const raw = [
			"From: sender@example.com",
			"To: test@receive.example.com",
			"Subject: Hello World",
			"Message-ID: <abc123@mail.example.com>",
			"",
			"Body content here",
		].join("\r\n");

		const result = parseEmailHeaders(raw);

		expect(result.from).toBe("sender@example.com");
		expect(result.to).toBe("test@receive.example.com");
		expect(result.subject).toBe("Hello World");
		expect(result.messageId).toBe("<abc123@mail.example.com>");
	});

	test("handles folded (multiline) headers", () => {
		const raw = [
			"From: sender@example.com",
			"Subject: This is a very long",
			"\tsubject line that wraps",
			"To: test@receive.example.com",
			"Message-ID: <abc@mail.example.com>",
			"",
			"Body",
		].join("\r\n");

		const result = parseEmailHeaders(raw);

		expect(result.subject).toBe("This is a very long subject line that wraps");
	});

	test("handles folded headers with spaces", () => {
		const raw = [
			"Subject: folded",
			"   with spaces",
			"From: a@b.com",
			"To: c@d.com",
			"Message-ID: <x>",
			"",
			"Body",
		].join("\r\n");

		const result = parseEmailHeaders(raw);

		expect(result.subject).toBe("folded with spaces");
	});

	test("returns empty strings for missing headers", () => {
		const raw = ["X-Custom: value", "", "Body"].join("\r\n");

		const result = parseEmailHeaders(raw);

		expect(result.from).toBe("");
		expect(result.to).toBe("");
		expect(result.subject).toBe("");
		expect(result.messageId).toBe("");
	});

	test("is case-insensitive for header names", () => {
		const raw = [
			"from: sender@example.com",
			"TO: recipient@example.com",
			"SUBJECT: Test",
			"message-id: <123>",
			"",
			"Body",
		].join("\r\n");

		const result = parseEmailHeaders(raw);

		expect(result.from).toBe("sender@example.com");
		expect(result.to).toBe("recipient@example.com");
		expect(result.subject).toBe("Test");
		expect(result.messageId).toBe("<123>");
	});

	test("does not read past the header section", () => {
		const raw = [
			"From: sender@example.com",
			"To: recipient@example.com",
			"Subject: Real Subject",
			"Message-ID: <real>",
			"",
			"Subject: Fake Subject In Body",
		].join("\r\n");

		const result = parseEmailHeaders(raw);

		expect(result.subject).toBe("Real Subject");
	});

	test("handles input with no blank line separator", () => {
		const raw = [
			"From: sender@example.com",
			"To: recipient@example.com",
			"Subject: No Body",
			"Message-ID: <id>",
		].join("\r\n");

		const result = parseEmailHeaders(raw);

		expect(result.from).toBe("sender@example.com");
		expect(result.subject).toBe("No Body");
	});

	test("handles LF line endings", () => {
		const raw = [
			"From: sender@example.com",
			"To: recipient@example.com",
			"Subject: LF only",
			"Message-ID: <lf>",
			"",
			"Body",
		].join("\n");

		const result = parseEmailHeaders(raw);

		expect(result.from).toBe("sender@example.com");
		expect(result.subject).toBe("LF only");
	});
});

describe("extractInbox", () => {
	const domain = "receive.example.com";

	test("extracts local part from a plain address", () => {
		expect(extractInbox("test@receive.example.com", domain)).toBe("test");
	});

	test("extracts local part from angle-bracket format", () => {
		expect(extractInbox("Test User <test@receive.example.com>", domain)).toBe(
			"test",
		);
	});

	test("returns lowercase inbox", () => {
		expect(extractInbox("TestInbox@receive.example.com", domain)).toBe(
			"testinbox",
		);
	});

	test("returns null for non-matching domain", () => {
		expect(extractInbox("test@other.com", domain)).toBeNull();
	});

	test("returns null for empty string", () => {
		expect(extractInbox("", domain)).toBeNull();
	});

	test("handles dots in domain correctly", () => {
		expect(extractInbox("test@receive.example.com", domain)).toBe("test");
		expect(extractInbox("test@receivexexample.com", domain)).toBeNull();
	});

	test("handles multiple recipients (takes first match)", () => {
		expect(
			extractInbox("other@wrong.com, inbox@receive.example.com", domain),
		).toBe("inbox");
	});

	test("handles addresses with special local parts", () => {
		expect(extractInbox("user.name@receive.example.com", domain)).toBe(
			"user.name",
		);
		expect(extractInbox("user-name@receive.example.com", domain)).toBe(
			"user-name",
		);
		expect(extractInbox("user_name@receive.example.com", domain)).toBe(
			"user_name",
		);
	});

	test("is case-insensitive for domain matching", () => {
		expect(extractInbox("test@RECEIVE.EXAMPLE.COM", domain)).toBe("test");
	});
});
