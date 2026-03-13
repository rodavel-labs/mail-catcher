export const API_URL = loadApiUrl().replace(/\/+$/, "");
export const API_TOKEN = requiredEnv("API_TOKEN");
export const SES_DOMAIN = requiredEnv("SES_DOMAIN");

function loadApiUrl(): string {
	if (process.env.API_URL) return process.env.API_URL;

	try {
		const { readFileSync } = require("node:fs");
		const outputs = JSON.parse(readFileSync(".sst/outputs.json", "utf-8"));
		if (outputs.apiUrl) return outputs.apiUrl;
	} catch {}

	throw new Error("API_URL is required in .env or .sst/outputs.json");
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
