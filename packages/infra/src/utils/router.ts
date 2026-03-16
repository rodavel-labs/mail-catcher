/// <reference path="../../../../.sst/platform/config.d.ts" />

function lookupCertificate(apiDomain: string) {
	return aws.acm.getCertificateOutput({
		domain: apiDomain,
		statuses: ["ISSUED"],
		mostRecent: true,
	}).arn;
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
