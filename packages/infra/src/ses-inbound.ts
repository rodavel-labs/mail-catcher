/// <reference path="../../../.sst/platform/config.d.ts" />

interface SesInboundConfig {
	domain: string;
	hostedZoneId?: string;
	bucketArn: sst.aws.Bucket["arn"];
}

/**
 * Creates raw Pulumi resources for SES inbound email reception.
 * SST has no built-in support for SES receipt rules, so these are
 * created directly with @pulumi/aws.
 *
 * When `hostedZoneId` is provided, Route 53 DNS records (MX + verification TXT)
 * are created automatically. Otherwise, the required DNS records are returned
 * as outputs for manual setup in an external DNS provider.
 */
export function createSesInbound({
	domain,
	hostedZoneId,
	bucketArn,
}: SesInboundConfig) {
	const region = aws.getRegionOutput().name;

	const domainIdentity = new aws.ses.DomainIdentity("DomainIdentity", {
		domain,
	});

	if (hostedZoneId) {
		new aws.route53.Record("DomainVerification", {
			zoneId: hostedZoneId,
			name: $interpolate`_amazonses.${domain}`,
			type: "TXT",
			ttl: 300,
			records: [domainIdentity.verificationToken],
		});

		new aws.route53.Record("MxRecord", {
			zoneId: hostedZoneId,
			name: domain,
			type: "MX",
			ttl: 300,
			records: [$interpolate`10 inbound-smtp.${region}.amazonaws.com`],
		});
	}

	const ruleSet = new aws.ses.ReceiptRuleSet("InboundRuleSet", {
		ruleSetName: "mail-catcher-inbound",
	});

	new aws.ses.ActiveReceiptRuleSet("ActiveRuleSet", {
		ruleSetName: ruleSet.ruleSetName,
	});

	new aws.ses.ReceiptRule("CatchAllRule", {
		ruleSetName: ruleSet.ruleSetName,
		name: "catch-all",
		enabled: true,
		scanEnabled: true,
		recipients: [domain],
		s3Actions: [
			{
				bucketName: bucketArn.apply((arn: string) => arn.split(":").pop()!),
				objectKeyPrefix: "incoming/",
				position: 1,
			},
		],
	});

	return {
		verificationToken: domainIdentity.verificationToken,
		mxRecord: $interpolate`10 inbound-smtp.${region}.amazonaws.com`,
	};
}
