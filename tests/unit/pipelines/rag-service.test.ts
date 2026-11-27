import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Responses } from '@/contracts/types';
import { RagServiceImpl } from '@/modules/rag/application/services/impl/rag.service.impl';
import type { PipelineService } from '@/modules/rag/application/services/stages';
import type { Mode, Operation } from '@/shared/operations';

await test('RAG facade dispatches each explicit mode once with the original operation and execution context', async () => {
  const modes: readonly Mode[] = ['LLM_ONLY', 'SINGLE_STAGE', 'ADAPTIVE'];
  const calls: unknown[][] = [];
  const stopped = new Error('fixture-stop');
  const runner =
    (mode: Mode): PipelineService =>
    <K extends Operation>(...args: Parameters<PipelineService>): Promise<Responses[K]> => {
      calls.push([mode, ...args]);
      return Promise.reject(stopped);
    };
  const service = new RagServiceImpl({
    LLM_ONLY: runner('LLM_ONLY'),
    SINGLE_STAGE: runner('SINGLE_STAGE'),
    ADAPTIVE: runner('ADAPTIVE'),
  });
  const input = { untouched: true };
  const signal = new AbortController().signal;

  for (const mode of modes) {
    await assert.rejects(service.execute(mode, 'generate', input, 'execution', signal), stopped);
  }

  assert.deepEqual(
    calls,
    modes.map((mode) => [mode, 'generate', input, 'execution', signal]),
  );
});

await test('an unavailable requested mode fails without invoking another mode', () => {
  let calls = 0;
  const available: PipelineService = () => {
    calls++;
    return Promise.reject(new Error('unexpected-call'));
  };
  const runners = { LLM_ONLY: available, SINGLE_STAGE: null, ADAPTIVE: null };
  const service = new RagServiceImpl(runners);

  assert.throws(
    () => service.execute('ADAPTIVE', 'recommend', {}, 'execution', new AbortController().signal),
    { code: 'DEPENDENCY_NOT_READY' },
  );

  for (const mode of ['toString', '__proto__']) {
    assert.throws(
      () =>
        service.execute(mode as Mode, 'recommend', {}, 'execution', new AbortController().signal),
      { code: 'INVALID_INPUT' },
    );
  }

  assert.equal(calls, 0);
});
