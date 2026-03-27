interface InfraEnv {
	SES_DOMAIN: string;
	HOSTED_ZONE_ID?: string;
	API_DOMAIN?: string;
	MAX_ATTACHMENT_SIZE?: string;
	MAX_ATTACHMENTS?: string;
}

function requiredEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`${name} must be set in .env`);
	}
	return value;
}

function optionalEnv(name: string): string | undefined {
	return process.env[name] || undefined;
}

export const env: InfraEnv = {
	SES_DOMAIN: requiredEnv("SES_DOMAIN"),
	HOSTED_ZONE_ID: optionalEnv("HOSTED_ZONE_ID"),
	API_DOMAIN: optionalEnv("API_DOMAIN"),
	MAX_ATTACHMENT_SIZE: optionalEnv("MAX_ATTACHMENT_SIZE"),
	MAX_ATTACHMENTS: optionalEnv("MAX_ATTACHMENTS"),
};
