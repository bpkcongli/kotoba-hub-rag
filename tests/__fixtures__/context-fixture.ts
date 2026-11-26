import { createHash } from 'node:crypto';

import { config, requestFor } from '@tests/__fixtures__/generation-fixture';
import { readContextConfig } from '@/context/config';
import type { ContextConfig } from '@/context/types';
import type { Operation, Requests } from '@/contracts/validator';
import type { RetrievedEvidence } from '@/retrieval/types';

export const skill = 'synthetic_copula';
export const secondSkill = 'synthetic_particle';

export function ragRequest<K extends Operation>(operation: K): Requests[K] {
  const request = requestFor(operation);
  request.mode = 'SINGLE_STAGE';
  request.payload.context.catalog.push({
    skillCode: secondSkill,
    title: 'Particle',
    lessonSlug: 'synthetic-lesson',
    unitSlug: 'synthetic-unit',
    trackSlug: 'synthetic-track',
  });

  return request;
}

export function contextConfig(overrides: Partial<ContextConfig> = {}): ContextConfig {
  return { ...readContextConfig({}, config()), ...overrides };
}

export function candidate(
  id: number,
  skills: readonly string[] = [skill],
  text = `文法：名詞＋です。\n例：学生です。\n説明：丁寧な表現です。 ${id}`,
  overrides: Partial<RetrievedEvidence> = {},
): RetrievedEvidence {
  return {
    pointId: String(id),
    chunkId: `chunk-${id}`,
    sourceId: `source-${id}`,
    parentId: 'parent',
    rank: id,
    score: 1 / id,
    scoreType: 'cosine',
    skillCodes: skills,
    jlptLevel: 'JLPT_N5',
    locale: 'JA',
    lessonSlug: 'synthetic-lesson',
    unitSlug: 'synthetic-unit',
    trackSlug: 'synthetic-track',
    text,
    contentChecksum: createHash('sha256').update(text).digest('hex'),
    tokenCount: 1,
    ...overrides,
  };
}
