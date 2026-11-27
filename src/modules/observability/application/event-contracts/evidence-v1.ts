// Serialized trace contract snapshot; independent of live policy implementations.
import { QUERY_POLICY_VERSION } from '@/modules/observability/application/event-contracts/query-policy-v1';

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
