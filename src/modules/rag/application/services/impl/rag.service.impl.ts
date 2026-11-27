import type { Responses } from '@/contracts/types';
import type { RagService } from '@/modules/rag/application/services/rag.service';
import type { PipelineService } from '@/modules/rag/application/services/stages';
import { GenerationError } from '@/shared/errors/generation-error';
import type { Mode, Operation } from '@/shared/operations';

export class RagServiceImpl implements RagService {
  private readonly runners: Readonly<Record<Mode, PipelineService | null>>;

  constructor(runners: Readonly<Record<Mode, PipelineService | null>>) {
    this.runners = Object.freeze({ ...runners });
  }

  execute<K extends Operation>(
    mode: Mode,
    operation: K,
    input: unknown,
    executionId: string,
    signal: AbortSignal,
  ): Promise<Responses[K]> {
    if (!Object.hasOwn(this.runners, mode)) {
      throw new GenerationError('INVALID_INPUT');
    }

    const runner = this.runners[mode];
    if (!runner) {
      throw new GenerationError('DEPENDENCY_NOT_READY');
    }

    return runner(operation, input, executionId, signal);
  }
}
