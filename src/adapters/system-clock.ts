import { performance } from 'node:perf_hooks';
import type { Clock } from '@/shared/ports';

export const systemClock: Clock = {
  now: () => new Date(),

  monotonicMs: () => performance.now(),
};
