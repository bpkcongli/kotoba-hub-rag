import type { IndexManifest } from '@/modules/knowledge/application/index-manifest';
import { parseIndexManifest, StoreError } from '@/modules/knowledge/application/index-manifest';
import type { RetrievalFilter } from '@/modules/knowledge/domain/models/retrieval-filter';

function validateRubricScope(input: RetrievalFilter): void {
  if (input.language !== undefined && !['EN', 'ID'].includes(input.language)) {
    throw new StoreError('INVALID_CONTENT');
  }

  if (input.contentType !== undefined && input.contentType !== 'RUBRIC') {
    throw new StoreError('INVALID_CONTENT');
  }

  const policy = input.policyRef;

  if ((input.contentType === 'RUBRIC') !== (policy !== undefined)) {
    throw new StoreError('INVALID_CONTENT');
  }

  if (policy === undefined) {
    return;
  }

  if (typeof policy !== 'object' || policy === null || input.language === undefined) {
    throw new StoreError('INVALID_CONTENT');
  }

  if (typeof policy.id !== 'string' || !policy.id.trim() || policy.id.length > 512) {
    throw new StoreError('INVALID_CONTENT');
  }

  if (!Number.isSafeInteger(policy.revision) || policy.revision < 1) {
    throw new StoreError('INVALID_CONTENT');
  }

  if (!/^[a-f0-9]{64}$/.test(policy.contentSha256)) {
    throw new StoreError('INVALID_CONTENT');
  }
}

export function validateKnowledgeScope(
  input: RetrievalFilter,
  value: IndexManifest,
): IndexManifest {
  const manifest = parseIndexManifest(value);

  if (
    input.published !== true ||
    input.corpusVersion !== manifest.corpusVersion ||
    !['JLPT_N5', 'JLPT_N4'].includes(input.targetLevel)
  ) {
    throw new StoreError('INVALID_CONTENT');
  }

  if (input.skillCodes.length < 1 || input.skillCodes.length > 64) {
    throw new StoreError('INVALID_CONTENT');
  }

  if (
    input.skillCodes.some((code) => typeof code !== 'string' || !code.trim() || code.length > 128)
  ) {
    throw new StoreError('INVALID_CONTENT');
  }

  validateRubricScope(input);

  return manifest;
}
