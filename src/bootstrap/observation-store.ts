import type { ObservationOptions } from '@/modules/execution/application/services/execution-registry.service';
import { ExecutionRegistryServiceImpl } from '@/modules/execution/application/services/impl/execution-registry.service.impl';
import { createExecutionRegistry } from '@/modules/execution/infrastructure/di/index';
import { createAuditInfrastructure } from '@/modules/observability/infrastructure/di/index';
import {
  recordGenerationAttempt,
  recordHfAttempt,
} from '@/modules/rag/interface/secondary/inference/attempt-recorder';
import type { InferenceAttempt } from '@/modules/rag/interface/secondary/inference/hf-inference';
import type { GenerationAttempt } from '@/modules/rag/interface/secondary/inference/openai-responses';
import type { Clock } from '@/shared/clock';
import { systemClock } from '@/shared/system-clock';

// Compatibility composition for CLI/tests; application consumers depend on the registry interface.
export class ObservationStore extends ExecutionRegistryServiceImpl {
  constructor(directory: string, clock: Clock = systemClock, options: ObservationOptions = {}) {
    const audit = createAuditInfrastructure();
    super(
      createExecutionRegistry(directory, clock, {
        ...options,
        ...audit,
        sinkFactory: options.sinkFactory ?? audit.sinkFactory,
      }),
    );
  }

  recordHfAttempt(attempt: InferenceAttempt): Promise<void> {
    return recordHfAttempt(this, attempt);
  }

  recordGenerationAttempt(attempt: GenerationAttempt): Promise<void> {
    return recordGenerationAttempt(this, attempt);
  }
}
