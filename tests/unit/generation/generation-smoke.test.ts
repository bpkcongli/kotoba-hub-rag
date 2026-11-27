import assert from 'node:assert/strict';
import { test } from 'node:test';
import fixtures from '@contracts/v1/fixtures.json' with { type: 'json' };
import { runSmoke, syntheticSmokeCase } from '@/modules/rag/interface/primary/smoke';

await test('smoke default hanya plan; execute tanpa budget memadai ditolak sebelum dispatch', async (t) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => {
    calls++;
    return Promise.reject(new Error('Tidak boleh call'));
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const before = JSON.stringify(fixtures);

  const synthetic = syntheticSmokeCase('generate');
  await runSmoke([], {});

  await assert.rejects(
    runSmoke(['--execute', '--max-calls=4', '--max-budget-usd=0.092'], {
      OPENAI_API_KEY: 'fixture-token',
    }),
  );
  await assert.rejects(
    runSmoke(['--execute', '--max-calls=5', '--max-budget-usd=0.1'], {
      OPENAI_API_KEY: 'fixture-token',
    }),
  );

  assert.equal(synthetic.request.payload.questionCount, 1);
  assert.equal(synthetic.output.questions.length, 1);
  assert.equal(JSON.stringify(fixtures), before);
  assert.equal(calls, 0);
});
