export interface Clock {
  now(): Date;

  monotonicMs(): number;
}
