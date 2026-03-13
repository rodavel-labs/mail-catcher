import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { deleteEmail, getEmail, getEmailsWithWait, deleteInbox } from "../core/api";
import { sendEmail } from "../core/ses";

const INBOX = `e2e-crud-${Date.now()}`;

let sentMessageId: string;

describe("email crud", () => {
	beforeAll(async () => {
		await sendEmail({ inbox: INBOX, subject: "E2E test email" });
	});

	afterAll(async () => {
		await deleteInbox(INBOX).catch(() => {});
	});

	test("list emails with wait returns the sent email", async () => {
		const data = await getEmailsWithWait(INBOX);

		expect(data.emails.length).toBeGreaterThanOrEqual(1);
		const email = data.emails.find((e: { subject: string }) => e.subject === "E2E test email");
		expect(email).toBeDefined();
		expect(email.inbox).toBe(INBOX);
		sentMessageId = email.messageId;
	}, 30_000);

	test("get single email by messageId", async () => {
		expect(sentMessageId).toBeDefined();

		const email = await getEmail(sentMessageId);
		expect(email.messageId).toBe(sentMessageId);
		expect(email.subject).toBe("E2E test email");
		expect(email.inbox).toBe(INBOX);
	});

	test("delete single email by messageId", async () => {
		expect(sentMessageId).toBeDefined();

		const result = await deleteEmail(sentMessageId);
		expect(result.deleted).toBe(true);
		expect(result.messageId).toBe(sentMessageId);

		expect(getEmail(sentMessageId)).rejects.toThrow("404");
	});
});
