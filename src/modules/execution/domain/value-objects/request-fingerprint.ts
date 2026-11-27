import { canonical, hashValue } from '@/shared/hash';
import type { Mode, Operation } from '@/shared/operations';

// Only the digest crosses the durable boundary; raw requests are never retained here.
export class RequestFingerprint {
  readonly value: string;

  private constructor(value: string) {
    this.value = value;
    Object.freeze(this);
  }

  static from(input: {
    readonly operation: Operation;
    readonly mode: Mode;
    readonly experiment?: unknown;
    readonly request: unknown;
  }): RequestFingerprint {
    return new RequestFingerprint(
      hashValue(canonical([input.operation, input.mode, input.experiment ?? null, input.request])),
    );
  }
}
