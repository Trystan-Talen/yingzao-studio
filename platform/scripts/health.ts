import 'dotenv/config';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';

const help =
  '用法：pnpm health\n读取 HOST（监听地址）与 PORT（端口），在 5 秒内检查服务；不初始化数据库或密钥。';
const settingsSchema = z.object({
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4310),
});

/** A health probe needs a network endpoint, never the application's key material. */
export function healthEndpoint(env: NodeJS.ProcessEnv): URL {
  const settings = settingsSchema.parse({ HOST: env.HOST, PORT: env.PORT });
  let host = settings.HOST;
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host === '0.0.0.0') host = '127.0.0.1';
  if (host === '::') host = '::1';
  if (isIP(host) === 6) host = `[${host}]`;
  else if (/[\s/\\:@?#\[\]]/.test(host)) throw new Error('HOST（监听地址）格式无效。');
  return new URL(`http://${host}:${settings.PORT}/api/v1/health`);
}

export async function checkHealth(args: string[], env: NodeJS.ProcessEnv = process.env) {
  if (args.length === 1 && args[0] === '--help') {
    console.info(help);
    return;
  }
  if (args.length) throw new Error(help);
  const response = await fetch(healthEndpoint(env), { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`健康检查返回 HTTP（响应状态）${response.status}。`);
  console.info(await response.text());
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  try {
    await checkHealth(process.argv.slice(2));
  } catch (error) {
    console.error(
      error instanceof Error && error.name === 'TimeoutError'
        ? '健康检查超过 5 秒，请检查服务是否正常。'
        : '健康检查失败；请检查 HOST（监听地址）、PORT（端口）与服务状态。使用 --help 查看用法。',
    );
    process.exitCode = 1;
  }
}
