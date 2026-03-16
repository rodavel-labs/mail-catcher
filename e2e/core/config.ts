import { readFileSync } from "node:fs";
import { z } from "zod";

const EnvSchema = z.object({
	API_URL: z.string().min(1).optional(),
	API_DOMAIN: z.string().min(1).optional(),
	API_TOKEN: z.string().min(1, "API_TOKEN is required in .env"),
	SES_DOMAIN: z.string().min(1, "SES_DOMAIN is required in .env"),
});

const env = EnvSchema.parse(process.env);

function loadApiUrl(): string {
	if (env.API_URL) return env.API_URL;
	if (env.API_DOMAIN) return `https://${env.API_DOMAIN}`;

	try {
		const outputs = JSON.parse(readFileSync(".sst/outputs.json", "utf-8"));
		if (outputs.apiUrl) return outputs.apiUrl;
	} catch {}

	throw new Error(
		"API_URL, API_DOMAIN, or apiUrl in .sst/outputs.json is required",
	);
}

export const API_URL = loadApiUrl().replace(/\/+$/, "");
export const API_TOKEN = env.API_TOKEN;
export const SES_DOMAIN = env.SES_DOMAIN;

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
