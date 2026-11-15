import 'dotenv/config';
import { z } from 'zod';
import { resolve, join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { readSmtpConfig, type SmtpConfig } from './notifications/config';
import { readSupportConfig } from './support-config';
import type { SupportChannelsDto } from '../contracts/support';
import type { SmsConfig, WechatConfig } from './auth/identity/types';
import type { OpenAiImageGatewayConfig } from './providers/openai';
import type { LocalMattingConfig } from './providers/local-matting-installation';
import {
  ExportWatermarkConfigSchema,
  type ExportWatermarkConfig,
} from '../contracts/export-policy';
const schema = z.object({
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4310),
  PUBLIC_ORIGIN: z.string().url().default('http://127.0.0.1:5174'),
  DATABASE_PATH: z.string().optional(),
  STORAGE_DIR: z.string().optional(),
  MEDIA_DNS_MODE: z.enum(['system', 'public-doh']).default('system'),
  MEDIA_DOWNLOAD_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600000).default(120000),
  DEMO_MODE: z.enum(['true', 'false']).default('false'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOCAL_MATTING_INSTALLATION_DIR: z.string().trim().min(1).optional(),
  LOCAL_MATTING_WORK_DIR: z.string().trim().min(1).optional(),
  LOCAL_MATTING_HELPER_DIR: z.string().trim().min(1).optional(),
  SESSION_SECRET: z.string().optional(),
  ENCRYPTION_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  IMAGE_API_BASE_URL: z.string().url().optional(),
  IMAGE_MODEL: z.enum(['gpt-image-2', 'doubao-seedream-5.0-lite']).default('gpt-image-2'),
  DIFY_API_KEY: z.string().optional(),
  DIFY_API_BASE_URL: z.string().url().default('https://api.dify.ai/v1'),
  SEEDANCE_API_KEY: z.string().optional(),
  SEEDANCE_TASK_BASE_URL: z
    .string()
    .url()
    .default('https://xingyunyinli.com/doubao/api/v3/contents/generations/tasks'),
  SEEDANCE_MODEL: z.string().min(1).default('doubao-seedance-2.0'),
  FAL_KEY: z.string().optional(),
  FLYELEP_SECRET_KEY: z.string().optional(),
  TIKHUB_API_KEY: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  GOOGLE_OIDC_ENABLED: z.enum(['true', 'false']).default('false'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  PASSWORD_RECOVERY_ENABLED: z.enum(['true', 'false']).default('false'),
  SMS_AUTH_ENABLED: z.enum(['true', 'false']).default('false'),
  SMS_ALIYUN_ACCESS_KEY_ID: z.string().optional(),
  SMS_ALIYUN_ACCESS_KEY_SECRET: z.string().optional(),
  SMS_ALIYUN_SECURITY_TOKEN: z.string().optional(),
  SMS_SIGN_NAME: z.string().optional(),
  SMS_TEMPLATE_CODE: z.string().optional(),
  SMS_CODE_VARIABLE: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/)
    .default('code'),
  WECHAT_AUTH_ENABLED: z.enum(['true', 'false']).default('false'),
  WECHAT_APP_ID: z.string().optional(),
  WECHAT_APP_SECRET: z.string().optional(),
  EXPORT_WATERMARK_MODE: z.enum(['off', 'all', 'non-subscribers']).default('off'),
  EXPORT_WATERMARK_TEXT: z.string().default('映造 Studio'),
  EXPORT_WATERMARK_OPACITY: z.coerce.number().min(0.1).max(1).default(0.28),
});
export interface AppConfig {
  host: string;
  port: number;
  publicOrigin: string;
  databasePath: string;
  storageDir: string;
  mediaDnsMode?: 'system' | 'public-doh';
  mediaDownloadTimeoutMs?: number;
  sessionSecret: string;
  encryptionKey: string;
  isProduction: boolean;
  demoMode: boolean;
  localMatting?: LocalMattingConfig;
  environmentSecrets: Partial<
    Record<'openai' | 'fal' | 'flyelep' | 'tikhub' | 'dify' | 'seedance', string>
  >;
  imageGateway?: OpenAiImageGatewayConfig;
  dify?: { baseUrl: string };
  seedance?: { taskBaseUrl: string; model: string };
  billing?: { stripeSecretKey?: string; stripeWebhookSecret?: string };
  exportWatermark?: ExportWatermarkConfig;
  google?: { enabled: boolean; clientId?: string; clientSecret?: string };
  smtp?: SmtpConfig;
  passwordRecoveryEnabled?: boolean;
  sms?: SmsConfig;
  wechat?: WechatConfig;
  support?: SupportChannelsDto;
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const c = schema.parse(env);
  const production = c.NODE_ENV === 'production';
  const demo = c.DEMO_MODE === 'true';
  if (production && demo) throw new Error('Production cannot run DEMO_MODE.');
  if (production && (!c.SESSION_SECRET || !c.ENCRYPTION_KEY))
    throw new Error('Production requires SESSION_SECRET and ENCRYPTION_KEY.');
  if (production) {
    for (const value of [c.SESSION_SECRET!, c.ENCRYPTION_KEY!])
      if (Buffer.byteLength(value.trim(), 'utf8') < 32 || value !== value.trim())
        throw new Error(
          'Production secrets require at least 32 bytes with no surrounding whitespace; generate independent random values.',
        );
    if (c.SESSION_SECRET === c.ENCRYPTION_KEY)
      throw new Error('Production requires independent SESSION_SECRET and ENCRYPTION_KEY values.');
  }
  const origin = new URL(c.PUBLIC_ORIGIN);
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw new Error(
      'PUBLIC_ORIGIN must be an HTTP(S) origin without credentials, path, query, or fragment.',
    );
  if (
    production &&
    !c.PUBLIC_ORIGIN.startsWith('https://') &&
    !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)
  )
    throw new Error('Public production origin must use HTTPS.');
  let fallback = '';
  if (!c.SESSION_SECRET || !c.ENCRYPTION_KEY) {
    mkdirSync('var', { recursive: true, mode: 0o700 });
    const localKey = join('var', '.installation-key');
    if (!existsSync(localKey)) {
      try {
        writeFileSync(localKey, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      }
    }
    fallback = readFileSync(localKey, 'utf8').trim();
  }
  return {
    host: c.HOST,
    support: readSupportConfig(env),
    sms: {
      enabled: c.SMS_AUTH_ENABLED === 'true',
      accessKeyId: c.SMS_ALIYUN_ACCESS_KEY_ID,
      accessKeySecret: c.SMS_ALIYUN_ACCESS_KEY_SECRET,
      securityToken: c.SMS_ALIYUN_SECURITY_TOKEN,
      signName: c.SMS_SIGN_NAME,
      templateCode: c.SMS_TEMPLATE_CODE,
      codeVariable: c.SMS_CODE_VARIABLE,
    },
    wechat: {
      enabled: c.WECHAT_AUTH_ENABLED === 'true',
      appId: c.WECHAT_APP_ID,
      appSecret: c.WECHAT_APP_SECRET,
    },
    port: c.PORT,
    publicOrigin: c.PUBLIC_ORIGIN,
    databasePath: resolve(c.DATABASE_PATH || (demo ? 'var/demo.sqlite' : 'var/app.sqlite')),
    storageDir: resolve(c.STORAGE_DIR || (demo ? 'var/demo-media' : 'var/media')),
    mediaDnsMode: c.MEDIA_DNS_MODE,
    mediaDownloadTimeoutMs: c.MEDIA_DOWNLOAD_TIMEOUT_MS,
    sessionSecret: c.SESSION_SECRET || fallback,
    encryptionKey: c.ENCRYPTION_KEY || fallback,
    isProduction: production,
    demoMode: demo,
    ...(c.LOCAL_MATTING_INSTALLATION_DIR
      ? {
          localMatting: {
            installationDir: resolve(c.LOCAL_MATTING_INSTALLATION_DIR),
            workDir: resolve(c.LOCAL_MATTING_WORK_DIR || 'var/local-matting-work'),
            ...(c.LOCAL_MATTING_HELPER_DIR
              ? { helperDir: resolve(c.LOCAL_MATTING_HELPER_DIR) }
              : {}),
          },
        }
      : {}),
    environmentSecrets: {
      openai: c.OPENAI_API_KEY,
      dify: c.DIFY_API_KEY,
      seedance: c.SEEDANCE_API_KEY,
      fal: c.FAL_KEY,
      flyelep: c.FLYELEP_SECRET_KEY,
      tikhub: c.TIKHUB_API_KEY,
    },
    imageGateway: c.IMAGE_API_BASE_URL
      ? c.IMAGE_MODEL === 'doubao-seedream-5.0-lite'
        ? { baseUrl: c.IMAGE_API_BASE_URL, model: c.IMAGE_MODEL, size: '2048x2048' }
        : { baseUrl: c.IMAGE_API_BASE_URL, model: c.IMAGE_MODEL, quality: 'low', size: '1024x1024' }
      : undefined,
    dify: { baseUrl: c.DIFY_API_BASE_URL },
    seedance: { taskBaseUrl: c.SEEDANCE_TASK_BASE_URL, model: c.SEEDANCE_MODEL },
    billing: { stripeSecretKey: c.STRIPE_SECRET_KEY, stripeWebhookSecret: c.STRIPE_WEBHOOK_SECRET },
    google: {
      enabled: c.GOOGLE_OIDC_ENABLED === 'true',
      clientId: c.GOOGLE_CLIENT_ID,
      clientSecret: c.GOOGLE_CLIENT_SECRET,
    },
    smtp: readSmtpConfig(env, { isProduction: production }),
    passwordRecoveryEnabled: c.PASSWORD_RECOVERY_ENABLED === 'true',
    exportWatermark: ExportWatermarkConfigSchema.parse({
      mode: c.EXPORT_WATERMARK_MODE,
      text: c.EXPORT_WATERMARK_TEXT,
      opacity: c.EXPORT_WATERMARK_OPACITY,
    }),
  };
}
