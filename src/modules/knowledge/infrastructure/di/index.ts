import { open, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { QdrantConfig } from '@/modules/knowledge/application/connection-settings';
import type { IndexValidation } from '@/modules/knowledge/application/models/index-store';
import { IndexingServiceImpl } from '@/modules/knowledge/application/services/impl/indexing.service.impl';
import type {
  IndexingOptions,
  IndexingService,
} from '@/modules/knowledge/application/services/indexing.service';
import {
  appendJournal,
  durableWrite,
  readJournal,
  syncDirectory,
} from '@/modules/knowledge/interface/secondary/corpus/index-job';
import { readBounded } from '@/modules/knowledge/interface/secondary/corpus/index-plan';
import { QdrantIndexStore } from '@/modules/knowledge/interface/secondary/qdrant/qdrant-index';

export const indexingService: IndexingService = new IndexingServiceImpl({
  processId: process.pid,
  resolve,
  readBounded,
  readBytes: readFile,
  openLock: (file) => open(file, 'wx', 0o600),
  durableWrite,
  appendJournal,
  readJournal,
  syncDirectory,
  remove: rm,
});

export function runIndexJob(options: IndexingOptions): Promise<IndexValidation | null> {
  return indexingService.run(options);
}

export function createKnowledgeModule(config: QdrantConfig | null) {
  return { storage: config ? new QdrantIndexStore(config) : null };
}
