interface ParsedHeaders {
	messageId: string;
	from: string;
	to: string;
	subject: string;
}

/**
 * Extracts key headers from raw email content.
 * Only reads the header section (before the first blank line).
 */
export function parseEmailHeaders(raw: string): ParsedHeaders {
	const headerEnd = raw.indexOf("\r\n\r\n");
	const headerBlock = headerEnd > -1 ? raw.slice(0, headerEnd) : raw;

	const unfolded = headerBlock.replace(/\r?\n[ \t]+/g, " ");

	return {
		messageId: extractHeader(unfolded, "Message-ID") ?? "",
		from: extractHeader(unfolded, "From") ?? "",
		to: extractHeader(unfolded, "To") ?? "",
		subject: extractHeader(unfolded, "Subject") ?? "",
	};
}

function extractHeader(headers: string, name: string): string | undefined {
	const regex = new RegExp(`^${name}:\\s*(.+)$`, "im");
	return regex.exec(headers)?.[1]?.trim();
}

/**
 * Extracts the inbox (local part) from a recipient address
 * that matches the configured domain.
 */
export function extractInbox(recipient: string, domain: string): string | null {
	const match = recipient.match(
		new RegExp(`([^<\\s]+)@${domain.replace(/\./g, "\\.")}`, "i"),
	);
	return match?.[1]?.toLowerCase() ?? null;
}
