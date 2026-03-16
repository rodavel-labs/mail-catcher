import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { SES_DOMAIN } from "./config";

const client = new SESv2Client();

interface Attachment {
	content: string;
	filename: string;
	contentType?: string;
}

interface SendOpts {
	inbox: string;
	subject?: string;
	html?: string;
	from?: string;
	attachments?: Attachment[];
}

function buildMimeMessage(opts: {
	from: string;
	to: string;
	subject: string;
	html: string;
	attachments?: Attachment[];
}): string {
	const boundary = `----=_Part_${Date.now()}`;
	const lines: string[] = [];

	lines.push(`From: ${opts.from}`);
	lines.push(`To: ${opts.to}`);
	lines.push(`Subject: ${opts.subject}`);
	lines.push("MIME-Version: 1.0");

	if (opts.attachments?.length) {
		lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
		lines.push("");
		lines.push(`--${boundary}`);
		lines.push("Content-Type: text/html; charset=UTF-8");
		lines.push("Content-Transfer-Encoding: 7bit");
		lines.push("");
		lines.push(opts.html);

		for (const att of opts.attachments) {
			lines.push(`--${boundary}`);
			lines.push(
				`Content-Type: ${att.contentType ?? "application/octet-stream"}; name="${att.filename}"`,
			);
			lines.push("Content-Transfer-Encoding: base64");
			lines.push(`Content-Disposition: attachment; filename="${att.filename}"`);
			lines.push("");
			lines.push(att.content);
		}

		lines.push(`--${boundary}--`);
	} else {
		lines.push("Content-Type: text/html; charset=UTF-8");
		lines.push("");
		lines.push(opts.html);
	}

	return lines.join("\r\n");
}

/** Sends an email to `<inbox>@<SES_DOMAIN>` via SES */
export async function sendEmail({
	inbox,
	subject = "Test email",
	html = "<p>This is a test email.</p>",
	from = `e2e@${SES_DOMAIN}`,
	attachments,
}: SendOpts) {
	const to = `${inbox}@${SES_DOMAIN}`;
	console.log(`Sending: "${subject}" → ${to}`);

	if (attachments?.length) {
		const raw = buildMimeMessage({ from, to, subject, html, attachments });
		const result = await client.send(
			new SendEmailCommand({
				Content: {
					Raw: { Data: new TextEncoder().encode(raw) },
				},
			}),
		);
		console.log(`Sent (messageId: ${result.MessageId})`);
		return result;
	}

	const result = await client.send(
		new SendEmailCommand({
			FromEmailAddress: from,
			Destination: { ToAddresses: [to] },
			Content: {
				Simple: {
					Subject: { Data: subject },
					Body: { Html: { Data: html } },
				},
			},
		}),
	);

	console.log(`Sent (messageId: ${result.MessageId})`);
	return result;
}
