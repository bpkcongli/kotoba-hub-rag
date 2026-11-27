import { canonical, hash, parseChunkConfig } from '@/modules/knowledge/application/validation';
import type {
  ChunkConfig,
  NormalizedLesson,
  PreparedChunk,
  TokenCounter,
} from '@/modules/knowledge/domain/models/ingestion';
import { IngestionError } from '@/modules/knowledge/domain/models/ingestion';

export async function chunkLessons(
  lessons: readonly NormalizedLesson[],
  input: ChunkConfig,
  counter: TokenCounter,
): Promise<readonly PreparedChunk[]> {
  const config = parseChunkConfig(input);
  const chunkingVersion = `${config.version}-${hash(canonical({ config, tokenizer: counter.identity })).slice(0, 24)}`;

  const chunks: PreparedChunk[] = [];

  const measured = async (text: string): ReturnType<TokenCounter['count']> => {
    const result = await counter.count(text);

    if (
      ![result.content, result.special, result.total].every(Number.isSafeInteger) ||
      result.content < 1 ||
      result.special < 0 ||
      result.total !== result.content + result.special
    ) {
      throw new IngestionError('INVALID_TOKENIZER');
    }

    return result;
  };

  for (const lesson of lessons) {
    let fresh = 0;
    let previousStart = 0;
    let chunkIndex = 0;

    const unit = (index: number) => {
      const value = lesson.units[index];

      if (!value) {
        throw new IngestionError('INVALID_SOURCE');
      }

      return value;
    };

    const textBetween = (start: number, end: number): string =>
      lesson.text.slice(unit(start).start, unit(end - 1).end);

    while (fresh < lesson.units.length) {
      if ((await measured(textBetween(fresh, fresh + 1))).total > config.maxTokens) {
        throw new IngestionError('ATOMIC_UNIT_TOO_LARGE');
      }

      let start = fresh;
      while (start > previousStart && fresh - start < config.overlapUnits && start > 0) {
        const proposed = start - 1;

        if (
          (await measured(textBetween(proposed, fresh))).content > config.overlapTokens ||
          (await measured(textBetween(proposed, fresh + 1))).total > config.maxTokens
        ) {
          break;
        }

        start = proposed;
      }

      let end = fresh + 1;
      while (
        end < lesson.units.length &&
        (await measured(textBetween(start, end + 1))).total <= config.maxTokens
      ) {
        end++;
      }

      const selected = lesson.units.slice(start, end);
      const text = textBetween(start, end);
      const tokens = await measured(text);
      const contentChecksum = hash(text);

      const sourceIds = [...new Set(selected.flatMap((item) => item.sourceIds))].sort();
      const unitIds = selected.map((item) => item.id);

      chunks.push({
        chunkId: `chunk_${hash(canonical({ corpus: lesson.corpusVersion, parent: lesson.id, unitIds, contentChecksum, chunkingVersion }))}`,
        sourceId: lesson.id,
        parentId: lesson.parentId,
        corpusVersion: lesson.corpusVersion,
        locale: lesson.locale,
        jlptLevel: lesson.jlptLevel,
        trackSlug: lesson.trackSlug,
        unitSlug: lesson.unitSlug,
        lessonSlug: lesson.lessonSlug,
        skillCodes: [...new Set(selected.flatMap((item) => item.skillCodes))].sort(),
        sourceIds,
        unitIds,
        overlapUnitIds: lesson.units.slice(start, fresh).map((item) => item.id),
        start: unit(start).start,
        end: unit(end - 1).end,
        offsetUnit: 'UTF16_CODE_UNITS',
        chunkIndex,
        text,
        contentChecksum,
        tokenCount: tokens.total,
        contentTokenCount: tokens.content,
        specialTokenCount: tokens.special,
        tokenizerId: counter.identity.id,
        chunkingVersion,
        normalizationVersion: lesson.normalizationVersion,
        spans: selected.flatMap((item) => item.spans),
      });

      previousStart = start;
      fresh = end;
      chunkIndex++;
    }
  }

  return chunks;
}
