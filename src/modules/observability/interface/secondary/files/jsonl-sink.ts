import type { FileHandle } from 'node:fs/promises';
import { open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseTraceEvent } from '@/modules/observability/application/events';
import type { TraceSink } from '@/modules/observability/application/ports/trace-sink';
import { syncDirectory } from '@/shared/files';

export class JsonlTraceSink implements TraceSink {
  private readonly handle: Promise<FileHandle>;

  private tail: Promise<void> = Promise.resolve();

  private failed = false;

  private closed = false;

  private pending = 0;

  constructor(path: string) {
    this.handle = open(path, 'wx', 0o600).then(async (handle) => {
      try {
        await syncDirectory(dirname(path));
        return handle;
      } catch (error) {
        await handle.close();
        throw error;
      }
    });
    // The first write/close reports initialization failure without an unhandled rejection.
    void this.handle.catch(() => {
      this.failed = true;
    });
  }

  write(value: unknown): Promise<void> {
    if (this.closed || this.failed || this.pending >= 128) {
      return Promise.reject(new Error('TRACE_WRITE_FAILED'));
    }

    // Validate and serialize now so caller mutation cannot alter queued data.
    let line: string;

    try {
      line = `${JSON.stringify(parseTraceEvent(value))}\n`;
      if (Buffer.byteLength(line) > 65536) {
        throw new Error('Event terlalu besar');
      }
    } catch {
      return Promise.reject(new Error('TRACE_WRITE_FAILED'));
    }

    this.pending++;
    const task = this.tail
      .then(async () => {
        if (this.failed) {
          throw new Error('TRACE_WRITE_FAILED');
        }

        const handle = await this.handle;
        await handle.writeFile(line);
        await handle.sync();
      })
      .catch(() => {
        this.failed = true;
        throw new Error('TRACE_WRITE_FAILED');
      })
      .finally(() => {
        this.pending--;
      });

    this.tail = task.catch(() => undefined);
    return task;
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    await this.tail;
    await (await this.handle).close();

    if (this.failed) {
      throw new Error('TRACE_WRITE_FAILED');
    }
  }
}
