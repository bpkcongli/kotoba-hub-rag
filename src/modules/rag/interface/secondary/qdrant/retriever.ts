import { createHash } from 'node:crypto';
import type { QdrantConfig } from '@/modules/knowledge/application/public';
import {
  checkCollection,
  parseKnowledgePayload,
  QDRANT_VERSION,
  readQdrantConfig,
  StoreError,
  validateEmbeddingBatch,
} from '@/modules/knowledge/application/public';
import type { RetrievalConfig } from '@/modules/rag/application/models/retrieval-config';
import type { RetrieverPort } from '@/modules/rag/application/ports/inference';
import type { RetrievedEvidence, ScoreType } from '@/modules/rag/domain/models/retrieval';
import { RetrievalError } from '@/modules/rag/domain/models/retrieval';
import { fuseRanks, rankedHit } from '@/modules/rag/domain/services/ranking';
import { retrievalConfig } from '@/modules/rag/infrastructure/config/retrieval';
import { readProviderJson } from '@/modules/rag/interface/secondary/inference/provider-json';
import { knowledgeFilter } from '@/modules/rag/interface/secondary/qdrant/knowledge-filter';
import type { Clock } from '@/shared/clock';
import { systemClock } from '@/shared/system-clock';

export const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export interface QdrantRetriever extends RetrieverPort {
  close(): void;
}

export function createQdrantRetriever(
  config: RetrievalConfig,
  qdrantConfig: QdrantConfig,
  dependencies: { readonly fetch?: typeof globalThis.fetch; readonly clock?: Clock } = {},
): QdrantRetriever {
  const settings = retrievalConfig(config.index, {
    RETRIEVAL_CANDIDATE_LIMIT: String(config.candidateLimit),
    RETRIEVAL_LIMIT: String(config.limit),
    RETRIEVAL_MAX_CONCURRENCY: String(config.maxConcurrency),
    RETRIEVAL_TIMEOUT_MS: String(config.timeoutMs),
    RETRIEVAL_MAX_RESPONSE_BYTES: String(config.maxResponseBytes),
  });
  const qdrant = readQdrantConfig({
    QDRANT_ENABLED: 'true',
    QDRANT_URL: qdrantConfig.url,
    QDRANT_API_KEY: qdrantConfig.apiKey,
    QDRANT_TIMEOUT_MS: String(qdrantConfig.timeoutMs),
  });

  if (!qdrant) {
    throw new RetrievalError('DEPENDENCY_ERROR');
  }

  const index = settings.index;
  const fetcher = dependencies.fetch ?? globalThis.fetch;
  const clock = dependencies.clock ?? systemClock;
  const lifetime = new AbortController();
  let active = 0;

  return {
    close: () => lifetime.abort(),
    async retrieve(vector, filter, limit, context) {
      // Snapshot before any await: filter/vector/config may be shared by both mode callers.
      filter = structuredClone(filter);
      vector = structuredClone(vector);
      context = {
        executionId: context.executionId,
        deadlineAt: context.deadlineAt,
        signal: context.signal,
      };
      let queryVector;
      let hardFilter;

      try {
        hardFilter = knowledgeFilter(filter, index);
        queryVector = validateEmbeddingBatch([vector], 1, index.retrievalProfile)[0];
      } catch {
        throw new RetrievalError('INVALID_INPUT');
      }

      if (
        !queryVector ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > settings.candidateLimit
      ) {
        throw new RetrievalError('INVALID_INPUT');
      }

      const budget = Math.min(
        settings.timeoutMs,
        qdrant.timeoutMs,
        Date.parse(context.deadlineAt) - clock.now().getTime(),
      );

      if (
        context.signal.aborted ||
        lifetime.signal.aborted ||
        !Number.isFinite(budget) ||
        budget <= 0
      ) {
        throw new RetrievalError('TIMEOUT');
      }

      if (active >= settings.maxConcurrency) {
        throw new RetrievalError('CAPACITY_LIMIT');
      }

      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, context.signal, lifetime.signal]);
      const timer = setTimeout(() => controller.abort(), budget);
      const started = clock.monotonicMs();
      const collection = encodeURIComponent(index.physicalCollection);
      active++;

      async function request(path: string, body?: unknown): Promise<unknown> {
        if (signal.aborted || clock.monotonicMs() - started >= budget) {
          throw new RetrievalError('TIMEOUT');
        }

        const response = await fetcher(`${qdrant?.url ?? ''}${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          redirect: 'error',
          signal,
          headers: {
            'content-type': 'application/json',
            ...(qdrant?.apiKey === undefined ? {} : { 'api-key': qdrant.apiKey }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });

        if (!response.ok) {
          void response.body?.cancel().catch(() => undefined);
          throw new RetrievalError('DEPENDENCY_ERROR');
        }

        try {
          return await readProviderJson(response, settings.maxResponseBytes, signal);
        } catch {
          throw new RetrievalError(signal.aborted ? 'TIMEOUT' : 'INVALID_RESPONSE');
        }
      }

      function branch(value: unknown, scoreType: ScoreType): readonly RetrievedEvidence[] {
        if (
          !object(value) ||
          !Array.isArray(value.points) ||
          value.points.length > settings.candidateLimit
        ) {
          throw new RetrievalError('INVALID_RESPONSE');
        }

        const ids = new Set<string>();
        const chunks = new Set<string>();
        let previousScore = Infinity;

        return value.points.map((raw: unknown, position) => {
          if (
            !object(raw) ||
            typeof raw.score !== 'number' ||
            !Number.isFinite(raw.score) ||
            raw.score > previousScore
          ) {
            throw new RetrievalError('INVALID_RESPONSE');
          }

          const id =
            typeof raw.id === 'number' && Number.isSafeInteger(raw.id) && raw.id >= 0
              ? String(raw.id)
              : typeof raw.id === 'string' &&
                  /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/.test(
                    raw.id,
                  )
                ? raw.id.toLowerCase()
                : null;

          if (id === null || ids.has(id)) {
            throw new RetrievalError('INVALID_RESPONSE');
          }

          const payload = parseKnowledgePayload(raw.payload);

          if (
            chunks.has(payload.chunk_id) ||
            payload.chunk_id.length > 200 ||
            payload.corpus_version !== index.corpusVersion ||
            payload.embedding_config_id !== index.embeddingConfigId ||
            payload.embedding_revision !== index.embeddingModelRevision ||
            payload.jlpt_level !== filter.targetLevel ||
            !payload.skill_codes.some((skill) => filter.skillCodes.includes(skill)) ||
            createHash('sha256').update(payload.text).digest('hex') !== payload.content_checksum
          ) {
            throw new RetrievalError('INVALID_RESPONSE');
          }

          ids.add(id);
          chunks.add(payload.chunk_id);
          previousScore = raw.score;

          return {
            pointId: id,
            chunkId: payload.chunk_id,
            sourceId: payload.source_id,
            text: payload.text,
            score: raw.score,
            scoreType,
            rank: position + 1,
            parentId: payload.parent_id,
            skillCodes: [...payload.skill_codes],
            jlptLevel: payload.jlpt_level,
            locale: payload.locale,
            lessonSlug: payload.lesson_slug,
            unitSlug: payload.unit_slug,
            trackSlug: payload.track_slug,
            contentChecksum: payload.content_checksum,
            tokenCount: payload.token_count,
          };
        });
      }

      const work = (async () => {
        try {
          const root = await request('/');
          if (!object(root) || root.version !== QDRANT_VERSION) {
            throw new RetrievalError('INCOMPATIBLE_INDEX');
          }

          const collections = await request('/collections');
          if (
            !object(collections) ||
            !object(collections.result) ||
            !Array.isArray(collections.result.collections) ||
            !collections.result.collections.some(
              (item: unknown) => object(item) && item.name === index.physicalCollection,
            )
          ) {
            throw new RetrievalError('INCOMPATIBLE_INDEX');
          }

          const info = await request(`/collections/${collection}`);
          if (
            !object(info) ||
            !object(info.result) ||
            info.result.status === 'red' ||
            info.result.optimizer_status !== 'ok'
          ) {
            throw new RetrievalError('INCOMPATIBLE_INDEX');
          }

          checkCollection(info.result, index, true);

          const base = {
            filter: hardFilter,
            limit: settings.candidateLimit,
            with_payload: true,
            with_vector: false,
          };
          const denseSearch = {
            ...base,
            query: [...queryVector.dense],
            using: 'dense',
            params: { hnsw_ef: 128, exact: false },
          };

          if (index.retrievalProfile === 'DENSE') {
            const result = await request(`/collections/${collection}/points/query`, denseSearch);
            if (!object(result)) {
              throw new RetrievalError('INVALID_RESPONSE');
            }

            const dense = branch(result.result, 'cosine');

            return { candidates: dense.slice(0, limit), dense: dense.map(rankedHit), sparse: null };
          }

          const sparseVector = queryVector.sparse;
          if (!sparseVector) {
            throw new RetrievalError('INVALID_INPUT');
          }

          const result = await request(`/collections/${collection}/points/query/batch`, {
            searches: [
              denseSearch,
              {
                ...base,
                query: { indices: [...sparseVector.indices], values: [...sparseVector.values] },
                using: 'sparse',
              },
            ],
          });

          if (!object(result) || !Array.isArray(result.result) || result.result.length !== 2) {
            throw new RetrievalError('INVALID_RESPONSE');
          }

          const dense = branch(result.result[0], 'cosine');
          const sparse = branch(result.result[1], 'sparse_dot');

          return {
            candidates: fuseRanks(dense, sparse, limit),
            dense: dense.map(rankedHit),
            sparse: sparse.map(rankedHit),
          };
        } finally {
          active--;
        }
      })();

      let onAbort = (): void => undefined;
      const aborted = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new RetrievalError('TIMEOUT'));
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) {
          onAbort();
        }
      });

      try {
        const result = await Promise.race([work, aborted]);
        if (signal.aborted || clock.monotonicMs() - started >= budget) {
          throw new RetrievalError('TIMEOUT');
        }

        return result;
      } catch (error) {
        if (signal.aborted) {
          throw new RetrievalError('TIMEOUT');
        }

        if (error instanceof RetrievalError) {
          throw error;
        }

        if (error instanceof StoreError) {
          throw new RetrievalError(
            error.code === 'INCOMPATIBLE_INDEX' || error.code === 'INVALID_MANIFEST'
              ? 'INCOMPATIBLE_INDEX'
              : 'INVALID_RESPONSE',
          );
        }

        throw new RetrievalError('DEPENDENCY_ERROR');
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        controller.abort();
      }
    },
  };
}
