import { parseArgs } from "node:util";
import { sendEmail } from "./core/ses";

const { values } = parseArgs({
	args: process.argv.slice(2),
	options: {
		inbox: { type: "string", short: "i" },
		subject: { type: "string", short: "s" },
		from: { type: "string", short: "f" },
		html: { type: "string" },
	},
});

const inbox = values.inbox ?? "anything";

await sendEmail({
	inbox,
	subject: values.subject,
	from: values.from,
	html: values.html,
});
