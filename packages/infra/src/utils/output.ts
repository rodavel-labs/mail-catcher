/// <reference path="../../../../.sst/platform/config.d.ts" />

import type { createSesInbound } from "../ses-inbound";
import { writeDnsRecords } from "./dns-records";

interface BuildOutputsParams {
	api: sst.aws.Function;
	router?: sst.aws.Router;
	apiDomain?: string;
	emailBucket: sst.aws.Bucket;
	emailsTable: sst.aws.Dynamo;
	apiKeysTable: sst.aws.Dynamo;
	ses: ReturnType<typeof createSesInbound>;
	domain: string;
	hostedZoneId?: string;
}

export function buildOutputs({
	api,
	router,
	apiDomain,
	emailBucket,
	emailsTable,
	apiKeysTable,
	ses,
	domain,
	hostedZoneId,
}: BuildOutputsParams) {
	const outputs: Record<string, $util.Output<string>> = {
		apiUrl: router ? $interpolate`https://${apiDomain}` : api.url,
		bucketName: emailBucket.name,
		emailsTableName: emailsTable.name,
		apiKeysTableName: apiKeysTable.name,
	};

	if (!hostedZoneId) {
		outputs.dnsVerificationRecord = $interpolate`TXT _amazonses.${domain} ${ses.verificationToken}`;
		outputs.dnsMxRecord = $interpolate`MX ${domain} ${ses.mxRecord}`;
	}

	if (router && !hostedZoneId) {
		outputs.apiDomainCname = $interpolate`CNAME ${apiDomain} ${router.nodes.cdn.nodes.distribution.domainName}`;
	}

	const outputKeys = Object.keys(outputs);
	const outputValues = Object.values(outputs);

	$resolve(outputValues).apply((resolved) => {
		const resolvedMap: Record<string, string> = {};
		for (let i = 0; i < outputKeys.length; i++) {
			resolvedMap[outputKeys[i]] = resolved[i];
		}
		writeDnsRecords(resolvedMap);
	});

	return outputs;
}
