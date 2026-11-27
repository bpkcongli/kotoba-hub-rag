import { performance } from 'node:perf_hooks';
import type { Clock } from '@/shared/clock';

export const systemClock: Clock = {
  now: () => new Date(),

  monotonicMs: () => performance.now(),
};
