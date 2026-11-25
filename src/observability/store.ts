import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, readdir, unlink } from 'node:fs/promises';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import type { InferenceAttempt } from '@/adapters/hf-inference';
import { OPENAI_ENDPOINT } from '@/adapters/openai-config';
import type { GenerationAttempt } from '@/adapters/openai-responses';
import { systemClock } from '@/adapters/system-clock';
import type { Mode, Operation } from '@/contracts/validator';
import { parsePriceSnapshot, parseResourceCharge } from '@/observability/accounting-schema';
import type {
  CallAccounting,
  CallMeasurement,
  PriceSnapshot,
  ResourceCharge,
} from '@/observability/accounting-types';
import type { AccountingInput, CallRow, ExecutionSpec } from '@/observability/aggregation';
import { parseTraceEvent, validateCorrelation } from '@/observability/events';
import type {
  Correlation,
  EventData,
  Outcome,
  TraceCode,
  TraceEvent,
} from '@/observability/events';
import { ensureDirectory, isMissing, publishJson, syncDirectory } from '@/observability/files';
import { JsonlTraceSink } from '@/observability/jsonl-sink';
import { accountCall, loadPriceSnapshot, priceSnapshotHash } from '@/observability/pricing';
import type { Clock, TraceSink } from '@/shared/ports';

export class ObservationError extends Error {
  readonly code: 'TRACE_WRITE_FAILED' | 'IDEMPOTENCY_CONFLICT' | 'EXECUTION_NOT_ACTIVE';

  constructor(code: ObservationError['code']) {
    super(code);
    this.name = 'ObservationError';
    this.code = code;
  }
}

export function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// Reject non-JSON values; key order does not change the request fingerprint.
function canonical(value: unknown): string {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item: unknown) => canonical(item)).join(',')}]`;
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  }

  throw new Error('Fingerprint memerlukan JSON valid');
}

export interface AdmissionInput {
  readonly serviceId: string;
  readonly requestId: string;
  readonly operation: Operation;
  readonly mode: Mode;
  readonly experiment?: Correlation['experiment'];
  readonly request: unknown;
}

interface Entry {
  readonly key: string;
  readonly start: TraceEvent & { readonly data: Extract<EventData, { kind: 'request_started' }> };
  terminal: TraceEvent | null;
  sink: TraceSink | null;
  startedMs: number | null;
  active: boolean;
  pendingFailure: TraceCode | null;
}

export type AdmissionResult = {
  readonly status: 'admitted' | 'IN_FLIGHT' | 'TERMINAL' | 'UNKNOWN';
  readonly correlation: Correlation;
  readonly terminal: TraceEvent | null;
};

export interface ObservationOptions {
  readonly recoverStaleLock?: boolean;
  readonly sinkFactory?: (path: string) => TraceSink;
  readonly priceSnapshot?: PriceSnapshot;
}

export interface ObservationInspection {
  readonly correlation: Correlation;
  readonly state: 'IN_FLIGHT' | 'TERMINAL' | 'UNKNOWN';
  readonly terminal: TraceEvent | null;
  readonly traceIntegrity: 'VALID' | 'INVALID' | 'MISSING';
  readonly eventCount: number;
}

export class ObservationStore {
  private readonly directory: string;
  private readonly clock: Clock;
  private readonly options: ObservationOptions;
  private readonly entries = new Map<string, Entry>();
  private readonly byExecution = new Map<string, Entry>();
  private tail: Promise<void> = Promise.resolve();
  private initialization: Promise<void> | null = null;
  private closed = false;
  private ownsLock = false;
  private pending = 0;
  private priceSnapshot: PriceSnapshot | null;

  constructor(directory: string, clock: Clock = systemClock, options: ObservationOptions = {}) {
    this.directory = resolve(directory);
    this.clock = clock;
    this.options = { ...options };
    this.priceSnapshot =
      options.priceSnapshot === undefined ? null : parsePriceSnapshot(options.priceSnapshot);
  }

  private async initialize(): Promise<void> {
    for (const path of [
      this.directory,
      this.path('admissions'),
      this.path('terminals'),
      this.path('events'),
      this.path('prices'),
      this.path('resources'),
    ]) {
      await ensureDirectory(path);
    }

    if (this.options.recoverStaleLock) {
      await this.recoverLock();
    }

    const lock = await open(this.path('writer.lock'), 'wx', 0o600);
    this.ownsLock = true;

    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid, host: hostname() }));
      await lock.sync();
    } finally {
      await lock.close();
    }

    await syncDirectory(this.directory);

    this.priceSnapshot ??= await loadPriceSnapshot();
    const priceHash = priceSnapshotHash(this.priceSnapshot);
    const pricePath = this.path('prices', `${priceHash}.json`);

    for (const filename of await readdir(this.path('prices'))) {
      if (!/^[a-f0-9]{64}\.json$/.test(filename)) {
        continue;
      }

      const saved = parsePriceSnapshot(
        JSON.parse(await readFile(this.path('prices', filename), 'utf8')),
      );

      if (
        `${priceSnapshotHash(saved)}.json` !== filename ||
        (saved.id === this.priceSnapshot.id && filename !== `${priceHash}.json`)
      ) {
        throw new Error('Identitas snapshot harga berubah');
      }
    }

    try {
      const existing = parsePriceSnapshot(JSON.parse(await readFile(pricePath, 'utf8')));

      if (priceSnapshotHash(existing) !== priceHash) {
        throw new Error('Snapshot harga berubah');
      }
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }

      await publishJson(pricePath, this.priceSnapshot);
    }

    for (const filename of await readdir(this.path('admissions'))) {
      if (!/^[a-f0-9]{64}\.json$/.test(filename)) {
        continue;
      }

      const start = parseTraceEvent(
        JSON.parse(await readFile(this.path('admissions', filename), 'utf8')),
      );

      if (
        start.data.kind !== 'request_started' ||
        !start.correlation.requestId ||
        !start.correlation.executionId ||
        !start.correlation.mode ||
        !start.correlation.operation
      ) {
        throw new Error('Registry admission tidak valid');
      }

      let terminal: TraceEvent | null = null;

      try {
        terminal = parseTraceEvent(
          JSON.parse(
            await readFile(this.path('terminals', `${start.correlation.executionId}.json`), 'utf8'),
          ),
        );

        if (
          terminal.data.kind !== 'terminal' ||
          canonical(terminal.correlation) !== canonical(start.correlation)
        ) {
          throw new Error('Registry terminal tidak cocok');
        }
      } catch (error) {
        if (!isMissing(error)) {
          throw error;
        }
      }

      const entry: Entry = {
        key: filename.slice(0, -5),
        start: { ...start, data: start.data },
        terminal,
        sink: null,
        startedMs: null,
        active: false,
        pendingFailure: null,
      };

      this.entries.set(entry.key, entry);
      this.byExecution.set(start.correlation.executionId, entry);
    }
  }

  private async recoverLock(): Promise<void> {
    // Serialize recovery; never remove a live writer's lock or infer liveness across hosts.
    const guard = await open(this.path('recovery.lock'), 'wx', 0o600);

    try {
      await guard.writeFile(JSON.stringify({ pid: process.pid, host: hostname() }));
      await guard.sync();
      await syncDirectory(this.directory);

      let raw: unknown;

      try {
        raw = JSON.parse(await readFile(this.path('writer.lock'), 'utf8'));
      } catch (error) {
        if (isMissing(error)) {
          return;
        }
        throw error;
      }

      if (
        typeof raw !== 'object' ||
        raw === null ||
        !('host' in raw) ||
        raw.host !== hostname() ||
        !('pid' in raw) ||
        typeof raw.pid !== 'number' ||
        !Number.isSafeInteger(raw.pid) ||
        raw.pid <= 0
      ) {
        throw new Error('Lock memerlukan pemeriksaan operator');
      }

      try {
        process.kill(raw.pid, 0);
        throw new Error('Writer masih aktif');
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) {
          throw error;
        }
      }

      await unlink(this.path('writer.lock'));
      await syncDirectory(this.directory);
    } finally {
      await guard.close();
      await unlink(this.path('recovery.lock'));
    }
  }

  private path(...segments: string[]): string {
    return resolve(this.directory, ...segments);
  }

  private run<T>(action: () => Promise<T>): Promise<T> {
    if (this.closed || this.pending >= 128) {
      return Promise.reject(new ObservationError('TRACE_WRITE_FAILED'));
    }

    this.pending++;
    const result = this.tail
      .then(async () => {
        this.initialization ??= this.initialize();
        await this.initialization;
        return action();
      })
      .catch((error: unknown) => {
        if (error instanceof ObservationError) {
          throw error;
        }
        throw new ObservationError('TRACE_WRITE_FAILED');
      })
      .finally(() => {
        this.pending--;
      });

    this.tail = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  }

  private event(
    correlation: Correlation,
    durationMs: number | null,
    data: EventData,
    timestamp?: string,
  ): TraceEvent {
    return parseTraceEvent({
      schemaVersion: 'obs-02-v1',
      eventId: randomUUID(),
      correlation,
      timestamp: timestamp ?? this.clock.now().toISOString(),
      durationMs,
      data,
    });
  }

  private duration(entry: Entry): number | null {
    return entry.startedMs === null
      ? null
      : Math.max(0, this.clock.monotonicMs() - entry.startedMs);
  }

  private refuseUnrecorded(executionId: string): boolean {
    if (!this.closed && this.pending < 128) {
      return false;
    }

    const entry = this.byExecution.get(executionId);
    if (entry) {
      // Admission survives even when no queue slot remains for a terminal write.
      entry.active = false;
      entry.pendingFailure = 'TRACE_WRITE_FAILED';
    }

    return true;
  }

  async admit(input: AdmissionInput): Promise<AdmissionResult> {
    // Snapshot before asynchronous initialization/queueing; never persist the request or service ID.
    const startedMs = this.clock.monotonicMs();
    const key = hashValue(canonical([input.serviceId, input.requestId]));
    const fingerprint = hashValue(
      canonical([input.operation, input.mode, input.experiment ?? null, input.request]),
    );
    const correlation: Correlation = structuredClone({
      requestId: input.requestId,
      executionId: randomUUID(),
      traceId: randomUUID(),
      mode: input.mode,
      operation: input.operation,
      experiment: input.experiment ?? null,
    });

    if (!validateCorrelation(correlation)) {
      throw new Error('Korelasi admission tidak valid');
    }

    return this.run(async () => {
      const existing = this.entries.get(key);

      if (existing) {
        if (existing.start.data.fingerprint !== fingerprint) {
          throw new ObservationError('IDEMPOTENCY_CONFLICT');
        }

        return structuredClone({
          status: existing.terminal
            ? existing.terminal.data.kind === 'terminal' &&
              existing.terminal.data.outcome === 'UNKNOWN'
              ? 'UNKNOWN'
              : 'TERMINAL'
            : existing.active
              ? 'IN_FLIGHT'
              : 'UNKNOWN',
          correlation: existing.start.correlation,
          terminal: existing.terminal,
        });
      }

      const start = this.event(correlation, Math.max(0, this.clock.monotonicMs() - startedMs), {
        kind: 'request_started',
        fingerprint,
      });

      if (start.data.kind !== 'request_started') {
        throw new Error('Admission invalid');
      }

      await publishJson(this.path('admissions', `${key}.json`), start);

      const entry: Entry = {
        key,
        start: { ...start, data: start.data },
        terminal: null,
        sink: null,
        startedMs,
        active: true,
        pendingFailure: null,
      };
      this.entries.set(key, entry);
      this.byExecution.set(correlation.executionId ?? '', entry);

      try {
        entry.sink = (this.options.sinkFactory ?? ((path) => new JsonlTraceSink(path)))(
          this.path('events', `${correlation.executionId ?? ''}.jsonl`),
        );
        await entry.sink.write(start);
      } catch {
        await this.traceFailure(entry);
      }

      return structuredClone({ status: 'admitted', correlation, terminal: null });
    });
  }

  assertActive(executionId: string): void {
    const entry = this.byExecution.get(executionId);

    if (!entry?.active) {
      throw new ObservationError('EXECUTION_NOT_ACTIVE');
    }
  }

  activeCorrelation(executionId: string): Correlation {
    this.assertActive(executionId);
    const entry = this.byExecution.get(executionId);

    if (!entry) {
      throw new ObservationError('EXECUTION_NOT_ACTIVE');
    }

    return structuredClone(entry.start.correlation);
  }

  assertAdmittedRequest(
    executionId: string,
    input: Omit<AdmissionInput, 'serviceId'>,
  ): Correlation {
    this.assertActive(executionId);
    const entry = this.byExecution.get(executionId);
    const fingerprint = hashValue(
      canonical([input.operation, input.mode, input.experiment ?? null, input.request]),
    );

    if (
      !entry ||
      entry.start.data.fingerprint !== fingerprint ||
      entry.start.correlation.requestId !== input.requestId
    ) {
      throw new ObservationError('IDEMPOTENCY_CONFLICT');
    }

    return structuredClone(entry.start.correlation);
  }

  async recordGenerationAttempt(attempt: GenerationAttempt): Promise<void> {
    const accounting = await this.priceCall({
      attemptId: attempt.attemptId,
      purpose: attempt.operation,
      phase: attempt.accountingContext.phase,
      retryKind: attempt.accountingContext.retryKind,
      provider: 'openai',
      model: attempt.model,
      billingProfile: attempt.billingProfile,
      timestamp: attempt.timestamp,
      usage: attempt.usage,
      billableUnits: [],
      reportedCost: null,
      hostingChargeId: null,
    });

    await this.record(
      attempt.executionId,
      {
        kind: 'model_attempt',
        attemptId: attempt.attemptId,
        purpose: attempt.operation,
        provider: 'openai',
        model: attempt.model,
        configVersion: 'base-01-v1',
        configurationHash: hashValue(
          canonical({
            ...attempt.configuration,
            promptHash: attempt.promptHash,
            schemaHash: attempt.schemaHash,
            servedModel: attempt.servedModel,
          }),
        ),
        endpointHash: hashValue(OPENAI_ENDPOINT),
        profile: null,
        // A returned model alias does not establish a pinned/verified model revision.
        servedRevision: null,
        itemCount: 1,
        httpStatus: attempt.httpStatus,
        retryAfterMs: attempt.retryAfterMs,
        providerRequestIdHash:
          attempt.providerRequestId === null ? null : hashValue(attempt.providerRequestId),
        errorCode: attempt.errorCode,
        remoteOutcome: attempt.remoteOutcome,
        accounting,
      },
      attempt.durationMs,
      attempt.timestamp,
    );
  }

  failExecutionTrace(executionId: string): Promise<never> {
    return this.run(async () => {
      const entry = this.byExecution.get(executionId);

      if (!entry || !entry.active) {
        throw new ObservationError('TRACE_WRITE_FAILED');
      }

      return this.traceFailure(entry);
    });
  }

  private async traceFailure(entry: Entry): Promise<never> {
    entry.active = false;
    const event = this.event(entry.start.correlation, this.duration(entry), {
      kind: 'terminal',
      outcome: 'UNKNOWN',
      code: 'TRACE_WRITE_FAILED',
      traceComplete: false,
    });

    try {
      await publishJson(
        this.path('terminals', `${entry.start.correlation.executionId ?? ''}.json`),
        event,
      );
      entry.terminal = event;
    } catch {
      // Immutable admission remains on disk even if the whole filesystem is unavailable.
    }

    throw new ObservationError('TRACE_WRITE_FAILED');
  }

  record(
    executionId: string,
    data: Exclude<
      EventData,
      { kind: 'request_started' } | { kind: 'terminal' | 'admission_rejected' }
    >,
    durationMs: number,
    timestamp?: string,
  ): Promise<void> {
    if (this.refuseUnrecorded(executionId)) {
      return Promise.reject(new ObservationError('TRACE_WRITE_FAILED'));
    }

    const copy = structuredClone(data);

    return this.run(async () => {
      this.assertActive(executionId);
      const entry = this.byExecution.get(executionId);
      if (!entry?.sink) {
        throw new ObservationError('EXECUTION_NOT_ACTIVE');
      }

      try {
        const event = this.event(entry.start.correlation, durationMs, copy, timestamp);
        await entry.sink.write(event);
      } catch {
        await this.traceFailure(entry);
      }
    });
  }

  recordHfAttempt(attempt: InferenceAttempt): Promise<void> {
    if (this.priceSnapshot === null) {
      return Promise.reject(new ObservationError('EXECUTION_NOT_ACTIVE'));
    }

    const model =
      attempt.operation === 'embedding'
        ? attempt.identity.embeddingModel
        : attempt.identity.rerankerModel;
    const accounting = accountCall(
      {
        attemptId: attempt.attemptId,
        purpose: attempt.purpose,
        phase:
          attempt.accountingContext?.phase ??
          (attempt.purpose === 'document' ? 'DOCUMENT_INDEXING' : 'ONLINE'),
        retryKind: attempt.accountingContext?.retryKind ?? 'INITIAL',
        provider: attempt.identity.provider,
        model,
        billingProfile: 'hf-serverless-compute',
        timestamp: attempt.timestamp,
        usage: null,
        billableUnits: [{ unit: 'COMPUTE_SECOND', quantity: null, evidenceHash: null }],
        reportedCost: null,
        hostingChargeId: null,
      },
      this.priceSnapshot,
    );

    // Project only allowlisted fields. Raw provider IDs, config secrets and arbitrary extras are omitted.
    return this.record(
      attempt.executionId,
      {
        kind: 'model_attempt',
        attemptId: attempt.attemptId,
        purpose: attempt.purpose,
        provider: attempt.identity.provider,
        model:
          attempt.operation === 'embedding'
            ? attempt.identity.embeddingModel
            : attempt.identity.rerankerModel,
        configVersion: attempt.identity.configVersion,
        configurationHash: hashValue(
          canonical({
            profile: attempt.configuration.profile,
            embeddingBatchSize: attempt.configuration.embeddingBatchSize,
            rerankerBatchSize: attempt.configuration.rerankerBatchSize,
            maxConcurrency: attempt.configuration.maxConcurrency,
            maxItems: attempt.configuration.maxItems,
            maxTextChars: attempt.configuration.maxTextChars,
            timeoutMs: attempt.configuration.timeoutMs,
            maxResponseBytes: attempt.configuration.maxResponseBytes,
          }),
        ),
        endpointHash: hashValue(
          attempt.operation === 'embedding'
            ? attempt.identity.embeddingEndpoint
            : attempt.identity.rerankerEndpoint,
        ),
        profile: attempt.profile,
        servedRevision: attempt.identity.servedModelRevision,
        itemCount: attempt.itemCount,
        httpStatus: attempt.httpStatus,
        retryAfterMs: attempt.retryAfterMs,
        providerRequestIdHash:
          attempt.providerRequestId === null ? null : hashValue(attempt.providerRequestId),
        errorCode: attempt.errorCode,
        remoteOutcome: attempt.remoteOutcome,
        accounting,
      },
      attempt.durationMs,
      attempt.timestamp,
    );
  }

  priceCall(measurement: CallMeasurement): Promise<CallAccounting> {
    const copy = structuredClone(measurement);

    return this.run(() => {
      if (this.priceSnapshot === null) {
        throw new ObservationError('TRACE_WRITE_FAILED');
      }

      return Promise.resolve(accountCall(copy, this.priceSnapshot));
    });
  }

  executionAccounting(executionId: string): Promise<readonly CallAccounting[]> {
    return this.run(async () => {
      this.assertActive(executionId);
      const raw = await readFile(this.path('events', `${executionId}.jsonl`), 'utf8');
      const calls: CallAccounting[] = [];

      for (const line of raw.trimEnd().split('\n')) {
        const event = parseTraceEvent(JSON.parse(line));

        if (event.correlation.executionId !== executionId) {
          throw new Error('Trace execution tidak cocok');
        }

        if (event.data.kind === 'model_attempt') {
          if (!('accounting' in event.data)) {
            throw new Error('Accounting attempt hilang');
          }

          calls.push(event.data.accounting);
        }
      }

      return calls;
    });
  }

  recordResource(value: unknown): Promise<void> {
    const resource = parseResourceCharge(value);

    return this.run(async () => {
      const path = this.path('resources', `${resource.chargeId}.json`);

      try {
        const prior = parseResourceCharge(JSON.parse(await readFile(path, 'utf8')));

        if (canonical(prior) !== canonical(resource)) {
          throw new Error('Resource charge konflik');
        }
      } catch (error) {
        if (!isMissing(error)) {
          throw error;
        }

        await publishJson(path, resource);
      }
    });
  }

  async exportAccounting(resourceInventoryComplete = false): Promise<{
    readonly input: AccountingInput;
    readonly unaccountedAttemptIds: readonly string[];
  }> {
    const inspections = await this.inspect();

    return this.run(async () => {
      const calls: CallRow[] = [];
      const executions: ExecutionSpec[] = [];
      const resources: ResourceCharge[] = [];
      const priceSnapshots: PriceSnapshot[] = [];
      const unaccountedAttemptIds: string[] = [];

      for (const row of inspections) {
        const id = row.correlation.executionId;
        const mode = row.correlation.mode;

        if (id === null || mode === null) {
          throw new Error('Admission accounting invalid');
        }

        let complete =
          row.traceIntegrity === 'VALID' &&
          row.terminal?.data.kind === 'terminal' &&
          row.terminal.data.traceComplete;

        try {
          const raw = await readFile(this.path('events', `${id}.jsonl`), 'utf8');

          for (const line of raw.trimEnd().split('\n')) {
            try {
              const event = parseTraceEvent(JSON.parse(line));

              if (event.correlation.executionId !== id) {
                complete = false;
                continue;
              }

              if (event.data.kind === 'model_attempt') {
                if ('accounting' in event.data) {
                  calls.push({ executionId: id, accounting: event.data.accounting });
                } else {
                  unaccountedAttemptIds.push(event.data.attemptId);
                  complete = false;
                }
              }
            } catch {
              complete = false;
            }
          }
        } catch (error) {
          if (!isMissing(error)) {
            throw error;
          }

          complete = false;
        }

        executions.push({
          executionId: id,
          mode,
          closed: row.terminal !== null,
          traceComplete: complete,
        });
      }

      for (const filename of await readdir(this.path('resources'))) {
        if (/^[a-f0-9-]{36}\.json$/.test(filename)) {
          resources.push(
            parseResourceCharge(
              JSON.parse(await readFile(this.path('resources', filename), 'utf8')),
            ),
          );
        }
      }

      for (const filename of await readdir(this.path('prices'))) {
        if (/^[a-f0-9]{64}\.json$/.test(filename)) {
          const snapshot = parsePriceSnapshot(
            JSON.parse(await readFile(this.path('prices', filename), 'utf8')),
          );

          if (`${priceSnapshotHash(snapshot)}.json` !== filename) {
            throw new Error('Snapshot harga berubah');
          }

          priceSnapshots.push(snapshot);
        }
      }

      return {
        input: {
          executions,
          calls,
          resources,
          priceSnapshots,
          resourceInventoryComplete,
          parents: [],
        },
        unaccountedAttemptIds,
      };
    });
  }

  finish(
    executionId: string,
    outcome: Exclude<Outcome, 'UNKNOWN'>,
    code: TraceCode | null,
  ): Promise<TraceEvent> {
    if (this.refuseUnrecorded(executionId)) {
      return Promise.reject(new ObservationError('TRACE_WRITE_FAILED'));
    }

    return this.run(async () => {
      this.assertActive(executionId);
      const entry = this.byExecution.get(executionId);
      if (!entry?.sink) {
        throw new ObservationError('EXECUTION_NOT_ACTIVE');
      }

      const event = this.event(entry.start.correlation, this.duration(entry), {
        kind: 'terminal',
        outcome,
        code,
        traceComplete: true,
      });

      try {
        await entry.sink.write(event);
        await publishJson(this.path('terminals', `${executionId}.json`), event);
        entry.terminal = event;
        entry.active = false;
      } catch {
        await this.traceFailure(entry);
      }

      return structuredClone(event);
    });
  }

  startSpan(
    executionId: string,
    stage: Extract<EventData, { kind: 'span_completed' }>['stage'],
    parentSpanId: string | null = null,
  ): {
    readonly spanId: string;
    readonly finish: (
      outcome: 'SUCCESS' | 'FAILED' | 'TIMEOUT',
      code: TraceCode | null,
    ) => Promise<void>;
  } {
    this.assertActive(executionId);
    const spanId = randomUUID();
    const startedMs = this.clock.monotonicMs();
    let finished = false;

    return {
      spanId,
      finish: (outcome, code) => {
        if (finished) {
          return Promise.reject(new Error('Span sudah ditutup'));
        }
        finished = true;

        return this.record(
          executionId,
          { kind: 'span_completed', spanId, parentSpanId, stage, outcome, code },
          Math.max(0, this.clock.monotonicMs() - startedMs),
        );
      },
    };
  }

  reject(input: {
    readonly requestId?: string | null;
    readonly mode?: Mode | null;
    readonly operation?: Operation | null;
    readonly code: TraceCode;
    readonly startedMs: number;
  }): Promise<TraceEvent> {
    const correlation: Correlation = {
      requestId: input.requestId ?? null,
      executionId: null,
      traceId: randomUUID(),
      mode: input.mode ?? null,
      operation: input.operation ?? null,
      experiment: null,
    };
    const event = this.event(correlation, Math.max(0, this.clock.monotonicMs() - input.startedMs), {
      kind: 'admission_rejected',
      outcome: 'FAILED',
      code: input.code,
      traceComplete: true,
    });

    return this.run(async () => {
      await publishJson(this.path('terminals', `rejected-${event.eventId}.json`), event);
      return structuredClone(event);
    });
  }

  reconcile(): Promise<readonly TraceEvent[]> {
    return this.run(async () => {
      const recovered: TraceEvent[] = [];

      for (const entry of this.entries.values()) {
        if (entry.active || entry.terminal) {
          continue;
        }

        const terminal = this.event(entry.start.correlation, null, {
          kind: 'terminal',
          outcome: 'UNKNOWN',
          code: entry.pendingFailure ?? 'CRASH_RECOVERY',
          traceComplete: false,
        });
        await publishJson(
          this.path('terminals', `${entry.start.correlation.executionId ?? ''}.json`),
          terminal,
        );
        entry.terminal = terminal;
        recovered.push(terminal);
      }

      return structuredClone(recovered);
    });
  }

  inspect(): Promise<readonly ObservationInspection[]> {
    return this.run(async () => {
      const rows: ObservationInspection[] = [];

      for (const entry of this.entries.values()) {
        let traceIntegrity: ObservationInspection['traceIntegrity'] = 'VALID';
        let eventCount = 0;

        try {
          const raw = await readFile(
            this.path('events', `${entry.start.correlation.executionId ?? ''}.jsonl`),
            'utf8',
          );
          if (!raw.endsWith('\n')) {
            throw new Error('Torn JSONL');
          }

          const eventIds = new Set<string>();
          const attemptIds = new Set<string>();
          let finalEvent: TraceEvent | null = null;

          for (const line of raw.trimEnd().split('\n')) {
            const event = parseTraceEvent(JSON.parse(line));
            if (
              canonical(event.correlation) !== canonical(entry.start.correlation) ||
              (eventCount === 0 && canonical(event) !== canonical(entry.start)) ||
              (eventCount > 0 && event.data.kind === 'request_started') ||
              eventIds.has(event.eventId) ||
              finalEvent !== null
            ) {
              throw new Error('Trace tidak cocok');
            }

            eventIds.add(event.eventId);
            if (event.data.kind === 'model_attempt') {
              if (attemptIds.has(event.data.attemptId)) {
                throw new Error('Attempt duplikat');
              }
              attemptIds.add(event.data.attemptId);
            }
            if (event.data.kind === 'terminal') {
              finalEvent = event;
            }

            eventCount++;
          }

          if (
            entry.terminal?.data.kind === 'terminal' &&
            entry.terminal.data.traceComplete &&
            canonical(finalEvent) !== canonical(entry.terminal)
          ) {
            throw new Error('Terminal trace hilang');
          }
        } catch (error) {
          traceIntegrity = isMissing(error) ? 'MISSING' : 'INVALID';
        }

        rows.push({
          correlation: entry.start.correlation,
          state:
            entry.terminal?.data.kind === 'terminal' && entry.terminal.data.outcome !== 'UNKNOWN'
              ? 'TERMINAL'
              : entry.active
                ? 'IN_FLIGHT'
                : 'UNKNOWN',
          terminal: entry.terminal,
          traceIntegrity,
          eventCount,
        });
      }

      return structuredClone(rows);
    });
  }

  rejected(): Promise<readonly TraceEvent[]> {
    return this.run(async () => {
      const events: TraceEvent[] = [];

      for (const filename of await readdir(this.path('terminals'))) {
        if (!/^rejected-[a-f0-9-]{36}\.json$/.test(filename)) {
          continue;
        }

        const event = parseTraceEvent(
          JSON.parse(await readFile(this.path('terminals', filename), 'utf8')),
        );
        if (event.data.kind !== 'admission_rejected') {
          throw new Error('Rejection invalid');
        }
        events.push(event);
      }

      return events;
    });
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    await this.tail;

    const results = await Promise.allSettled(
      [...this.entries.values()].map(async (entry) => {
        entry.active = false;
        await entry.sink?.close();
      }),
    );

    if (this.ownsLock) {
      await unlink(this.path('writer.lock'));
      await syncDirectory(this.directory);
      this.ownsLock = false;
    }

    if (results.some((result) => result.status === 'rejected')) {
      throw new ObservationError('TRACE_WRITE_FAILED');
    }
  }
}
