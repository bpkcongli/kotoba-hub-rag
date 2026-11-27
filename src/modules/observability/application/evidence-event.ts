import type { EvidenceAssessment } from '@/modules/observability/application/event-contracts/evidence-v1';

const count = { type: 'integer', minimum: 0, maximum: 64 };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const properties = {
  kind: { const: 'evidence_assessed' },
  policyVersion: { const: 'rag-03-evidence-v1' },
  queryPolicyVersion: { const: 'rag-03-query-v1' },
  configurationHash: hash,
  contextConfigurationHash: hash,
  minUniqueChunks: { ...count, minimum: 1 },
  minCoveredSkills: { ...count, minimum: 1 },
  retrievedCount: count,
  selectedCount: count,
  targetSkillCount: { ...count, minimum: 1 },
  coveredSkillCount: count,
  decision: { enum: ['ACCEPT', 'REJECT'] },
  reasons: {
    type: 'array',
    maxItems: 5,
    uniqueItems: true,
    items: {
      enum: [
        'EMPTY_RETRIEVAL',
        'EMPTY_CONTEXT',
        'FIXED_INPUT_BUDGET',
        'TOO_FEW_UNIQUE_CHUNKS',
        'TOO_FEW_COVERED_SKILLS',
      ],
    },
  },
};

export const evidenceEventSchema = {
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
};

export function validEvidenceAssessment(data: EvidenceAssessment): boolean {
  const reasons = new Set(data.reasons);
  const enoughChunks = data.selectedCount >= data.minUniqueChunks;
  const enoughSkills = data.coveredSkillCount >= data.minCoveredSkills;
  const emptyContext = reasons.has('EMPTY_CONTEXT');
  const fixedOverflow = reasons.has('FIXED_INPUT_BUDGET');

  const validCounts =
    data.selectedCount <= data.retrievedCount &&
    data.coveredSkillCount <= data.targetSkillCount &&
    (data.selectedCount > 0 || data.coveredSkillCount === 0);

  if (!validCounts) {
    return false;
  }

  const validThresholdReasons =
    reasons.has('EMPTY_RETRIEVAL') === (data.retrievedCount === 0) &&
    reasons.has('TOO_FEW_UNIQUE_CHUNKS') === !enoughChunks &&
    reasons.has('TOO_FEW_COVERED_SKILLS') === !enoughSkills;

  if (!validThresholdReasons || (emptyContext && fixedOverflow)) {
    return false;
  }

  const validContextReason =
    data.selectedCount > 0 ? !emptyContext && !fixedOverflow : emptyContext || fixedOverflow;
  const validDecision = (data.decision === 'ACCEPT') === (reasons.size === 0);

  return validContextReason && validDecision;
}
