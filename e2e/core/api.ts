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

export async function getEmails(inbox: string, params?: Record<string, string>) {
	const url = apiUrl("/v1/emails", { inbox, ...params });
	return request(url.pathname + url.search);
}

export async function getEmailsWithWait(inbox: string, params?: Record<string, string>) {
	return getEmails(inbox, { wait: "true", timeout: "15", ...params });
}

export async function getEmail(messageId: string) {
	return request(`/v1/emails/${encodeURIComponent(messageId)}`);
}

export async function deleteEmail(messageId: string) {
	return request(`/v1/emails/${encodeURIComponent(messageId)}`, {
		method: "DELETE",
	});
}

export async function deleteInbox(inbox: string) {
	const url = apiUrl("/v1/emails", { inbox });
	return request(url.pathname + url.search, { method: "DELETE" });
}
