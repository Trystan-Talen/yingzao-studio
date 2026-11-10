import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  creativeIntentRequestSchema,
  creativeIntentResultSchema,
} from '../src/contracts/creative-intent';
import { resolveCreativeStrategy } from '../src/contracts/creative-strategy';
import { compileCapturePrompt } from '../src/server/tasks/creative-capture';

it.each([
  [false, false],
  [false, true],
  [true, false],
  [true, true],
] as const)(
  'respects text support %s and the explicit user choice %s',
  (supportsText, needText) => {
    const fixture = JSON.parse(
      readFileSync('tests/fixtures/dify-intent-ready-missing-questions.json', 'utf8'),
    ) as { request: unknown; responseBody: { choices: { message: { content: string } }[] } };
    const request = creativeIntentRequestSchema.parse(fixture.request);
    request.context.supportsText = supportsText;
    const result = creativeIntentResultSchema.parse(
      JSON.parse(fixture.responseBody.choices[0]!.message.content),
    );
    const strategy = resolveCreativeStrategy({
      platform: result.brief.platform,
      placement: result.brief.placement,
      mediaType: result.brief.mediaType,
    });
    const prompt = compileCapturePrompt(result, request, strategy, needText)!;
    const addText = supportsText && needText;
    expect(prompt.startsWith(result.prompt)).toBe(true);
    for (const constraint of result.brief.constraints) expect(prompt).toContain(constraint);
    expect(prompt.endsWith('画面不添加文字、字幕或水印。')).toBe(!addText);
    expect(prompt.includes(`画面文字使用${request.context.language}`)).toBe(addText);
    expect(request.context.supportsText).toBe(supportsText);
  },
);
