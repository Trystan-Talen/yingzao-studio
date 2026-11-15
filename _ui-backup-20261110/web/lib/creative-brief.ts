import { z } from 'zod';
import { creativeInputFingerprint } from '../../contracts/creative-fingerprint';
import {
  creativeAnswerSchema,
  creativeIntentResultSchema,
  type CreativeAnswer,
  type CreativePreparation,
} from '../../contracts/creative-intent';
import { jobInputSchema, type JobInput } from '../../contracts/jobs';
import type { RecoveryStorage } from './creation-recovery';

const recordSchema = z.object({
  version: z.literal(1),
  fingerprint: z.string(),
  previousId: z.string().uuid().optional(),
  answers: z.array(creativeAnswerSchema).max(12),
  pending: z
    .object({
      requestId: z.string().uuid(),
      previousId: z.string().uuid().optional(),
      answers: z.array(creativeAnswerSchema).max(12),
    })
    .optional(),
});
export type CreativeBriefRecord = z.infer<typeof recordSchema>;

/** Answers belong to one question set; previousId carries the server-side history. */
export function advanceCreativeBrief(
  record: CreativeBriefRecord,
  preparation: CreativePreparation,
): CreativeBriefRecord {
  return { ...record, previousId: preparation.id, pending: undefined, answers: [] };
}

export function creativeBriefStorageKey(
  userId: string,
  workspaceId: string,
  fingerprint: string,
  projectId?: string,
) {
  return `yingzao:creative-brief:v1:${userId}:${workspaceId}:${projectId ?? 'new'}:${fingerprint}`;
}

export function readCreativeBrief(storage: RecoveryStorage, key: string, fingerprint: string) {
  const raw = storage.getItem(key);
  if (!raw) return { version: 1 as const, fingerprint, answers: [] };
  const record = recordSchema.parse(JSON.parse(raw));
  if (record.fingerprint !== fingerprint) throw new Error('需求检查记录与当前内容不一致。');
  return record;
}

export function writeCreativeBrief(
  storage: RecoveryStorage,
  key: string,
  record: CreativeBriefRecord,
) {
  storage.setItem(key, JSON.stringify(recordSchema.parse(record)));
}

export function updateCreativeAnswer(
  answers: CreativeAnswer[],
  questionId: string,
  answer: string,
) {
  const others = answers.filter((item) => item.questionId !== questionId);
  return answer.trim() ? [...others, { questionId, answer }] : others;
}

export function creativeAnswersComplete(
  preparation: CreativePreparation,
  answers: CreativeAnswer[],
) {
  return preparation.result.questions.every((question) =>
    answers.some((answer) => answer.questionId === question.id && !!answer.answer.trim()),
  );
}

const preparationSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['ready', 'needs_clarification']),
  result: creativeIntentResultSchema,
  input: jobInputSchema,
});
export function checkCreativePreparation(value: unknown, input: JobInput): CreativePreparation {
  const result = preparationSchema.parse(value);
  if (
    result.status !== result.result.status ||
    result.input.creativeBriefId !== result.id ||
    (!!result.input.projectId && result.input.projectId !== input.projectId) ||
    creativeInputFingerprint(result.input) !== creativeInputFingerprint(input)
  )
    throw new Error('需求检查结果与当前内容不一致，请重新检查。');
  return result;
}
