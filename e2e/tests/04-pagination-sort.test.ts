import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { deleteInbox, getEmails, getEmailsWithWait } from "../core/api";
import { sendEmail } from "../core/ses";

const INBOX = `e2e-page-${Date.now()}`;
const SUBJECTS = ["Page email A", "Page email B", "Page email C"];

describe("pagination and sort order", () => {
	beforeAll(async () => {
		for (const subject of SUBJECTS) {
			await sendEmail({ inbox: INBOX, subject });
			await new Promise((r) => setTimeout(r, 1500));
		}

		await getEmailsWithWait(INBOX, { limit: "3" });
	}, 60_000);

	afterAll(async () => {
		await deleteInbox(INBOX).catch(() => {});
	});

	test("emails are returned in descending order by receivedAt", async () => {
		const data = await getEmails(INBOX);

		expect(data.emails.length).toBe(3);

		for (let i = 1; i < data.emails.length; i++) {
			expect(data.emails[i - 1].receivedAt).toBeGreaterThanOrEqual(
				data.emails[i].receivedAt,
			);
		}
	});

	test("descending order matches expected subject sequence C, B, A", async () => {
		const data = await getEmails(INBOX);
		const subjects = data.emails.map((e) => e.subject);

		expect(subjects).toEqual(["Page email C", "Page email B", "Page email A"]);
	});

	test("response shape matches expected EmailResponse fields", async () => {
		const data = await getEmails(INBOX);
		const email = data.emails[0];

		expect(typeof email.messageId).toBe("string");
		expect(typeof email.inbox).toBe("string");
		expect(typeof email.sender).toBe("string");
		expect(typeof email.recipient).toBe("string");
		expect(typeof email.subject).toBe("string");
		expect(typeof email.body).toBe("string");
		expect(typeof email.htmlBody).toBe("string");
		expect(typeof email.receivedAt).toBe("number");
		expect(typeof email.rawUrl).toBe("string");
		expect(Array.isArray(email.attachments)).toBe(true);
		expect(typeof data.hasMore).toBe("boolean");
	});

	test("cursor-based pagination returns all emails without duplicates", async () => {
		const seen = new Set<string>();
		let cursor: string | undefined;

		do {
			const params: Record<string, string> = { limit: "1" };
			if (cursor) params.cursor = cursor;

			const data = await getEmails(INBOX, params);

			for (const email of data.emails) {
				expect(seen.has(email.messageId)).toBe(false);
				seen.add(email.messageId);
			}

			if (data.hasMore && data.nextCursor) {
				cursor = data.nextCursor;
			} else {
				cursor = undefined;
			}
		} while (cursor);

		expect(seen.size).toBe(3);
	});

	test("last page has hasMore false", async () => {
		const data = await getEmails(INBOX);

		expect(data.hasMore).toBe(false);
	});

	test("pagination preserves descending sort order across pages", async () => {
		const timestamps: number[] = [];
		let cursor: string | undefined;

		do {
			const params: Record<string, string> = { limit: "1" };
			if (cursor) params.cursor = cursor;

			const data = await getEmails(INBOX, params);

			for (const email of data.emails) {
				timestamps.push(email.receivedAt);
			}

			cursor = data.hasMore && data.nextCursor ? data.nextCursor : undefined;
		} while (cursor);

		for (let i = 1; i < timestamps.length; i++) {
			expect(timestamps[i - 1]).toBeGreaterThanOrEqual(timestamps[i]);
		}
	});

	test("each email has a receivedAt timestamp within a reasonable range", async () => {
		const data = await getEmails(INBOX);
		const fiveMinAgo = Date.now() - 5 * 60 * 1000;

		for (const email of data.emails) {
			expect(email.receivedAt).toBeGreaterThan(fiveMinAgo);
			expect(email.receivedAt).toBeLessThanOrEqual(Date.now());
		}
	});
});
