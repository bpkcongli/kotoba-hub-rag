import type { ExecutionRegistryService } from '@/modules/execution/application/services/execution-registry.service';

export interface RetryAuditPort {
  readonly record: ExecutionRegistryService['record'];
}
