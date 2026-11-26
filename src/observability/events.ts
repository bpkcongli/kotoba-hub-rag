import { Ajv } from 'ajv';
import { default as formats } from 'ajv-formats';
import type { ContextTrace } from '@/context/types';
import type { Mode, Operation } from '@/contracts/validator';
import { callAccountingSchema, parseCallAccounting } from '@/observability/accounting-schema';
import type { CallAccounting } from '@/observability/accounting-types';
import { contextEventSchema, validContextTrace } from '@/observability/context-event';
import { evidenceEventSchema, validEvidenceAssessment } from '@/observability/evidence-event';
import { retrievalEventSchema, validRetrievalTrace } from '@/observability/retrieval-event';
import { routingEventSchema, validRoutingDecision } from '@/observability/routing-event';
import type { EvidenceAssessment } from '@/pipelines/evidence';
import type { RoutingDecision } from '@/pipelines/router';
import type { RetrievalTrace } from '@/retrieval/types';

export interface Correlation {
  readonly requestId: string | null;
  readonly executionId: string | null;
  readonly traceId: string;
  readonly mode: Mode | null;
  readonly operation: Operation | null;
  readonly experiment: {
    readonly experimentId: string;
    readonly caseId: string;
    readonly repetition: number;
  } | null;
}

export type Outcome = 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'UNKNOWN';
export type TraceCode =
  | 'INVALID_INPUT'
  | 'AUTH_FAILED'
  | 'FORBIDDEN'
  | 'SNAPSHOT_MISMATCH'
  | 'IDEMPOTENCY_CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'UNSUPPORTED_LEVEL'
  | 'INSUFFICIENT_EVIDENCE'
  | 'POST_VALIDATION_FAILED'
  | 'CAPACITY_LIMIT'
  | 'INTERNAL_ERROR'
  | 'RETRIEVAL_FAILED'
  | 'INFERENCE_FAILED'
  | 'PROVIDER_FAILED'
  | 'PROVIDER_REJECTED'
  | 'PROVIDER_REFUSED'
  | 'SCHEMA_PARSE_FAILED'
  | 'DEPENDENCY_NOT_READY'
  | 'TRACE_WRITE_FAILED'
  | 'TIMEOUT'
  | 'CRASH_RECOVERY';

export type EventData =
  | RoutingDecision
  | EvidenceAssessment
  | ContextTrace
  | RetrievalTrace
  | { readonly kind: 'request_started'; readonly fingerprint: string }
  | {
      readonly kind: 'span_completed';
      readonly spanId: string;
      readonly parentSpanId: string | null;
      readonly stage: 'retrieval' | 'routing' | 'context' | 'rewrite' | 'generation' | 'validation';
      readonly outcome: 'SUCCESS' | 'FAILED' | 'TIMEOUT';
      readonly code: TraceCode | null;
    }
  | ({
      readonly kind: 'model_attempt';
      readonly attemptId: string;
      readonly purpose:
        | 'document'
        | 'query'
        | 'rerank'
        | 'generate'
        | 'evaluate'
        | 'normalize'
        | 'recommend'
        | 'rewrite'
        | 'repair'
        | 'judge';
      readonly provider: string;
      readonly model: string;
      readonly configVersion: string;
      readonly configurationHash: string;
      readonly endpointHash: string;
      readonly profile: 'DENSE' | 'HYBRID' | null;
      readonly servedRevision: string | null;
      readonly itemCount: number;
      readonly httpStatus: number | null;
      readonly retryAfterMs: number | null;
      readonly providerRequestIdHash: string | null;
      readonly errorCode: string | null;
      readonly remoteOutcome: 'response_received' | 'unknown';
    } & (
      { readonly usage: null; readonly costUsd: null } | { readonly accounting: CallAccounting }
    ))
  | {
      readonly kind: 'terminal' | 'admission_rejected';
      readonly outcome: Outcome;
      readonly code: TraceCode | null;
      readonly traceComplete: boolean;
    };

export interface TraceEvent {
  readonly schemaVersion: 'obs-01-v1' | 'obs-02-v1';
  readonly eventId: string;
  readonly correlation: Correlation;
  readonly timestamp: string;
  readonly durationMs: number | null;
  readonly data: EventData;
}

const uuid = { type: 'string', format: 'uuid' };
const hash = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const label = { type: 'string', maxLength: 200, pattern: '^[A-Za-z0-9][A-Za-z0-9_./:@-]*$' };

const nullable = (schema: object): object => ({ anyOf: [schema, { type: 'null' }] });
const object = (properties: Record<string, unknown>): object => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

const outcome = { enum: ['SUCCESS', 'FAILED', 'TIMEOUT', 'UNKNOWN'] };
const code = nullable({
  enum: [
    'INVALID_INPUT',
    'AUTH_FAILED',
    'FORBIDDEN',
    'SNAPSHOT_MISMATCH',
    'IDEMPOTENCY_CONFLICT',
    'PAYLOAD_TOO_LARGE',
    'UNSUPPORTED_MEDIA_TYPE',
    'UNSUPPORTED_LEVEL',
    'INSUFFICIENT_EVIDENCE',
    'POST_VALIDATION_FAILED',
    'CAPACITY_LIMIT',
    'INTERNAL_ERROR',
    'RETRIEVAL_FAILED',
    'INFERENCE_FAILED',
    'PROVIDER_FAILED',
    'PROVIDER_REJECTED',
    'PROVIDER_REFUSED',
    'SCHEMA_PARSE_FAILED',
    'DEPENDENCY_NOT_READY',
    'TRACE_WRITE_FAILED',
    'TIMEOUT',
    'CRASH_RECOVERY',
  ],
});

export const correlationSchema = object({
  requestId: nullable(uuid),
  executionId: nullable(uuid),
  traceId: uuid,
  mode: { enum: ['LLM_ONLY', 'SINGLE_STAGE', 'ADAPTIVE', null] },
  operation: { enum: ['generate', 'evaluate', 'normalize', 'recommend', null] },
  experiment: nullable(
    object({
      experimentId: label,
      caseId: label,
      repetition: { type: 'integer', minimum: 1 },
    }),
  ),
});

// No arbitrary attributes, messages, prompt text, headers, URLs or domain payloads.
const modelProperties = {
  kind: { const: 'model_attempt' },
  attemptId: uuid,
  purpose: {
    enum: [
      'document',
      'query',
      'rerank',
      'generate',
      'evaluate',
      'normalize',
      'recommend',
      'rewrite',
      'repair',
      'judge',
    ],
  },
  provider: label,
  model: label,
  configVersion: label,
  configurationHash: hash,
  endpointHash: hash,
  profile: { enum: ['DENSE', 'HYBRID', null] },
  servedRevision: nullable(label),
  itemCount: { type: 'integer', minimum: 1 },
  httpStatus: nullable({ type: 'integer', minimum: 100, maximum: 599 }),
  retryAfterMs: nullable({ type: 'number', minimum: 0 }),
  providerRequestIdHash: nullable(hash),
  errorCode: nullable({ type: 'string', pattern: '^[A-Z_]{1,80}$' }),
  remoteOutcome: { enum: ['response_received', 'unknown'] },
};

export const traceEventSchema = object({
  schemaVersion: { enum: ['obs-01-v1', 'obs-02-v1'] },
  eventId: uuid,
  correlation: correlationSchema,
  timestamp: { type: 'string', format: 'date-time', pattern: 'Z$' },
  durationMs: nullable({ type: 'number', minimum: 0 }),
  data: {
    oneOf: [
      object({ kind: { const: 'request_started' }, fingerprint: hash }),
      retrievalEventSchema,
      contextEventSchema,
      evidenceEventSchema,
      routingEventSchema,
      object({
        kind: { const: 'span_completed' },
        spanId: uuid,
        parentSpanId: nullable(uuid),
        stage: { enum: ['retrieval', 'routing', 'context', 'rewrite', 'generation', 'validation'] },
        outcome: { enum: ['SUCCESS', 'FAILED', 'TIMEOUT'] },
        code,
      }),
      object({ ...modelProperties, usage: { type: 'null' }, costUsd: { type: 'null' } }),
      object({ ...modelProperties, accounting: callAccountingSchema }),
      object({
        kind: { enum: ['terminal', 'admission_rejected'] },
        outcome,
        code,
        traceComplete: { type: 'boolean' },
      }),
    ],
  },
});

const ajv = new Ajv({
  strict: true,
  coerceTypes: false,
  removeAdditional: false,
  useDefaults: false,
});
formats.default(ajv);

const validate = ajv.compile<TraceEvent>(traceEventSchema);
export const validateCorrelation = ajv.compile<Correlation>(correlationSchema);

export function parseTraceEvent(value: unknown): TraceEvent {
  if (!validate(value)) {
    throw new Error('Event observability tidak valid');
  }

  const event = value;

  if (
    event.data.kind === 'routing_decided' &&
    (event.schemaVersion !== 'obs-02-v1' ||
      event.correlation.mode !== 'ADAPTIVE' ||
      !validRoutingDecision(event.data))
  ) {
    throw new Error('Invariant routing decision tidak valid');
  }

  if (
    event.data.kind === 'evidence_assessed' &&
    (event.schemaVersion !== 'obs-02-v1' || !validEvidenceAssessment(event.data))
  ) {
    throw new Error('Invariant evidence assessment tidak valid');
  }

  if (
    event.data.kind === 'context_built' &&
    (event.schemaVersion !== 'obs-02-v1' || !validContextTrace(event.data))
  ) {
    throw new Error('Invariant context trace tidak valid');
  }

  if (
    event.data.kind === 'retrieval_completed' &&
    (event.schemaVersion !== 'obs-02-v1' || !validRetrievalTrace(event.data))
  ) {
    throw new Error('Invariant retrieval trace tidak valid');
  }

  const terminal = event.data.kind === 'terminal' || event.data.kind === 'admission_rejected';

  if (event.data.kind === 'model_attempt') {
    const accounted = 'accounting' in event.data;

    if ((event.schemaVersion === 'obs-02-v1') !== accounted) {
      throw new Error('Versi accounting event tidak cocok');
    }

    if ('accounting' in event.data) {
      const call = parseCallAccounting(event.data.accounting);

      if (
        call.attemptId !== event.data.attemptId ||
        call.purpose !== event.data.purpose ||
        call.provider !== event.data.provider ||
        call.model !== event.data.model ||
        call.timestamp !== event.timestamp
      ) {
        throw new Error('Identitas accounting event tidak cocok');
      }
    }
  }

  if (
    (event.durationMs === null && (!terminal || event.data.outcome !== 'UNKNOWN')) ||
    (event.data.kind === 'admission_rejected' &&
      (event.correlation.executionId !== null || event.data.outcome !== 'FAILED')) ||
    (event.data.kind !== 'admission_rejected' && event.correlation.executionId === null) ||
    ((terminal || event.data.kind === 'span_completed') &&
      (event.data.outcome === 'SUCCESS') !== (event.data.code === null)) ||
    (terminal && event.data.outcome === 'SUCCESS' && !event.data.traceComplete) ||
    (terminal && event.data.outcome === 'UNKNOWN' && event.data.traceComplete)
  ) {
    throw new Error('Invariant event observability tidak valid');
  }

  return event;
}
