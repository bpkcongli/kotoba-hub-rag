import type { TraceEvent } from '@/modules/observability/application/events';

export interface TraceSink {
  write(event: TraceEvent): Promise<void>;

  close(): Promise<void>;
}
