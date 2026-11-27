import type { ContextTrace } from '@/modules/observability/application/event-contracts/context-v1';

const integer = { type: 'integer', minimum: 0 };
const text = { type: 'string', minLength: 1, maxLength: 2048, pattern: '\\S' };
const object = (properties: Record<string, unknown>): object => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const ref = { candidateIndex: { ...integer, maximum: 63 }, sourceId: text, chunkId: text };
const rows = (properties: Record<string, unknown>): object => ({
  type: 'array',
  maxItems: 64,
  items: object(properties),
});
const skills = { type: 'array', maxItems: 64, uniqueItems: true, items: text };

export const contextEventSchema = object({
  kind: { const: 'context_built' },
  version: { const: 'rag-02-v1' },
  configurationHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  counter: { const: 'utf8-bytes-v1' },
  status: { enum: ['READY', 'EMPTY', 'INPUT_BUDGET_EXCEEDED'] },
  budget: object(
    Object.fromEntries(
      [
        'contextWindowTokens',
        'evidenceCapTokens',
        'safetyMarginTokens',
        'outputReserveTokens',
        'systemTokens',
        'systemChars',
        'schemaTokens',
        'inputTokens',
        'evidenceTokens',
        'evidenceAvailableTokens',
        'totalReservedTokens',
        'maxInputChars',
        'serializedInputChars',
      ].map((key) => [key, integer]),
    ),
  ),
  coverage: object({
    targetSkillCodes: { ...skills, minItems: 1 },
    coveredSkillCodes: skills,
    uncoveredSkillCodes: skills,
  }),
  retrieved: rows(ref),
  selected: rows(ref),
  dropped: rows({
    ...ref,
    reason: {
      enum: [
        'DUPLICATE_CHUNK',
        'DUPLICATE_CONTENT',
        'OUT_OF_SCOPE',
        'TOKEN_BUDGET',
        'INPUT_CHAR_LIMIT',
        'FIXED_INPUT_BUDGET',
      ],
    },
  }),
});

export function validContextTrace(data: ContextTrace): boolean {
  const { budget, coverage } = data;
  const fixed =
    budget.systemTokens +
    budget.schemaTokens +
    budget.inputTokens +
    budget.outputReserveTokens +
    budget.safetyMarginTokens;
  const inputChars = budget.systemChars + budget.serializedInputChars;
  const hasSelection = data.selected.length > 0;
  const accounted = [...data.selected, ...data.dropped];
  const same = (left: readonly string[], right: readonly string[]): boolean =>
    left.length === right.length && left.every((value, index) => value === right[index]);

  const validLimits =
    budget.contextWindowTokens > 0 &&
    budget.maxInputChars > 0 &&
    budget.evidenceCapTokens > 0 &&
    budget.evidenceCapTokens <= budget.contextWindowTokens &&
    budget.outputReserveTokens > 0 &&
    budget.safetyMarginTokens > 0;

  if (!validLimits) {
    return false;
  }

  const availableTokens = Math.max(
    0,
    Math.min(budget.evidenceCapTokens, budget.contextWindowTokens - fixed),
  );
  const validTokenTotals =
    budget.totalReservedTokens === fixed + budget.evidenceTokens &&
    budget.evidenceAvailableTokens === availableTokens &&
    budget.evidenceTokens <= availableTokens;

  if (!validTokenTotals) {
    return false;
  }

  const fixedInputExceeded =
    fixed > budget.contextWindowTokens || inputChars > budget.maxInputChars;
  const withinBudget =
    budget.totalReservedTokens <= budget.contextWindowTokens && inputChars <= budget.maxInputChars;
  const validStatus =
    data.status === 'INPUT_BUDGET_EXCEEDED'
      ? !hasSelection && fixedInputExceeded
      : withinBudget && (data.status === 'READY') === hasSelection;

  if (!validStatus) {
    return false;
  }

  const validEmptySelection =
    hasSelection || (budget.evidenceTokens === 0 && coverage.coveredSkillCodes.length === 0);

  if (!validEmptySelection) {
    return false;
  }

  const validCandidateAccounting =
    accounted.length === data.retrieved.length &&
    new Set(accounted.map((row) => row.candidateIndex)).size === accounted.length &&
    new Set(data.selected.map((row) => row.chunkId)).size === data.selected.length &&
    data.retrieved.every((row, index) => row.candidateIndex === index) &&
    accounted.every((row) => {
      const original = data.retrieved[row.candidateIndex];
      return original?.sourceId === row.sourceId && original.chunkId === row.chunkId;
    });

  if (!validCandidateAccounting) {
    return false;
  }

  return (
    same(
      coverage.coveredSkillCodes,
      coverage.targetSkillCodes.filter((skill) => coverage.coveredSkillCodes.includes(skill)),
    ) &&
    same(
      coverage.uncoveredSkillCodes,
      coverage.targetSkillCodes.filter((skill) => !coverage.coveredSkillCodes.includes(skill)),
    )
  );
}
