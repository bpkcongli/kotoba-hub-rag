import { readHfConfig } from '@/adapters/hf-config';
import { readOpenAiConfig } from '@/adapters/openai-config';
import { systemClock } from '@/adapters/system-clock';
import { createApplication } from '@/app';
import { readRetrievalConfig } from '@/retrieval/config';
import { ConfigError, readConfig } from '@/shared/config';
import { readQdrantConfig } from '@/storage/qdrant-config';

async function main(): Promise<void> {
  // Validate configuration before creating resources or opening the listener.
  const config = readConfig(process.env);
  const hfConfig = readHfConfig(process.env);
  const qdrantConfig = readQdrantConfig(process.env);
  const openAiConfig = readOpenAiConfig(process.env);
  const retrievalConfig = await readRetrievalConfig(process.env);

  const { server } = createApplication(
    config,
    systemClock,
    hfConfig,
    qdrantConfig,
    undefined,
    openAiConfig,
    retrievalConfig,
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
