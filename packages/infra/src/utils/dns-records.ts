import { writeFileSync } from "node:fs";
import { join } from "node:path";

interface DnsRecord {
	type: string;
	name: string;
	value: string;
	priority?: string;
}

function parseDnsRecords(outputs: Record<string, string>): DnsRecord[] {
	const records: DnsRecord[] = [];

	if (outputs.dnsVerificationRecord) {
		const [, name, ...rest] = outputs.dnsVerificationRecord.split(" ");
		records.push({ type: "TXT", name, value: rest.join(" ") });
	}

	if (outputs.dnsMxRecord) {
		const [, name, priority, value] = outputs.dnsMxRecord.split(" ");
		records.push({ type: "MX", name, value, priority });
	}

	if (outputs.apiDomainCname) {
		const [, name, value] = outputs.apiDomainCname.split(" ");
		records.push({ type: "CNAME", name, value });
	}

	return records;
}

function fqdn(name: string): string {
	return name.endsWith(".") ? name : `${name}.`;
}

function toBind(record: DnsRecord): string {
	const ttl = 300;

	switch (record.type) {
		case "TXT":
			return `${fqdn(record.name)}\t${ttl}\tIN\tTXT\t"${record.value}"`;
		case "MX":
			return `${fqdn(record.name)}\t${ttl}\tIN\tMX\t${record.priority}\t${fqdn(record.value)}`;
		case "CNAME":
			return `${fqdn(record.name)}\t${ttl}\tIN\tCNAME\t${fqdn(record.value)}`;
		default:
			return `${fqdn(record.name)}\t${ttl}\tIN\t${record.type}\t${record.value}`;
	}
}

/**
 * Writes DNS records as a BIND zone file importable by Cloudflare and similar providers.
 * Only writes if there are DNS records in the outputs (i.e. external DNS mode).
 */
export function writeDnsRecords(outputs: Record<string, string>) {
	const records = parseDnsRecords(outputs);
	if (records.length === 0) return;

	const zonePath = join(process.cwd(), ".sst", "dns-records.zone");
	const zone = records.map(toBind).join("\n");

	writeFileSync(zonePath, zone);
	console.log(`\n  DNS records written to .sst/dns-records.zone`);
}
