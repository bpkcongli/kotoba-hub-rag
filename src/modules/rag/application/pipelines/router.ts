import { createHash } from 'node:crypto';
import { Ajv } from 'ajv';
import { QUERY_POLICY_VERSION } from '@/modules/rag/application/pipelines/retrieval-plan';
import type { BuiltContext } from '@/modules/rag/domain/models/context';
import type { RetrievedEvidence, ScoreType } from '@/modules/rag/domain/models/retrieval';
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

export function readRouterPolicy(env: Readonly<Record<string, unknown>> = {}): RouterPolicy {
  const numeric = (key: string, fallback: string): number => {
    const raw = env[key] ?? fallback;

    if (typeof raw !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) {
      throw new ConfigError([key]);
    }

    return Number(raw);
  };

  return parseRouterPolicy({
    version: 'adp-01-router-v1',
    calibrationStatus: 'PROVISIONAL',
    minUniqueCandidates: numeric('ADAPTIVE_MIN_UNIQUE_CANDIDATES', '1'),
    minSelectedChunks: numeric('ADAPTIVE_MIN_SELECTED_CHUNKS', '1'),
    minSkillCoverage: numeric('ADAPTIVE_MIN_SKILL_COVERAGE', '1'),
  });
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

export function extractRouterFeatures(
  targetSkillCodes: readonly string[],
  candidates: readonly RetrievedEvidence[],
  built: BuiltContext,
): RouterFeatures {
  const targets = new Set(targetSkillCodes);
  const covered = new Set(built.trace.coverage.coveredSkillCodes);
  const unique = [...new Map(candidates.map((row) => [row.chunkId, row])).values()].sort(
    (left, right) => left.rank - right.rank,
  );
  const selected = new Set(built.evidence.map((row) => row.chunkId));
  const top = unique[0];
  const second = unique[1];
  const selectedCoverage = new Set(
    unique
      .filter((row) => selected.has(row.chunkId))
      .flatMap((row) => row.skillCodes.filter((code) => targets.has(code))),
  );

  if (
    targets.size !== targetSkillCodes.length ||
    targets.size !== built.trace.coverage.targetSkillCodes.length ||
    built.trace.coverage.targetSkillCodes.some((code) => !targets.has(code)) ||
    [...covered].some((code) => !targets.has(code)) ||
    selectedCoverage.size !== covered.size ||
    [...selectedCoverage].some((code) => !covered.has(code)) ||
    built.trace.status !== built.status ||
    built.status === 'INPUT_BUDGET_EXCEEDED' ||
    (built.status === 'READY') !== selected.size > 0 ||
    unique.some((row) => row.scoreType !== top?.scoreType || !Number.isFinite(row.score)) ||
    (second !== undefined && top !== undefined && top.score < second.score) ||
    built.evidence.some((row) => !unique.some((candidate) => candidate.chunkId === row.chunkId))
  ) {
    throw new GenerationError('INVALID_INPUT');
  }

  // No query text, learner profile, domain answer or evaluation field enters this boundary.
  return parseRouterFeatures({
    version: 'adp-01-features-v1',
    uniqueCandidateCount: unique.length,
    selectedChunkCount: selected.size,
    targetSkillCount: targets.size,
    coveredSkillCount: covered.size,
    skillCoverage: covered.size / targets.size,
    scoreType: top?.scoreType ?? null,
    topScore: top?.score ?? null,
    topGap: top && second ? top.score - second.score : null,
  });
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
