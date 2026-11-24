import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { IngestionError } from '@/ingestion/types';
import type { TokenCounter } from '@/ingestion/types';
import { canonical, hash, object } from '@/ingestion/validation';

export const BGE_TOKENIZER = Object.freeze({
  model: 'BAAI/bge-m3',
  revision: '5617a9f61b028005a4858fdac845db406aefb181',
  engine: 'tokenizers@0.23.2',
  files: {
    'tokenizer.json': '21106b6d7dab2952c1d496fb21d5dc9db75c28ed361a05f5020bbba27810dd08',
    'tokenizer_config.json': 'a62b2b6784f990259fddef5f16388693a8043be4f69179e6a5257eeb3f9abac4',
  },
});

export async function loadBgeTokenCounter(directory: string): Promise<TokenCounter> {
  try {
    const files = new Map<string, Record<string, unknown>>();

    for (const [name, expected] of Object.entries(BGE_TOKENIZER.files)) {
      const path = resolve(directory, name);

      if ((await stat(path)).size > 20 * 1024 * 1024) {
        throw new IngestionError('INVALID_TOKENIZER');
      }

      const body = await readFile(path);

      if (body.byteLength > 20 * 1024 * 1024 || hash(body) !== expected) {
        throw new IngestionError('INVALID_TOKENIZER');
      }

      files.set(name, object(JSON.parse(body.toString('utf8'))));
    }

    const model = files.get('tokenizer.json');
    const config = files.get('tokenizer_config.json');

    if (
      !model ||
      !config ||
      model.truncation !== null ||
      model.padding !== null ||
      config.model_max_length !== 8192
    ) {
      throw new IngestionError('INVALID_TOKENIZER');
    }

    // The pinned native package ships invalid .d.ts declarations. Check only
    // the API we use at runtime; keep strict NodeNext and skipLibCheck=false.
    const packageName = 'tokenizers';
    const imported: unknown = await import(packageName);
    const factory: unknown = object(imported).Tokenizer;
    if (typeof factory !== 'function') {
      throw new IngestionError('INVALID_TOKENIZER');
    }

    const fromString: unknown = Reflect.get(factory, 'fromString');
    if (typeof fromString !== 'function') {
      throw new IngestionError('INVALID_TOKENIZER');
    }

    const tokenizer: unknown = Reflect.apply(fromString, factory, [JSON.stringify(model)]);

    const invoke = (target: unknown, name: string, args: readonly unknown[]): unknown => {
      const method = object(target)[name];

      if (typeof method !== 'function') {
        throw new IngestionError('INVALID_TOKENIZER');
      }

      return Reflect.apply(method, target, args);
    };

    invoke(tokenizer, 'disableTruncation', []);
    invoke(tokenizer, 'disablePadding', []);

    const length = async (text: string, addSpecialTokens: boolean): Promise<number> => {
      const result: unknown = await invoke(tokenizer, 'encode', [text, null, { addSpecialTokens }]);
      const overflowing = invoke(result, 'getOverflowing', []);
      const size = invoke(result, 'getLength', []);

      if (
        !Array.isArray(overflowing) ||
        overflowing.length !== 0 ||
        typeof size !== 'number' ||
        !Number.isSafeInteger(size) ||
        size < 0
      ) {
        throw new IngestionError('INVALID_TOKENIZER');
      }

      return size;
    };

    const identity = Object.freeze({
      id: `bge-m3-${hash(canonical(BGE_TOKENIZER)).slice(0, 24)}`,
      model: BGE_TOKENIZER.model,
      revision: BGE_TOKENIZER.revision,
      engine: BGE_TOKENIZER.engine,
    });

    return {
      identity,
      async count(text) {
        const content = await length(text, false);
        const total = await length(text, true);

        if (total !== content + 2) {
          throw new IngestionError('INVALID_TOKENIZER');
        }

        return { content, special: 2, total };
      },
    };
  } catch {
    throw new IngestionError('INVALID_TOKENIZER');
  }
}
