import { QUERY_POLICY_VERSION } from '@/modules/observability/application/event-contracts/query-policy-v1';
import type { RoutingDecision } from '@/modules/observability/application/event-contracts/routing-v1';
import {
  routeInitialEvidence,
  routerConfigurationHash,
  routerFeaturesSchema,
  routerPolicySchema,
} from '@/modules/observability/application/event-contracts/routing-v1';

const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const properties = {
  kind: { const: 'routing_decided' },
  policy: routerPolicySchema,
  configurationHash: hash,
  retrievalConfigurationHash: hash,
  contextConfigurationHash: hash,
  queryPolicyVersion: { const: QUERY_POLICY_VERSION },
  features: routerFeaturesSchema,
  initialDecision: { enum: ['FAST', 'DEEP'] },
  finalPath: { type: 'null' },
  stageCount: { const: 1 },
  reasons: {
    type: 'array',
    minItems: 1,
    maxItems: 5,
    uniqueItems: true,
    items: {
      enum: [
        'EMPTY_RETRIEVAL',
        'EMPTY_CONTEXT',
        'TOO_FEW_UNIQUE_CANDIDATES',
        'TOO_FEW_SELECTED_CHUNKS',
        'LOW_SKILL_COVERAGE',
        'INITIAL_EVIDENCE_SUFFICIENT',
      ],
    },
  },
};

export const routingEventSchema = {
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
};

export function validRoutingDecision(data: RoutingDecision): boolean {
  try {
    const expected = routeInitialEvidence(data.policy, data.features);

    return (
      data.configurationHash === routerConfigurationHash(data.policy) &&
      data.initialDecision === expected.initialDecision &&
      JSON.stringify(data.reasons) === JSON.stringify(expected.reasons)
    );
  } catch {
    return false;
  }
}
