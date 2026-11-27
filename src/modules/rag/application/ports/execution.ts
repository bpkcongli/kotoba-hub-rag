import type { ExecutionRegistryService } from '@/modules/execution/application/public';

export interface RagExecutionPort {
  readonly assertActive: ExecutionRegistryService['assertActive'];

  readonly activeCorrelation: ExecutionRegistryService['activeCorrelation'];

  readonly assertAdmittedRequest: ExecutionRegistryService['assertAdmittedRequest'];

  readonly startSpan: ExecutionRegistryService['startSpan'];

  readonly record: ExecutionRegistryService['record'];

  readonly executionAccounting: ExecutionRegistryService['executionAccounting'];

  readonly failExecutionTrace: ExecutionRegistryService['failExecutionTrace'];

  readonly finish: ExecutionRegistryService['finish'];
}
