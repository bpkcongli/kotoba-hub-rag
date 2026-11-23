import Fastify, { LogController } from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { HfConfig } from '@/adapters/hf-config';
import { createHfInference } from '@/adapters/hf-inference';
import type { HfInference } from '@/adapters/hf-inference';
import { systemClock } from '@/adapters/system-clock';
import { createContractValidators } from '@/contracts/validator';
import type { ContractValidators } from '@/contracts/validator';
import type { AppConfig } from '@/shared/config';
import type { Clock } from '@/shared/ports';

export interface Application {
  readonly server: FastifyInstance;
  readonly clock: Clock;
  readonly contracts: ContractValidators;
  readonly inference: HfInference | null;
}

export function createApplication(
  config: AppConfig,
  clock: Clock = systemClock,
  hfConfig: HfConfig | null = null,
): Application {
  const contracts = createContractValidators();
  const server = Fastify({
    bodyLimit: 1048576,
    logger: {
      level: config.logLevel,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    // Request URLs, headers, and bodies may contain learner data; log only explicit sanitized events.
    logController: new LogController({ disableRequestLogging: true }),
    forceCloseConnections: true,
    ajv: {
      customOptions: {
        coerceTypes: false,
        useDefaults: false,
        removeAdditional: false,
      },
    },
  });

  const inference = hfConfig
    ? createHfInference(hfConfig, {
        clock,
        onAttempt: (attempt) => {
          server.log.info({ inferenceAttempt: attempt }, 'HF inference attempt');

          return Promise.resolve();
        },
      })
    : null;

  server.addHook('onClose', () => {
    inference?.close();
    return Promise.resolve();
  });

  server.get('/health/live', () => ({ status: 'live' }));

  // Capability is local evidence, not live provider health. Index and pipeline are still absent.
  server.get('/health/ready', (_request, reply) => reply.code(503).send({ status: 'not_ready' }));

  return { server, clock, contracts, inference };
}
