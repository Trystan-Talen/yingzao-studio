import { expect, it } from 'vitest';
import { ESLint } from 'eslint';
import { resolve } from 'node:path';

const lint = new ESLint({ cwd: resolve('.') });
async function rules(source: string, filePath: string) {
  const [result] = await lint.lintText(source, { filePath });
  return result!.messages.map((message) => message.ruleId);
}

it('rejects an unhandled worker promise before it can leave a task running', async () => {
  expect(await rules('Promise.resolve(1);', 'src/worker/main.ts')).toContain(
    '@typescript-eslint/no-floating-promises',
  );
  expect(await rules('await Promise.resolve(1);', 'src/worker/main.ts')).toEqual([]);
});

it('keeps shared contracts and browser code independent of server implementations', async () => {
  expect(
    await rules("export { loadConfig } from '../../server/config';", 'src/web/lib/probe.ts'),
  ).toContain('no-restricted-imports');
  expect(
    await rules("export { loadConfig } from '../server/config';", 'src/contracts/probe.ts'),
  ).toContain('no-restricted-imports');
  expect(await rules("export { api } from '../web/lib/api';", 'src/contracts/probe.ts')).toContain(
    'no-restricted-imports',
  );
  expect(
    await rules("export { api } from '../../web/lib/api';", 'src/server/tasks/probe.ts'),
  ).toContain('no-restricted-imports');
});

it('rejects Node runtime imports in shipped browser code but permits local test fixtures', async () => {
  const source = "export { readFile } from 'node:fs/promises';";
  expect(await rules(source, 'src/web/lib/probe.ts')).toContain('no-restricted-imports');
  expect(
    await rules("export { readFile } from 'fs/promises';", 'src/contracts/probe.ts'),
  ).toContain('no-restricted-imports');
  expect(await rules(source, 'src/web/editor/probe.test.ts')).not.toContain(
    'no-restricted-imports',
  );
  expect(
    await rules("export type { JobInput } from '../../contracts/jobs';", 'src/web/lib/probe.ts'),
  ).toEqual([]);
});

it('rejects a focused committed test without banning command-line test selection', async () => {
  expect(
    await rules("import { it } from 'vitest'; it.only('case', () => {});", 'tests/probe.test.ts'),
  ).toContain('no-restricted-syntax');
  expect(
    await rules(
      "import { it } from 'vitest'; it.only.each([1])('case', () => {});",
      'tests/probe.test.ts',
    ),
  ).toContain('no-restricted-syntax');
  expect(
    await rules("import { it } from 'vitest'; it('case', () => {});", 'tests/probe.test.ts'),
  ).toEqual([]);
});
