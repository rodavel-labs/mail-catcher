/// <reference path="../../../.sst/platform/config.d.ts" />

import { env } from "./env";
import { createSesInbound } from "./ses-inbound";
import { buildOutputs } from "./utils/output";
import { createApiRouter } from "./utils/router";

export function createInfra() {
	const {
		SES_DOMAIN: domain,
		HOSTED_ZONE_ID: hostedZoneId,
		API_DOMAIN: apiDomain,
	} = env;

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
		handler: "apps/api/src/index.handler",
		url: true,
		timeout: "30 seconds",
		link: [emailsTable, emailBucket, apiKeysTable],
	});

	const router = apiDomain
		? createApiRouter(api, apiDomain, hostedZoneId)
		: undefined;

	emailBucket.notify({
		notifications: [
			{
				name: "IngestFn",
				function: {
					handler: "apps/ingest/src/ingest.handler",
					timeout: "30 seconds",
					link: [emailsTable, emailBucket],
					environment: {
						SES_DOMAIN: domain,
						...(env.MAX_ATTACHMENT_SIZE && {
							MAX_ATTACHMENT_SIZE: env.MAX_ATTACHMENT_SIZE,
						}),
						...(env.MAX_ATTACHMENTS && {
							MAX_ATTACHMENTS: env.MAX_ATTACHMENTS,
						}),
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

	return buildOutputs({
		api,
		router,
		apiDomain,
		emailBucket,
		emailsTable,
		apiKeysTable,
		ses,
		domain,
		hostedZoneId,
	});
}
