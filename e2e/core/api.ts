import type {
	DeleteBulkResponse,
	DeleteSingleResponse,
	EmailListResponse,
	EmailResponse,
} from "@rodavel/mail-catcher-api";
import { apiHeaders, apiUrl } from "./config";

async function request(path: string, init?: RequestInit) {
	const url = apiUrl(path);
	const res = await fetch(url, {
		...init,
		headers: { ...apiHeaders(), ...init?.headers },
	});

	if (!res.ok) {
		const body = await res.text();
		throw new Error(`${res.status} ${res.statusText}: ${body}`);
	}

	return res.json();
}

export async function getEmails(
	inbox: string,
	params?: Record<string, string>,
): Promise<EmailListResponse> {
	const url = apiUrl("/v1/emails", { inbox, ...params });
	return request(url.pathname + url.search);
}

export async function getEmailsWithWait(
	inbox: string,
	params?: Record<string, string>,
): Promise<EmailListResponse> {
	return getEmails(inbox, { wait: "true", timeout: "15", ...params });
}

/**
 * Polls until the inbox contains at least `count` emails.
 * Useful when multiple emails are sent concurrently and the server-side
 * wait returns as soon as any single email arrives.
 */
export async function waitForEmailCount(
	inbox: string,
	count: number,
	timeoutMs = 30_000,
): Promise<EmailListResponse> {
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		const data = await getEmailsWithWait(inbox, {
			limit: String(count),
		});
		if (data.emails.length >= count) return data;

		await new Promise((r) => setTimeout(r, 1000));
	}

	return getEmails(inbox, { limit: String(count) });
}

export async function getEmail(messageId: string): Promise<EmailResponse> {
	return request(`/v1/emails/${encodeURIComponent(messageId)}`);
}

export async function deleteEmail(
	messageId: string,
): Promise<DeleteSingleResponse> {
	return request(`/v1/emails/${encodeURIComponent(messageId)}`, {
		method: "DELETE",
	});
}

export async function deleteInbox(inbox: string): Promise<DeleteBulkResponse> {
	const url = apiUrl("/v1/emails", { inbox });
	return request(url.pathname + url.search, { method: "DELETE" });
}
