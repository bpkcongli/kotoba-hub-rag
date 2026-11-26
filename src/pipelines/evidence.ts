import type { BuiltContext } from '@/context/types';
import { hashValue } from '@/observability/store';
import { QUERY_POLICY_VERSION } from '@/pipelines/retrieval-plan';
import { ConfigError } from '@/shared/config';

export interface EvidencePolicy {
  readonly version: 'rag-03-evidence-v1';
  readonly minUniqueChunks: number;
  readonly minCoveredSkills: number;
}

export type EvidenceReason =
  | 'EMPTY_RETRIEVAL'
  | 'EMPTY_CONTEXT'
  | 'FIXED_INPUT_BUDGET'
  | 'TOO_FEW_UNIQUE_CHUNKS'
  | 'TOO_FEW_COVERED_SKILLS';

export interface EvidenceAssessment {
  readonly kind: 'evidence_assessed';
  readonly policyVersion: EvidencePolicy['version'];
  readonly queryPolicyVersion: typeof QUERY_POLICY_VERSION;
  readonly configurationHash: string;
  readonly contextConfigurationHash: string;
  readonly minUniqueChunks: number;
  readonly minCoveredSkills: number;
  readonly retrievedCount: number;
  readonly selectedCount: number;
  readonly targetSkillCount: number;
  readonly coveredSkillCount: number;
  readonly decision: 'ACCEPT' | 'REJECT';
  readonly reasons: readonly EvidenceReason[];
}

export function readEvidencePolicy(env: Readonly<Record<string, unknown>> = {}): EvidencePolicy {
  const integer = (key: string): number => {
    const raw = env[key] ?? '1';
    const value = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;

    if (!Number.isSafeInteger(value) || value < 1 || value > 64) {
      throw new ConfigError([key]);
    }
    return value;
  };

  return Object.freeze({
    version: 'rag-03-evidence-v1',
    minUniqueChunks: integer('RAG_MIN_UNIQUE_CHUNKS'),
    minCoveredSkills: integer('RAG_MIN_COVERED_SKILLS'),
  });
}

export function assessEvidence(
  policy: EvidencePolicy,
  retrievedCount: number,
  built: BuiltContext,
): EvidenceAssessment {
  const reasons: EvidenceReason[] = [];
  const selectedCount = new Set(built.evidence.map((row) => row.chunkId)).size;
  const coveredSkillCount = built.trace.coverage.coveredSkillCodes.length;

  if (retrievedCount === 0) {
    reasons.push('EMPTY_RETRIEVAL');
  }

  if (built.status === 'INPUT_BUDGET_EXCEEDED') {
    reasons.push('FIXED_INPUT_BUDGET');
  } else if (built.status === 'EMPTY') {
    reasons.push('EMPTY_CONTEXT');
  }

  if (selectedCount < policy.minUniqueChunks) {
    reasons.push('TOO_FEW_UNIQUE_CHUNKS');
  }

  if (coveredSkillCount < policy.minCoveredSkills) {
    reasons.push('TOO_FEW_COVERED_SKILLS');
  }

  return {
    kind: 'evidence_assessed',
    policyVersion: policy.version,
    queryPolicyVersion: QUERY_POLICY_VERSION,
    configurationHash: hashValue(JSON.stringify(policy)),
    contextConfigurationHash: built.trace.configurationHash,
    minUniqueChunks: policy.minUniqueChunks,
    minCoveredSkills: policy.minCoveredSkills,
    retrievedCount,
    selectedCount,
    targetSkillCount: built.trace.coverage.targetSkillCodes.length,
    coveredSkillCount,
    decision: reasons.length ? 'REJECT' : 'ACCEPT',
    reasons,
  };
}
