export const HF_IDENTITY = Object.freeze({
  provider: 'hf-inference',
  embeddingModel: 'BAAI/bge-m3',
  embeddingEndpoint:
    'https://router.huggingface.co/hf-inference/models/BAAI/bge-m3/pipeline/feature-extraction',
  rerankerModel: 'BAAI/bge-reranker-v2-m3',
  rerankerEndpoint: 'https://router.huggingface.co/hf-inference/models/BAAI/bge-reranker-v2-m3',
  configVersion: 'hf-inf-02-v1',
  // Hub commits from discovery are not attested served revisions. No revision parameter is sent.
  servedModelRevision: null,
  tokenizerRevision: null,
  processingRevision: null,
  region: null,
});
