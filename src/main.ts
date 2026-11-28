import { createApplication } from '@/app';
import { readConfig } from '@/bootstrap/config';
import { readGradingBundle } from '@/bootstrap/grading-config';
import { readExecutionPolicy } from '@/modules/execution/application/execution-policy';
import { readQdrantConfig } from '@/modules/knowledge/application/connection-settings';
import { readDeepPolicy } from '@/modules/rag/application/pipelines/deep-config';
import { readEvidencePolicy } from '@/modules/rag/application/pipelines/evidence';
import { readRouterPolicy } from '@/modules/rag/application/pipelines/router';
import { readContextConfig } from '@/modules/rag/infrastructure/config/context';
import { readHfConfig } from '@/modules/rag/infrastructure/config/hf-config';
import { readOpenAiConfig } from '@/modules/rag/infrastructure/config/openai-config';
import { readRetrievalConfig } from '@/modules/rag/infrastructure/config/retrieval';
import { ConfigError } from '@/shared/errors/config-error';
import { systemClock } from '@/shared/system-clock';

async function main(): Promise<void> {
  // Validate configuration before creating resources or opening the listener.
  const config = readConfig(process.env);
  const rubric = await readGradingBundle(process.env);
  const hfConfig = readHfConfig(process.env);
  const qdrantConfig = readQdrantConfig(process.env);
  const openAiConfig = readOpenAiConfig(process.env);
  const retrievalConfig = await readRetrievalConfig(process.env);
  const contextConfig = openAiConfig ? readContextConfig(process.env, openAiConfig) : null;
  const evidencePolicy = readEvidencePolicy(process.env);
  const routerPolicy = readRouterPolicy(process.env);
  const deepPolicy = readDeepPolicy(process.env);
  const executionPolicy = readExecutionPolicy(process.env);

  const { server } = createApplication(
    config,
    systemClock,
    hfConfig,
    qdrantConfig,
    undefined,
    openAiConfig,
    retrievalConfig,
    contextConfig,
    evidencePolicy,
    routerPolicy,
    deepPolicy,
    executionPolicy,
    rubric,
  );

  let closing = false;

  const shutdown = (): void => {
    if (closing) {
      return;
    }

    closing = true;

    const timer = setTimeout(() => process.exit(1), config.shutdownTimeoutMs);
    timer.unref();

    void server
      .close()
      .then(() => {
        clearTimeout(timer);
      })
      .catch(() => {
        // Keep the shutdown deadline if closing fails while resource handles remain active.
        process.exitCode = 1;
      });
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  try {
    await server.listen({ host: config.host, port: config.port });
  } catch {
    await server.close();

    process.removeListener('SIGTERM', shutdown);
    process.removeListener('SIGINT', shutdown);

    throw new Error('Listener gagal dijalankan');
  }
}

void main().catch((error: unknown) => {
  // Do not serialize raw errors or environment values; config errors contain field names only.
  process.stderr.write(
    `${error instanceof ConfigError ? error.message : 'Startup service gagal'}\n`,
  );

  process.exitCode = 1;
});
