import type { Responses } from '@/contracts/types';
import type { Mode, Operation } from '@/shared/operations';

export interface RagService {
  execute<K extends Operation>(
    mode: Mode,
    operation: K,
    input: unknown,
    executionId: string,
    signal: AbortSignal,
  ): Promise<Responses[K]>;
}
