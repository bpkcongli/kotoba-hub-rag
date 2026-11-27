import type { FastifyInstance } from 'fastify';
import {
  createOperationController,
  operationPaths,
} from '@/modules/rag/interface/primary/rest/controller';
import type { OperationRoutesOptions } from '@/modules/rag/interface/primary/rest/controller';
import type { Operation } from '@/shared/operations';

export type { OperationRoutesOptions } from '@/modules/rag/interface/primary/rest/controller';

export function registerOperationRoutes(
  server: FastifyInstance,
  options: OperationRoutesOptions,
): void {
  const controller = createOperationController(options);

  server.addHook('onRequest', controller.authenticate);
  server.setErrorHandler(controller.handleError);
  server.addHook('preClose', controller.close);

  server.get('/health/live', () => ({ status: 'live' }));
  server.get('/health/ready', controller.readiness);

  for (const operation of Object.keys(operationPaths) as Operation[]) {
    server.post(operationPaths[operation], (request, reply) =>
      controller.execute(operation, request, reply),
    );
  }
}
