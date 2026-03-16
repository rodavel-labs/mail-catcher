import type {
	DeleteBulkResponse,
	DeleteSingleResponse,
	EmailListResponse,
	EmailResponse,
} from "@ses-inbox/api";
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
