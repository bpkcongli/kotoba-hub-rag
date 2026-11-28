import { createHash } from 'node:crypto';
import type { Requests } from '@/contracts/types';
import type { RubricBundle } from '@/modules/knowledge/application/public';
import {
  gradingInstructions,
  assessmentSchema,
} from '@/modules/rag/application/generation/grading';
import { generationInput } from '@/modules/rag/application/generation/input';
import { aiInstructions } from '@/modules/rag/application/generation/prompt';
import { operationSchema } from '@/modules/rag/application/generation/schema';
import type {
  BuiltContext,
  ContextConfig,
  ContextSource,
  ContextTrace,
  DropReason,
} from '@/modules/rag/domain/models/context';
import { ContextError } from '@/modules/rag/domain/models/context';
import type { Evidence } from '@/modules/rag/domain/models/evidence';
import type { ContextCandidate } from '@/modules/rag/domain/models/retrieval';
import type { Operation } from '@/shared/operations';

const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
const validSkills = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.length <= 64 &&
  value.every((skill: unknown) => typeof skill === 'string' && skill.trim().length > 0);

// Conservative local planning units, NOT measured provider tokens, BGE tokens or billable usage.
export const planningTokens = (text: string): number => Buffer.byteLength(text, 'utf8');

export function buildContext(
  config: ContextConfig,
  operation: Operation,
  request: Requests[Operation],
  candidates: readonly ContextCandidate[],
  targetSkillCodes: readonly string[],
  rubric?: RubricBundle | null,
): BuiltContext {
  const targets = [...new Set(targetSkillCodes)];
  const catalog = new Set(request.payload.context.catalog.map((skill) => skill.skillCode));

  if (
    request.mode === 'LLM_ONLY' ||
    candidates.length > 64 ||
    targets.length === 0 ||
    targets.length > 64 ||
    targets.some((skill) => !catalog.has(skill)) ||
    config.version !== 'rag-02-v1' ||
    config.counter !== 'utf8-bytes-v1' ||
    [
      config.contextWindowTokens,
      config.evidenceCapTokens,
      config.safetyMarginTokens,
      config.outputReserveTokens,
      config.maxInputChars,
    ].some((n) => !Number.isSafeInteger(n) || n < 1) ||
    config.evidenceCapTokens > config.contextWindowTokens
  ) {
    throw new ContextError('INVALID_INPUT');
  }

  const retrieved: ContextSource[] = candidates.map((row, candidateIndex) => ({
    candidateIndex,
    sourceId: row.sourceId,
    chunkId: row.chunkId,
  }));
  const dropped: (ContextSource & { reason: DropReason })[] = [];
  const unique: { row: ContextCandidate; ref: ContextSource }[] = [];
  const chunks = new Map<string, ContextCandidate>();
  const contents = new Set<string>();

  for (const [index, row] of candidates.entries()) {
    const ref = retrieved[index];
    if (
      !ref ||
      !row.sourceId?.trim() ||
      !row.chunkId?.trim() ||
      !row.text?.trim() ||
      row.text.length > 1048576 ||
      !Number.isFinite(row.score) ||
      row.contentChecksum !== hash(row.text) ||
      !validSkills(row.skillCodes)
    ) {
      throw new ContextError('INVALID_INPUT');
    }

    const previous = chunks.get(row.chunkId);
    if (
      previous &&
      (previous.contentChecksum !== row.contentChecksum ||
        previous.sourceId !== row.sourceId ||
        previous.jlptLevel !== row.jlptLevel ||
        JSON.stringify(previous.skillCodes) !== JSON.stringify(row.skillCodes))
    ) {
      throw new ContextError('INVALID_INPUT');
    }

    // Integrity applies even to candidates later dropped for scope or duplicate content.
    chunks.set(row.chunkId, row);

    const reason =
      row.jlptLevel !== request.payload.context.targetLevel ||
      !row.skillCodes.some((skill) => targets.includes(skill))
        ? 'OUT_OF_SCOPE'
        : previous
          ? 'DUPLICATE_CHUNK'
          : contents.has(row.contentChecksum)
            ? 'DUPLICATE_CONTENT'
            : null;

    if (reason) {
      dropped.push({ ...ref, reason });
      continue;
    }

    contents.add(row.contentChecksum);
    unique.push({ row, ref });
  }

  const instructions =
    operation === 'evaluate' && rubric ? gradingInstructions(rubric) : aiInstructions(operation);
  const schema = operation === 'evaluate' && rubric ? assessmentSchema : operationSchema(operation);
  const systemChars = instructions.length;
  const systemTokens = planningTokens(instructions);
  const schemaTokens = planningTokens(JSON.stringify(schema));
  const baseInput = generationInput(request, []);
  const inputTokens = planningTokens(baseInput);
  const fixed =
    systemTokens +
    schemaTokens +
    inputTokens +
    config.outputReserveTokens +
    config.safetyMarginTokens;
  const evidenceAvailableTokens = Math.max(
    0,
    Math.min(config.evidenceCapTokens, config.contextWindowTokens - fixed),
  );
  const overflow =
    fixed > config.contextWindowTokens || systemChars + baseInput.length > config.maxInputChars;
  const selected: ContextSource[] = [];
  const evidence: Evidence[] = [];
  const covered = new Set<string>();
  let evidenceTokens = 0;
  let serializedInputChars = baseInput.length;

  // Coverage first: each pass prefers the most uncovered targets; caller ranking breaks ties.
  // Scores from distinct retrieval/rerank stages are never compared or treated as confidence.
  while (unique.length) {
    let bestIndex = 0;
    let bestCoverage = -1;

    for (const [index, candidate] of unique.entries()) {
      const gain = new Set(
        candidate.row.skillCodes.filter((skill) => targets.includes(skill) && !covered.has(skill)),
      ).size;

      if (gain > bestCoverage) {
        bestIndex = index;
        bestCoverage = gain;
      }
    }

    const candidate = unique.splice(bestIndex, 1)[0];
    if (!candidate) {
      throw new ContextError('INVALID_INPUT');
    }

    const { row, ref } = candidate;
    const item: Evidence = {
      sourceId: row.sourceId,
      chunkId: row.chunkId,
      text: row.text,
      score: row.score,
      scoreType: row.scoreType,
      ...(row.rubric ? { rubric: row.rubric } : {}),
    };
    const packed = generationInput(request, [...evidence, item]);
    const nextTokens = planningTokens(packed) - inputTokens;
    const reason = overflow
      ? 'FIXED_INPUT_BUDGET'
      : nextTokens > evidenceAvailableTokens
        ? 'TOKEN_BUDGET'
        : systemChars + packed.length > config.maxInputChars
          ? 'INPUT_CHAR_LIMIT'
          : null;

    if (reason) {
      dropped.push({ ...ref, reason });
      continue;
    }

    evidence.push(item);
    selected.push(ref);
    evidenceTokens = nextTokens;
    serializedInputChars = packed.length;
    row.skillCodes
      .filter((skill) => targets.includes(skill))
      .forEach((skill) => covered.add(skill));
  }

  const status = overflow ? 'INPUT_BUDGET_EXCEEDED' : evidence.length ? 'READY' : 'EMPTY';
  const trace: ContextTrace = {
    kind: 'context_built',
    version: config.version,
    configurationHash: hash(JSON.stringify(config)),
    counter: config.counter,
    status,
    budget: {
      contextWindowTokens: config.contextWindowTokens,
      evidenceCapTokens: config.evidenceCapTokens,
      safetyMarginTokens: config.safetyMarginTokens,
      outputReserveTokens: config.outputReserveTokens,
      maxInputChars: config.maxInputChars,
      systemChars,
      systemTokens,
      schemaTokens,
      inputTokens,
      evidenceTokens,
      evidenceAvailableTokens,
      totalReservedTokens: fixed + evidenceTokens,
      serializedInputChars,
    },
    coverage: {
      targetSkillCodes: targets,
      coveredSkillCodes: targets.filter((skill) => covered.has(skill)),
      uncoveredSkillCodes: targets.filter((skill) => !covered.has(skill)),
    },
    retrieved,
    selected,
    dropped: dropped.sort((a, b) => a.candidateIndex - b.candidateIndex),
  };

  return {
    status,
    evidence,
    sources: selected.map((ref) => ({ source_id: ref.sourceId, chunk_id: ref.chunkId })),
    trace,
  };
}
