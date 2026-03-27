import { beforeAll, describe, expect, test } from "bun:test";
import { deleteInbox, getEmails, waitForEmailCount } from "../core/api";
import { sendEmail } from "../core/ses";

const INBOX = `e2e-bulk-${Date.now()}`;

describe("bulk delete", () => {
	beforeAll(async () => {
		await Promise.all([
			sendEmail({ inbox: INBOX, subject: "Bulk 1" }),
			sendEmail({ inbox: INBOX, subject: "Bulk 2" }),
		]);

		await waitForEmailCount(INBOX, 2);
	}, 30_000);

	test("delete all emails in inbox", async () => {
		const result = await deleteInbox(INBOX);
		expect(result.deleted).toBeGreaterThanOrEqual(2);

		const data = await getEmails(INBOX);
		expect(data.emails.length).toBe(0);
	});
});
