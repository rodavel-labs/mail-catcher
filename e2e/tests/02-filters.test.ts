import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { deleteInbox, getEmails, getEmailsWithWait } from "../core/api";
import { SES_DOMAIN } from "../core/config";
import { sendEmail } from "../core/ses";

const INBOX = `e2e-filter-${Date.now()}`;

describe("query filters", () => {
	beforeAll(async () => {
		await Promise.all([
			sendEmail({
				inbox: INBOX,
				subject: "Invoice #123",
				from: `Billing <billing@${SES_DOMAIN}>`,
			}),
			sendEmail({
				inbox: INBOX,
				subject: "Welcome aboard",
				from: `Support <support@${SES_DOMAIN}>`,
			}),
		]);

		const data = await getEmailsWithWait(INBOX, { limit: "2" });
		if (data.emails.length < 2) {
			await new Promise((r) => setTimeout(r, 5000));
		}
	}, 45_000);

	afterAll(async () => {
		await deleteInbox(INBOX).catch(() => {});
	});

	test("filter by subject substring", async () => {
		const data = await getEmails(INBOX, { subject: "Invoice" });
		expect(data.emails.length).toBe(1);
		expect(data.emails[0].subject).toContain("Invoice");
	});

	test("filter by sender", async () => {
		const data = await getEmails(INBOX, { sender: "Billing" });
		expect(data.emails.length).toBe(1);
		expect(data.emails[0].subject).toContain("Invoice");
	});

	test("filter by hasAttachments=false", async () => {
		const data = await getEmails(INBOX, { hasAttachments: "false" });
		expect(data.emails.length).toBe(2);
	});

	test("combined filters narrow results", async () => {
		const data = await getEmails(INBOX, {
			subject: "Invoice",
			sender: "Billing",
		});
		expect(data.emails.length).toBe(1);

		const noMatch = await getEmails(INBOX, {
			subject: "Invoice",
			sender: "Support",
		});
		expect(noMatch.emails.length).toBe(0);
	});

	test("pagination works with filters", async () => {
		const page1 = await getEmails(INBOX, { limit: "1" });
		expect(page1.emails.length).toBe(1);

		if (page1.hasMore && page1.nextCursor) {
			const page2 = await getEmails(INBOX, {
				limit: "1",
				cursor: page1.nextCursor,
			});
			expect(page2.emails.length).toBe(1);
			expect(page2.emails[0].messageId).not.toBe(page1.emails[0].messageId);
		}
	});
});
