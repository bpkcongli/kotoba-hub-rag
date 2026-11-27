import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { RequestFingerprint } from '@/modules/execution/domain/value-objects/request-fingerprint';

await test('fingerprint preserves the existing canonical digest across key order and Japanese text', () => {
  const first = RequestFingerprint.from({
    operation: 'generate',
    mode: 'SINGLE_STAGE',
    request: { text: '日本語', n: 1 },
  });
  const expected = createHash('sha256')
    .update('["generate","SINGLE_STAGE",null,{"n":1,"text":"日本語"}]')
    .digest('hex');

  const reordered = RequestFingerprint.from({
    operation: 'generate',
    mode: 'SINGLE_STAGE',
    experiment: null,
    request: { n: 1, text: '日本語' },
  });

  assert.equal(first.value, expected);
  assert.equal(reordered.value, first.value);
  assert.equal(Object.isFrozen(first), true);
  assert.deepEqual(Object.keys(first), ['value']);
  assert.notEqual(
    RequestFingerprint.from({
      operation: 'generate',
      mode: 'ADAPTIVE',
      request: { text: '日本語', n: 1 },
    }).value,
    first.value,
  );
});

await test('fingerprinting rejects non-JSON values before any persistence or inference', () => {
  for (const request of [undefined, { value: NaN }, { value: () => 1 }, new Map()]) {
    assert.throws(() =>
      RequestFingerprint.from({ operation: 'evaluate', mode: 'LLM_ONLY', request }),
    );
  }
});
