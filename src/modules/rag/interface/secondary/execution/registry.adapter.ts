import type { ExecutionRegistryService } from '@/modules/execution/application/public';
import type { RagExecutionPort } from '@/modules/rag/application/ports/execution';

export class ExecutionRegistryAdapter implements RagExecutionPort {
  private readonly registry: ExecutionRegistryService;

  constructor(registry: ExecutionRegistryService) {
    this.registry = registry;
  }

  assertActive: ExecutionRegistryService['assertActive'] = (...args) =>
    this.registry.assertActive(...args);

  activeCorrelation: ExecutionRegistryService['activeCorrelation'] = (...args) =>
    this.registry.activeCorrelation(...args);

  assertAdmittedRequest: ExecutionRegistryService['assertAdmittedRequest'] = (...args) =>
    this.registry.assertAdmittedRequest(...args);

  startSpan: ExecutionRegistryService['startSpan'] = (...args) => this.registry.startSpan(...args);

  record: ExecutionRegistryService['record'] = (...args) => this.registry.record(...args);

  executionAccounting: ExecutionRegistryService['executionAccounting'] = (...args) =>
    this.registry.executionAccounting(...args);

  failExecutionTrace: ExecutionRegistryService['failExecutionTrace'] = (...args) =>
    this.registry.failExecutionTrace(...args);

  finish: ExecutionRegistryService['finish'] = (...args) => this.registry.finish(...args);
}
