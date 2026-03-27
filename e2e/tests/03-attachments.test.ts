import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	deleteInbox,
	getEmail,
	getEmails,
	getEmailsWithWait,
	waitForEmailCount,
} from "../core/api";
import { sendEmail } from "../core/ses";

const INBOX = `e2e-attach-${Date.now()}`;

let sentMessageId: string;

describe("attachments", () => {
	beforeAll(async () => {
		const content = Buffer.from("Hello from e2e test").toString("base64");

		await sendEmail({
			inbox: INBOX,
			subject: "Email with attachment",
			attachments: [{ content, filename: "test.txt" }],
		});

		await waitForEmailCount(INBOX, 1);
	}, 30_000);

	afterAll(async () => {
		await deleteInbox(INBOX).catch(() => {});
	});

	test("email with attachment is listed and has attachment metadata", async () => {
		const data = await getEmailsWithWait(INBOX);

		expect(data.emails.length).toBeGreaterThanOrEqual(1);
		const email = data.emails.find(
			(e) => e.subject === "Email with attachment",
		);
		if (!email) throw new Error("Expected email not found");
		expect(email.attachments.length).toBeGreaterThanOrEqual(1);

		const att = email.attachments.find((a) => a.filename === "0-test.txt");
		if (!att) throw new Error("Expected attachment not found");
		expect(att.contentType).toBeDefined();
		expect(att.size).toBeGreaterThan(0);
		expect(att.url).toContain("/attachments/");

		sentMessageId = email.messageId;
	}, 30_000);

	test("single email endpoint includes attachment metadata", async () => {
		expect(sentMessageId).toBeDefined();

		const email = await getEmail(sentMessageId);
		expect(email.attachments.length).toBeGreaterThanOrEqual(1);

		const att = email.attachments.find((a) => a.filename === "0-test.txt");
		if (!att) throw new Error("Expected attachment not found");
		expect(att.url).toContain("/attachments/");
	});

	test("hasAttachments filter returns only emails with attachments", async () => {
		await sendEmail({ inbox: INBOX, subject: "No attachment email" });
		await getEmailsWithWait(INBOX, { limit: "2" });

		const withAtt = await getEmails(INBOX, { hasAttachments: "true" });
		expect(withAtt.emails.length).toBeGreaterThanOrEqual(1);
		for (const email of withAtt.emails) {
			expect(email.attachments.length).toBeGreaterThan(0);
		}

		const withoutAtt = await getEmails(INBOX, { hasAttachments: "false" });
		for (const email of withoutAtt.emails) {
			expect(email.attachments.length).toBe(0);
		}
	}, 30_000);
});
