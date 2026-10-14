import { z } from 'zod';

const mailbox = z.string().trim().email().max(254);
const enabledSchema = z
  .object({
    enabled: z.literal(true),
    host: z
      .string()
      .trim()
      .min(1)
      .max(253)
      .regex(/^[a-zA-Z0-9.:[\]-]+$/),
    port: z.number().int().min(1).max(65535),
    tlsMode: z.enum(['implicit', 'starttls', 'local-test']),
    from: mailbox,
    fromName: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[^\r\n\u0000]+$/)
      .default('映造 Studio'),
    username: z.string().min(1).max(1024).optional(),
    password: z.string().min(1).max(4096).optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (Boolean(c.username) !== Boolean(c.password))
      ctx.addIssue({
        code: 'custom',
        message: 'SMTP authentication requires both username and password.',
      });
  });
export type SmtpConfig = { enabled: false } | z.infer<typeof enabledSchema>;
export function validateSmtpConfig(input: unknown, isProduction = false): SmtpConfig {
  if (
    input === undefined ||
    (typeof input === 'object' && input !== null && 'enabled' in input && input.enabled === false)
  )
    return { enabled: false };
  const parsed = enabledSchema.safeParse(input);
  if (!parsed.success)
    throw new Error(
      'SMTP configuration is invalid. Check host, port, TLS, sender and authentication.',
    );
  if (
    parsed.data.tlsMode === 'local-test' &&
    (isProduction || !['127.0.0.1', '::1'].includes(parsed.data.host))
  )
    throw new Error(
      'Unencrypted SMTP is restricted to non-production literal loopback test servers.',
    );
  return parsed.data;
}
export function readSmtpConfig(
  env: NodeJS.ProcessEnv,
  options: { isProduction: boolean },
): SmtpConfig {
  if (env.SMTP_ENABLED === undefined || env.SMTP_ENABLED === 'false') return { enabled: false };
  if (env.SMTP_ENABLED !== 'true') throw new Error('SMTP_ENABLED must be true or false.');
  // local-test is deliberately unavailable via environment configuration.
  const mode = env.SMTP_TLS_MODE ?? 'starttls';
  if (!['implicit', 'starttls'].includes(mode))
    throw new Error('SMTP_TLS_MODE must be implicit or starttls.');
  return validateSmtpConfig(
    {
      enabled: true,
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT ?? (mode === 'implicit' ? 465 : 587)),
      tlsMode: mode,
      from: env.SMTP_FROM,
      fromName: env.SMTP_FROM_NAME ?? '映造 Studio',
      username: env.SMTP_USER || undefined,
      password: env.SMTP_PASSWORD || undefined,
    },
    options.isProduction,
  );
}
