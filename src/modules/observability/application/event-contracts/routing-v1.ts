import { createHash } from 'node:crypto';
// Serialized trace contract snapshot; independent of live policy implementations.
import { Ajv } from 'ajv';
import { QUERY_POLICY_VERSION } from '@/modules/observability/application/event-contracts/query-policy-v1';
import type { ScoreType } from '@/modules/observability/application/event-contracts/retrieval-v1';
import { ConfigError } from '@/shared/errors/config-error';
import { GenerationError } from '@/shared/errors/generation-error';

export interface RouterPolicy {
  readonly version: 'adp-01-router-v1';

  readonly calibrationStatus: 'PROVISIONAL';

  readonly minUniqueCandidates: number;

  readonly minSelectedChunks: number;

  readonly minSkillCoverage: number;
}

export interface RouterFeatures {
  readonly version: 'adp-01-features-v1';

  readonly uniqueCandidateCount: number;

  readonly selectedChunkCount: number;

  readonly targetSkillCount: number;

  readonly coveredSkillCount: number;

  readonly skillCoverage: number;

  readonly scoreType: ScoreType | null;

  readonly topScore: number | null;

  readonly topGap: number | null;
}

export type RouteReason =
  | 'EMPTY_RETRIEVAL'
  | 'EMPTY_CONTEXT'
  | 'TOO_FEW_UNIQUE_CANDIDATES'
  | 'TOO_FEW_SELECTED_CHUNKS'
  | 'LOW_SKILL_COVERAGE'
  | 'INITIAL_EVIDENCE_SUFFICIENT';

export interface RoutingDecision {
  readonly kind: 'routing_decided';

  readonly policy: RouterPolicy;

  readonly configurationHash: string;

  readonly retrievalConfigurationHash: string;

  readonly contextConfigurationHash: string;

  readonly queryPolicyVersion: typeof QUERY_POLICY_VERSION;

  readonly features: RouterFeatures;

  readonly initialDecision: 'FAST' | 'DEEP';
  // A decision is not an executed path. ADP-02/03 own path completion and terminal outcome.

  readonly finalPath: null;

  readonly stageCount: 1;

  readonly reasons: readonly RouteReason[];
}

const count = { type: 'integer', minimum: 0, maximum: 64 };

const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

export const routerPolicySchema = object({
  version: { const: 'adp-01-router-v1' },
  calibrationStatus: { const: 'PROVISIONAL' },
  minUniqueCandidates: { ...count, minimum: 1 },
  minSelectedChunks: { ...count, minimum: 1 },
  minSkillCoverage: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
});

export const routerFeaturesSchema = object({
  version: { const: 'adp-01-features-v1' },
  uniqueCandidateCount: count,
  selectedChunkCount: count,
  targetSkillCount: { ...count, minimum: 1 },
  coveredSkillCount: count,
  skillCoverage: { type: 'number', minimum: 0, maximum: 1 },
  scoreType: { enum: ['cosine', 'sparse_dot', 'rrf_k60_zero_based', null] },
  topScore: { type: ['number', 'null'] },
  topGap: { anyOf: [{ type: 'number', minimum: 0 }, { type: 'null' }] },
});

const ajv = new Ajv({ strict: true, coerceTypes: false, useDefaults: false });

const validPolicy = ajv.compile<RouterPolicy>(routerPolicySchema);

const validFeatures = ajv.compile<RouterFeatures>(routerFeaturesSchema);

export function parseRouterPolicy(value: unknown): RouterPolicy {
  if (!validPolicy(value)) {
    throw new ConfigError(['ADAPTIVE_ROUTER_POLICY']);
  }

  return Object.freeze(structuredClone(value));
}

export function parseRouterFeatures(value: unknown): RouterFeatures {
  if (
    !validFeatures(value) ||
    value.selectedChunkCount > value.uniqueCandidateCount ||
    value.coveredSkillCount > value.targetSkillCount ||
    value.skillCoverage !== value.coveredSkillCount / value.targetSkillCount ||
    (value.selectedChunkCount === 0 && value.coveredSkillCount !== 0) ||
    (value.uniqueCandidateCount === 0
      ? value.scoreType !== null || value.topScore !== null || value.topGap !== null
      : value.scoreType === null || value.topScore === null) ||
    (value.uniqueCandidateCount < 2 ? value.topGap !== null : value.topGap === null)
  ) {
    throw new GenerationError('INVALID_INPUT');
  }

  return Object.freeze(structuredClone(value));
}

export function routeInitialEvidence(
  policy: RouterPolicy,
  features: RouterFeatures,
): Pick<RoutingDecision, 'initialDecision' | 'reasons'> {
  policy = parseRouterPolicy(policy);
  features = parseRouterFeatures(features);
  const reasons: RouteReason[] = [];

  if (features.uniqueCandidateCount === 0) {
    reasons.push('EMPTY_RETRIEVAL');
  }

  if (features.selectedChunkCount === 0) {
    reasons.push('EMPTY_CONTEXT');
  }

  if (features.uniqueCandidateCount < policy.minUniqueCandidates) {
    reasons.push('TOO_FEW_UNIQUE_CANDIDATES');
  }

  if (features.selectedChunkCount < policy.minSelectedChunks) {
    reasons.push('TOO_FEW_SELECTED_CHUNKS');
  }

  if (features.skillCoverage < policy.minSkillCoverage) {
    reasons.push('LOW_SKILL_COVERAGE');
  }

  return reasons.length
    ? { initialDecision: 'DEEP', reasons }
    : { initialDecision: 'FAST', reasons: ['INITIAL_EVIDENCE_SUFFICIENT'] };
}

export function routerConfigurationHash(policy: RouterPolicy): string {
  // Rebuild in canonical order; caller property order must not change config identity.
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: policy.version,
        calibrationStatus: policy.calibrationStatus,
        minUniqueCandidates: policy.minUniqueCandidates,
        minSelectedChunks: policy.minSelectedChunks,
        minSkillCoverage: policy.minSkillCoverage,
      }),
    )
    .digest('hex');
}
