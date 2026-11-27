export interface IndexJobPort {
  readonly processId: number;

  syncDirectory(this: void, directory: string): Promise<void>;

  resolve(this: void, ...segments: string[]): string;

  readBounded(this: void, path: string, maxBytes?: number): Promise<string>;

  readBytes(this: void, path: string): Promise<Uint8Array>;

  openLock(
    this: void,
    path: string,
  ): Promise<{
    writeFile(value: string): Promise<void>;
    sync(): Promise<void>;
    close(): Promise<void>;
  }>;

  durableWrite(this: void, path: string, value: unknown): Promise<void>;

  appendJournal(
    this: void,
    directory: string,
    event: Readonly<Record<string, unknown>>,
  ): Promise<void>;

  readJournal(this: void, directory: string): Promise<readonly Record<string, unknown>[]>;

  remove(this: void, path: string): Promise<void>;
}
