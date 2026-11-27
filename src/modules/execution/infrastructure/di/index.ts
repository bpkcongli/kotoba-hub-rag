import type { ExecutionRegistryPort } from '@/modules/execution/application/ports/execution-registry';
import type { FileRegistryOptions } from '@/modules/execution/interface/secondary/persistence/file-execution-registry';
import { FileExecutionRegistry } from '@/modules/execution/interface/secondary/persistence/file-execution-registry';
import type { Clock } from '@/shared/clock';

export function createExecutionRegistry(
  directory: string,
  clock: Clock,
  options: FileRegistryOptions,
): ExecutionRegistryPort {
  return new FileExecutionRegistry(directory, clock, options);
}
