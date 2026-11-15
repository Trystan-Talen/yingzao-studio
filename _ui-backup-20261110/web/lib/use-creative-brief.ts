import { useEffect, useRef, useState } from 'react';
import { creativeInputFingerprint } from '../../contracts/creative-fingerprint';
import type { CreativePreparation } from '../../contracts/creative-intent';
import { CREATIVE_INTENT_CLIENT_TIMEOUT_MS } from '../../contracts/creative-intent-timing';
import type { JobInput } from '../../contracts/jobs';
import { api, ApiError, CONFIRMATION_TIMEOUT_MS, errorMessage } from './api';
import {
  advanceCreativeBrief,
  checkCreativePreparation,
  creativeAnswersComplete,
  creativeBriefStorageKey,
  readCreativeBrief,
  updateCreativeAnswer,
  writeCreativeBrief,
  type CreativeBriefRecord,
} from './creative-brief';

interface Entry {
  key: string;
  record: CreativeBriefRecord;
  preparation?: CreativePreparation;
  restoring?: Promise<void>;
  busy?: boolean;
  error?: string;
  errorCode?: string;
  missingQuestionId?: string;
  focusRequest?: number;
}

/** Keep the paid request ID before sending, and only read saved results on mount. */
export function useCreativeBrief({
  input,
  recoveryInput,
  userId,
  workspaceId,
}: {
  input: JobInput;
  recoveryInput?: JobInput;
  userId: string;
  workspaceId: string;
}) {
  const fingerprint = creativeInputFingerprint(input);
  const cacheKey = creativeBriefStorageKey(userId, workspaceId, fingerprint, input.projectId);
  const latest = useRef(cacheKey);
  latest.current = cacheKey;
  const entries = useRef(new Map<string, Entry>());
  const mounted = useRef(true);
  const [, redraw] = useState(0);
  const [loadError, setLoadError] = useState<{ key: string; message: string }>();
  const notify = () => {
    if (mounted.current) redraw((value) => value + 1);
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function entryFor(value: JobInput): Entry {
    const identity = creativeInputFingerprint(value);
    const key = creativeBriefStorageKey(userId, workspaceId, identity, value.projectId);
    const cached = entries.current.get(key);
    if (cached) return cached;
    let record: CreativeBriefRecord;
    try {
      record = readCreativeBrief(localStorage, key, identity);
    } catch {
      throw new Error('无法恢复需求检查记录，请检查浏览器存储后重试。原话仍保留在创作框。');
    }
    // A server draft may be opened on a different browser with no local record.
    if (
      !record.previousId &&
      recoveryInput?.creativeBriefId &&
      (!recoveryInput.projectId || recoveryInput.projectId === value.projectId) &&
      creativeInputFingerprint(recoveryInput) === identity
    )
      record.previousId = recoveryInput.creativeBriefId;
    const entry: Entry = {
      key,
      record,
      error: record.pending ? '上次需求检查结果尚未确认，点击生成可恢复同一次检查。' : undefined,
    };
    entries.current.set(key, entry);
    return entry;
  }

  function persist(entry: Entry, record: CreativeBriefRecord) {
    try {
      writeCreativeBrief(localStorage, entry.key, record);
    } catch {
      throw new Error('无法保存需求检查记录，本次未继续生成。请检查浏览器存储后重试，原话仍保留。');
    }
    entry.record = record;
  }

  async function restore(entry: Entry, value: JobInput) {
    if (!entry.record.previousId || entry.preparation || entry.record.pending) return;
    if (entry.restoring) return entry.restoring;
    entry.busy = true;
    entry.error = undefined;
    notify();
    entry.restoring = (async () => {
      try {
        const data = await api<CreativePreparation>(
          `/creative-briefs/${entry.record.previousId}`,
          {
            timeoutMs: CONFIRMATION_TIMEOUT_MS,
          },
          workspaceId,
        );
        // Old draft IDs must never be applied to a changed prompt or material selection.
        if (
          creativeInputFingerprint(data.input) !== entry.record.fingerprint ||
          (data.input.projectId && data.input.projectId !== value.projectId)
        ) {
          persist(entry, { version: 1, fingerprint: entry.record.fingerprint, answers: [] });
          return;
        }
        entry.preparation = checkCreativePreparation(data, value);
      } catch (error) {
        entry.error = errorMessage(error);
        entry.errorCode = error instanceof ApiError ? error.code : undefined;
        throw error;
      } finally {
        entry.busy = false;
        entry.restoring = undefined;
        notify();
      }
    })();
    return entry.restoring;
  }

  useEffect(() => {
    try {
      const entry = entryFor(input);
      setLoadError(undefined);
      notify();
      void restore(entry, input).catch(() => undefined);
    } catch (error) {
      setLoadError({ key: cacheKey, message: errorMessage(error) });
    }
  }, [cacheKey, recoveryInput, userId, workspaceId]);

  async function prepare(value: JobInput): Promise<JobInput | null> {
    const identity = creativeInputFingerprint(value);
    const requestKey = creativeBriefStorageKey(userId, workspaceId, identity, value.projectId);
    let entry: Entry | undefined;
    try {
      entry = entryFor(value);
      await restore(entry, value);
      if (!mounted.current || latest.current !== requestKey) return null;
      setLoadError(undefined);
      entry.error = undefined;
      entry.errorCode = undefined;
      const existing = entry.preparation;
      if (!entry.record.pending && existing?.status === 'ready')
        return { ...value, creativeBriefId: existing.id };
      if (
        !entry.record.pending &&
        existing &&
        !creativeAnswersComplete(existing, entry.record.answers)
      ) {
        entry.missingQuestionId = existing.result.questions.find(
          (question) =>
            !entry!.record.answers.some(
              (answer) => answer.questionId === question.id && !!answer.answer.trim(),
            ),
        )?.id;
        entry.focusRequest = (entry.focusRequest ?? 0) + 1;
        notify();
        return null;
      }
      entry.missingQuestionId = undefined;
      if (!entry.record.pending) {
        persist(entry, {
          ...entry.record,
          pending: {
            requestId: crypto.randomUUID(),
            previousId: entry.record.previousId,
            answers: entry.record.answers,
          },
        });
      }
      entry.busy = true;
      entry.error = undefined;
      notify();
      const request = entry.record.pending!;
      const data = await api<CreativePreparation>(
        '/creative-briefs/prepare',
        {
          method: 'POST',
          body: JSON.stringify({ ...request, input: value }),
          timeoutMs: CREATIVE_INTENT_CLIENT_TIMEOUT_MS,
        },
        workspaceId,
      );
      const result = checkCreativePreparation(data, value);
      if (result.result.requestId !== request.requestId)
        throw new Error('需求检查返回了其他请求的结果，请重试本次检查。');
      // Save even a late response under its own fingerprint, so revisiting that
      // draft can recover the result without paying for an identical request.
      persist(entry, advanceCreativeBrief(entry.record, result));
      entry.preparation = result;
      entry.missingQuestionId = undefined;
      if (!mounted.current || latest.current !== requestKey || result.status !== 'ready')
        return null;
      return { ...value, creativeBriefId: result.id };
    } catch (error) {
      if (entry) {
        entry.error = errorMessage(error);
        entry.errorCode = error instanceof ApiError ? error.code : undefined;
      } else if (mounted.current) setLoadError({ key: requestKey, message: errorMessage(error) });
      throw error;
    } finally {
      if (entry) entry.busy = false;
      notify();
    }
  }

  function answer(questionId: string, value: string) {
    const entry = entries.current.get(cacheKey);
    if (!entry || entry.busy || entry.record.pending) return;
    try {
      persist(entry, {
        ...entry.record,
        answers: updateCreativeAnswer(entry.record.answers, questionId, value),
      });
      entry.error = undefined;
      if (entry.missingQuestionId === questionId && value.trim())
        entry.missingQuestionId = undefined;
    } catch (error) {
      entry.error = errorMessage(error);
    }
    notify();
  }

  function bindProject(projectId: string) {
    // Only a just-created project may inherit an unbound preparation.
    if (input.projectId) return;
    const source = entries.current.get(cacheKey);
    if (!source || (!source.preparation && !source.record.previousId && !source.record.pending))
      return;
    const key = creativeBriefStorageKey(userId, workspaceId, fingerprint, projectId);
    const bound = { ...source, key };
    entries.current.set(key, bound);
    try {
      persist(bound, bound.record);
    } catch (error) {
      bound.error = errorMessage(error);
      throw error;
    } finally {
      notify();
    }
  }

  function restart() {
    const entry = entries.current.get(cacheKey);
    if (!entry || entry.busy || entry.errorCode !== 'CREATIVE_BRIEF_FAILED') return;
    try {
      persist(entry, { ...entry.record, pending: undefined });
      entry.error = undefined;
      entry.errorCode = undefined;
      // Reading the prior question set is free; a new preparation still needs a click.
      void restore(entry, input).catch(() => undefined);
    } catch (error) {
      entry.error = errorMessage(error);
    }
    notify();
  }

  const current = entries.current.get(cacheKey);
  return {
    prepare,
    bindProject,
    restart,
    canRestart: current?.errorCode === 'CREATIVE_BRIEF_FAILED' && !!current.record.pending,
    answer,
    preparation: current?.preparation,
    answers: current?.record.answers ?? [],
    busy: !!current?.busy,
    locked: !!current?.busy || !!current?.record.pending,
    missingQuestionId: current?.missingQuestionId,
    focusRequest: current?.focusRequest ?? 0,
    error: current?.error ?? (loadError?.key === cacheKey ? loadError.message : undefined),
    briefId: current
      ? (current.preparation?.id ?? current.record.previousId)
      : recoveryInput &&
          (!recoveryInput.projectId || recoveryInput.projectId === input.projectId) &&
          creativeInputFingerprint(recoveryInput) === fingerprint
        ? recoveryInput.creativeBriefId
        : undefined,
  };
}
