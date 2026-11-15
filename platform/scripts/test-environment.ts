import { delimiter, join, resolve } from 'node:path';

/** Shared test-tool boundary: inherit OS essentials, never application credentials,
 * Node injection options, arbitrary VITE_ fields, or the user's dotenv file. */
export function isolatedTestEnvironment(
  platformDirectory: string,
  supplied: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const root = resolve(platformDirectory);
  const env: NodeJS.ProcessEnv = {};
  for (const key of ['HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'SystemRoot', 'WINDIR'])
    if (supplied[key] !== undefined) env[key] = supplied[key];
  return {
    ...env,
    DOTENV_CONFIG_PATH: process.platform === 'win32' ? 'NUL' : '/dev/null',
    NO_COLOR: '1',
    PATH: [
      join(root, 'var', 'tools', 'native-media', 'bin'),
      // Retain the prior installation layout as a fallback for older checkouts.
      join(root, 'var', 'tools', 'ffmpeg-9.0.2-macos-arm64', 'bin'),
      supplied.PATH || '/usr/bin:/bin:/usr/sbin:/sbin',
    ].join(delimiter),
  };
}
