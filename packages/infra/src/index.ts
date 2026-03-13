/// <reference path="../../../.sst/platform/config.d.ts" />

import { createSesInbound } from "./ses-inbound";

export function createInfra() {
	const domain = process.env.SES_DOMAIN;
	const hostedZoneId = process.env.HOSTED_ZONE_ID;

	if (!domain) {
		throw new Error("SES_DOMAIN must be set in .env");
	}

	const emailBucket = new sst.aws.Bucket("EmailBucket", {
		lifecycle: [
			{
				prefix: "incoming/",
				expiresIn: "8 days",
			},
			{
				prefix: "attachments/",
				expiresIn: "8 days",
			},
		],
		transform: {
			policy: (args) => {
				args.policy = sst.aws.iamEdit(args.policy, (policy) => {
					policy.Statement.push({
						Effect: "Allow",
						Principal: { Service: "ses.amazonaws.com" },
						Action: "s3:PutObject",
						Resource: $interpolate`arn:aws:s3:::${args.bucket}/incoming/*`,
						Condition: {
							StringEquals: {
								"AWS:SourceAccount": aws.getCallerIdentityOutput().accountId,
							},
						},
					});
				});
			},
		},
	});

	const emailsTable = new sst.aws.Dynamo("EmailsTable", {
		fields: {
			PK: "string",
			SK: "string",
			messageId: "string",
		},
		primaryIndex: { hashKey: "PK", rangeKey: "SK" },
		globalIndexes: {
			MessageIdIndex: { hashKey: "messageId" },
		},
		ttl: "ttl",
	});

	const apiKeysTable = new sst.aws.Dynamo("ApiKeysTable", {
		fields: {
			keyHash: "string",
		},
		primaryIndex: { hashKey: "keyHash" },
	});

	const api = new sst.aws.Function("Api", {
		handler: "packages/api/src/index.handler",
		url: true,
		timeout: "30 seconds",
		link: [emailsTable, emailBucket, apiKeysTable],
	});

	emailBucket.notify({
		notifications: [
			{
				name: "IngestFn",
				function: {
					handler: "packages/api/src/ingest.handler",
					timeout: "30 seconds",
					link: [emailsTable, emailBucket],
					environment: {
						SES_DOMAIN: domain,
					},
				},
				events: ["s3:ObjectCreated:*"],
				filterPrefix: "incoming/",
			},
		],
	});

	const ses = createSesInbound({
		domain,
		hostedZoneId,
		bucketArn: emailBucket.arn,
	});

	return {
		apiUrl: api.url,
		bucketName: emailBucket.name,
		emailsTableName: emailsTable.name,
		apiKeysTableName: apiKeysTable.name,
		...(!hostedZoneId && {
			dnsVerificationRecord: $interpolate`TXT _amazonses.${domain} ${ses.verificationToken}`,
			dnsMxRecord: $interpolate`MX ${domain} ${ses.mxRecord}`,
		}),
	};
}
