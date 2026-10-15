import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
const messageSchema = z
  .object({
    to: z.string().email().max(254),
    from: z.string().email().max(254),
    fromName: z.string().min(1).max(100),
    subject: z.string().min(1).max(200),
    text: z.string().min(1).max(20000),
    html: z.string().min(1).max(40000),
    userId: z.string().uuid().nullable(),
  })
  .strict();
export type MailMessage = z.infer<typeof messageSchema>;
export function sealMessage(message: MailMessage, secret: string, aad: string): string {
  const key = createHash('sha256').update('yingzao-mail-outbox-v1\0').update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(messageSchema.parse(message)), 'utf8'),
    cipher.final(),
  ]);
  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    encrypted.toString('base64'),
  ].join('.');
}
export function openMessage(value: string, secret: string, aad: string): MailMessage {
  const [version, iv, tag, body, ...rest] = value.split('.');
  if (version !== 'v1' || !iv || !tag || !body || rest.length)
    throw new Error('Mail payload cannot be decoded.');
  const key = createHash('sha256').update('yingzao-mail-outbox-v1\0').update(secret).digest();
  const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  cipher.setAAD(Buffer.from(aad));
  cipher.setAuthTag(Buffer.from(tag, 'base64'));
  return messageSchema.parse(
    JSON.parse(
      Buffer.concat([cipher.update(Buffer.from(body, 'base64')), cipher.final()]).toString('utf8'),
    ),
  );
}
const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function mailTemplate(input: {
  to: string;
  from: string;
  fromName: string;
  userId: string | null;
  kind: 'invitation' | 'notification' | 'support-reply';
  workspaceName: string;
  url: string;
  expiresAt?: string;
}): MailMessage {
  const heading =
    input.kind === 'invitation'
      ? '团队邀请'
      : input.kind === 'support-reply'
        ? '工单有新回复'
        : '站内通知更新';
  const lead =
    input.kind === 'invitation'
      ? `您收到了工作空间「${input.workspaceName}」的加入邀请。`
      : `工作空间「${input.workspaceName}」有新的${input.kind === 'support-reply' ? '工单回复' : '通知'}，请登录查看详情。`;
  const expiry = input.expiresAt
    ? `邀请有效期至 ${input.expiresAt}；已使用、撤销或过期的邀请不可再用。`
    : '';
  return messageSchema.parse({
    to: input.to,
    from: input.from,
    fromName: input.fromName,
    userId: input.userId,
    subject: `映造 Studio · ${heading}`,
    text: [lead, expiry, input.url, '如非您预期的通知，可忽略本邮件。请勿向他人转发邀请链接。']
      .filter(Boolean)
      .join('\n\n'),
    html: `<!doctype html><html lang="zh-CN"><body><h1>${heading}</h1><p>${escapeHtml(lead)}</p>${expiry ? `<p>${escapeHtml(expiry)}</p>` : ''}<p><a href="${escapeHtml(input.url)}">${input.kind === 'invitation' ? '查看团队邀请' : '登录查看详情'}</a></p><p>如非您预期的通知，可忽略本邮件。请勿向他人转发邀请链接。</p></body></html>`,
  });
}
