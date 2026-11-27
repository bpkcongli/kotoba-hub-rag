export async function readProviderJson(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<unknown> {
  if (response.body === null) {
    throw new Error('INVALID_RESPONSE');
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const cancel = (): void => {
    void reader.cancel().catch(() => undefined);
  };

  signal.addEventListener('abort', cancel, { once: true });

  if (signal.aborted) {
    cancel();
  }

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      length += value.byteLength;

      if (length > maxBytes) {
        throw new Error('INVALID_RESPONSE');
      }

      chunks.push(value);
    }

    const body = Buffer.concat(chunks).toString('utf8');

    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new Error('INVALID_RESPONSE');
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    // Do not let an uncooperative stream hold up cancellation or the caller's deadline.
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
