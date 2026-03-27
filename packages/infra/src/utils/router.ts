/// <reference path="../../../../.sst/platform/config.d.ts" />

const usEast1 = new aws.Provider("UsEast1", { region: "us-east-1" });

function lookupCertificate(apiDomain: string) {
	return aws.acm.getCertificateOutput(
		{
			domain: apiDomain,
			statuses: ["ISSUED"],
			mostRecent: true,
		},
		{ provider: usEast1 },
	).arn;
}

function buildDomainConfig(apiDomain: string, hostedZoneId?: string) {
	if (hostedZoneId) {
		return { name: apiDomain, dns: sst.aws.dns({ zone: hostedZoneId }) };
	}

	return {
		name: apiDomain,
		dns: false as const,
		cert: lookupCertificate(apiDomain),
	};
}

export function createApiRouter(
	api: sst.aws.Function,
	apiDomain: string,
	hostedZoneId?: string,
) {
	return new sst.aws.Router("ApiRouter", {
		routes: {
			"/*": api.url,
		},
		domain: buildDomainConfig(apiDomain, hostedZoneId),
	});
}
