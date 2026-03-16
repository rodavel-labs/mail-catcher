import { z } from "zod";

const EnvSchema = z.object({
	SES_DOMAIN: z.string().min(1, "SES_DOMAIN is required"),
	MAX_ATTACHMENT_SIZE: z.coerce.number().positive().optional(),
	MAX_ATTACHMENTS: z.coerce.number().int().positive().optional(),
});

export const env = EnvSchema.parse(process.env);
