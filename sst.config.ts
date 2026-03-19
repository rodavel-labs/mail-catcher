/// <reference path="./.sst/platform/config.d.ts" />

const SES_INBOUND_REGIONS = ["us-east-1", "us-west-2", "eu-west-1"];

const region = process.env.AWS_REGION ?? "us-east-1";
if (!SES_INBOUND_REGIONS.includes(region)) {
	throw new Error(
		`AWS_REGION "${region}" does not support SES inbound. Use one of: ${SES_INBOUND_REGIONS.join(", ")}`,
	);
}

export default $config({
	app(input) {
		return {
			name: "mail-catcher",
			home: "aws",
			providers: {
				aws: {
					profile: process.env.AWS_PROFILE,
					region,
				},
			},
			removal: input?.stage === "prod" ? "retain" : "remove",
		};
	},
	async run() {
		$transform(sst.aws.Function, (args) => {
			args.runtime ??= "nodejs24.x";
		});
		const { createInfra } = await import("@rodavel/mail-catcher-infra");
		return createInfra();
	},
});
