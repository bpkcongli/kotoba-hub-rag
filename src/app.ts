import Fastify, { LogController } from 'fastify';
import type { FastifyInstance } from 'fastify';
import { systemClock } from '@/adapters/system-clock';
import { createContractValidators } from '@/contracts/validator';
import type { ContractValidators } from '@/contracts/validator';
import type { AppConfig } from '@/shared/config';
import type { Clock } from '@/shared/ports';

export interface Application {
  readonly server: FastifyInstance;
  readonly clock: Clock;
  readonly contracts: ContractValidators;
}

export function createApplication(config: AppConfig, clock: Clock = systemClock): Application {
  const contracts = createContractValidators();
  const server = Fastify({
    bodyLimit: 1048576,
    logger: {
      level: config.logLevel,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    // Request URLs, headers, and bodies may contain learner data; log only explicit bootstrap events.
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

  server.get('/health/live', () => ({ status: 'live' }));

  // Index, provider, and pipeline dependencies are not connected yet; report not ready.
  server.get('/health/ready', (_request, reply) => reply.code(503).send({ status: 'not_ready' }));

  return { server, clock, contracts };
}
