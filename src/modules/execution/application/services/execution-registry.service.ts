import type { ExecutionRegistryPort } from '@/modules/execution/application/ports/execution-registry';

export type {
  AdmissionInput,
  AdmissionResult,
  ObservationInspection,
  ObservationOptions,
} from '@/modules/execution/application/ports/execution-registry';

export interface ExecutionRegistryService {
  readonly lookup: ExecutionRegistryPort['lookup'];

  readonly storeResponse: ExecutionRegistryPort['storeResponse'];

  readonly readResponse: ExecutionRegistryPort['readResponse'];

  readonly admit: ExecutionRegistryPort['admit'];

  readonly assertActive: ExecutionRegistryPort['assertActive'];

  readonly activeCorrelation: ExecutionRegistryPort['activeCorrelation'];

  readonly assertAdmittedRequest: ExecutionRegistryPort['assertAdmittedRequest'];

  readonly failExecutionTrace: ExecutionRegistryPort['failExecutionTrace'];

  readonly record: ExecutionRegistryPort['record'];

  readonly priceCall: ExecutionRegistryPort['priceCall'];

  readonly executionAccounting: ExecutionRegistryPort['executionAccounting'];

  readonly recordResource: ExecutionRegistryPort['recordResource'];

  readonly exportAccounting: ExecutionRegistryPort['exportAccounting'];

  readonly finish: ExecutionRegistryPort['finish'];

  readonly startSpan: ExecutionRegistryPort['startSpan'];

  readonly reject: ExecutionRegistryPort['reject'];

  readonly reconcile: ExecutionRegistryPort['reconcile'];

  readonly inspect: ExecutionRegistryPort['inspect'];

  readonly rejected: ExecutionRegistryPort['rejected'];

  readonly close: ExecutionRegistryPort['close'];

  readonly currentPriceSnapshot: ExecutionRegistryPort['currentPriceSnapshot'];
}
