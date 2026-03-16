export const API_URL = loadApiUrl().replace(/\/+$/, "");
export const API_TOKEN = requiredEnv("API_TOKEN");
export const SES_DOMAIN = requiredEnv("SES_DOMAIN");

function loadApiUrl(): string {
	if (process.env.API_URL) return process.env.API_URL;
	if (process.env.API_DOMAIN) return `https://${process.env.API_DOMAIN}`;

	try {
		const { readFileSync } = require("node:fs");
		const outputs = JSON.parse(readFileSync(".sst/outputs.json", "utf-8"));
		if (outputs.apiUrl) return outputs.apiUrl;
	} catch {}

	throw new Error("API_URL, API_DOMAIN, or apiUrl in .sst/outputs.json is required");
}

function requiredEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`${name} is required in .env`);
	}
	return value;
}

export function apiHeaders() {
	return { Authorization: `Bearer ${API_TOKEN}` };
}

export function apiUrl(path: string, params?: Record<string, string>) {
	const url = new URL(path, API_URL);
	if (params) {
		for (const [k, v] of Object.entries(params)) {
			url.searchParams.set(k, v);
		}
	}
	return url;
}
