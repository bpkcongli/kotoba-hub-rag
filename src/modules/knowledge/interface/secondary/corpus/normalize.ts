import {
  canonical,
  hash,
  jsonObject,
  parseChunkConfig,
  string,
} from '@/modules/knowledge/application/validation';
import type {
  ApprovedCorpus,
  ApprovedSource,
  ChunkConfig,
  Json,
  NormalizedLesson,
  PedagogicalUnit,
  SourceSpan,
} from '@/modules/knowledge/domain/models/ingestion';
import { IngestionError } from '@/modules/knowledge/domain/models/ingestion';
import { htmlToText, normalizeText } from '@/modules/knowledge/interface/secondary/corpus/text';

interface Piece {
  readonly source: ApprovedSource;

  readonly path: string;

  readonly raw: string;

  readonly html: boolean;
}

interface UnitDraft {
  readonly kind: PedagogicalUnit['kind'];

  readonly sources: ApprovedSource[];

  readonly pieces: Piece[];
}

function pieces(source: ApprovedSource): Piece[] {
  const result: Piece[] = [];

  const add = (path: string, raw: Json | undefined, html = false): void => {
    if (raw === undefined || raw === null) {
      return;
    }

    result.push({ source, path: `$.content.${path}`, raw: string(raw), html });
  };

  const list = (path: string, value: Json | undefined): void => {
    if (value === undefined) {
      return;
    }

    if (!Array.isArray(value)) {
      throw new IngestionError('INVALID_SOURCE');
    }

    value.forEach((item, index) => add(`${path}[${index}]`, item));
  };

  const content = source.content;

  if (source.content_type === 'PARAGRAPH') {
    add('title', content.title);
    add('body', content.body, true);

    if (content.body === undefined) {
      throw new IngestionError('INVALID_SOURCE');
    }
  } else if (source.content_type === 'EXAMPLE_SENTENCE') {
    add('japaneseSentence', string(content.japaneseSentence), true);
    add('translation', string(content.translation), true);
  } else if (source.content_type === 'GRAMMAR_STRUCTURE') {
    for (const form of ['ALL', 'STANDARD', 'POLITE']) {
      add(form, content[form], true);
    }
  } else {
    const sourceContent = jsonObject(content.canonical);
    const localized = jsonObject(content.localized);

    add('localized.title', localized.title);
    add('localized.description', localized.description);

    if (source.content_type === 'GRAMMAR') {
      const grammar = jsonObject(sourceContent.grammar);

      add('canonical.grammar.pattern', grammar.pattern);
      list('canonical.grammar.structureLines', grammar.structureLines);
      add('localized.grammar.meaning', jsonObject(localized.grammar).meaning);
    } else if (source.content_type === 'VOCABULARY') {
      const vocabulary = jsonObject(sourceContent.vocabulary);

      add('canonical.vocabulary.primarySpelling', vocabulary.primarySpelling);
      list('canonical.vocabulary.alternateSpellings', vocabulary.alternateSpellings);
      list('canonical.vocabulary.readings', vocabulary.readings);
      list('localized.vocabulary.glosses', jsonObject(localized.vocabulary).glosses);
    } else {
      add('canonical.reading.passageText', string(jsonObject(sourceContent.reading).passageText));
      add('localized.reading.translation', string(jsonObject(localized.reading).translation));
    }
  }

  if (result.length === 0) {
    throw new IngestionError('EMPTY_CONTENT');
  }

  return result;
}

export function normalizeCorpus(
  corpus: ApprovedCorpus,
  input: ChunkConfig,
): readonly NormalizedLesson[] {
  const config = parseChunkConfig(input);
  const normalizationVersion = `html-fields-v1-${config.unicode}`;

  const groups = new Map<string, ApprovedSource[]>();

  for (const source of corpus.sources) {
    if (
      !source.ingestion_eligible ||
      !source.published ||
      source.researcher_review !== 'approved'
    ) {
      throw new IngestionError('INVALID_SOURCE');
    }

    const key = `${source.lesson_id}:${source.locale}`;
    const group = groups.get(key) ?? [];
    group.push(source);
    groups.set(key, group);
  }

  const output: NormalizedLesson[] = [];

  for (const [key, group] of [...groups.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    const first = group[0];

    if (!first) {
      throw new IngestionError('EMPTY_CONTENT');
    }

    const skills = group.filter((source) => source.source_table === 'skills');
    const codes = new Set(skills.flatMap((source) => source.skill_codes));
    const sourceIds = new Set<string>();

    for (const source of group) {
      if (
        sourceIds.has(source.source_id) ||
        [
          'parent_id',
          'track_id',
          'track_slug',
          'unit_id',
          'unit_slug',
          'lesson_slug',
          'jlpt_level',
        ].some(
          (field) => source[field as keyof ApprovedSource] !== first[field as keyof ApprovedSource],
        ) ||
        source.skill_codes.some((code) => !codes.has(code))
      ) {
        throw new IngestionError('INVALID_SOURCE');
      }

      sourceIds.add(source.source_id);
    }

    const drafts: UnitDraft[] = [];
    const attachedSkills = new Set<string>();
    const blocks = group
      .filter((source) => source.source_table === 'lesson_content_blocks')
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

    if (new Set(blocks.map((block) => block.sort_order)).size !== blocks.length) {
      throw new IngestionError('INVALID_SOURCE');
    }

    for (const block of blocks) {
      if (block.content_type === 'EXAMPLE_SENTENCE') {
        const previous = drafts.at(-1);

        if (previous) {
          previous.sources.push(block);
          previous.pieces.push(...pieces(block));
        } else {
          drafts.push({ kind: 'example', sources: [block], pieces: pieces(block) });
        }
      } else if (block.content_type === 'GRAMMAR_STRUCTURE') {
        const code = string(block.content.skillCode);
        const matched = skills.filter(
          (skill) => skill.content_type === 'GRAMMAR' && skill.skill_codes.includes(code),
        );

        if (matched.length !== 1) {
          throw new IngestionError('INVALID_SOURCE');
        }

        const selected = [...matched, block];
        for (const skill of matched) {
          attachedSkills.add(skill.source_id);
        }

        drafts.push({ kind: 'grammar', sources: selected, pieces: selected.flatMap(pieces) });
      } else if (block.content_type === 'PARAGRAPH') {
        drafts.push({ kind: 'narrative', sources: [block], pieces: pieces(block) });
      } else {
        throw new IngestionError('INVALID_SOURCE');
      }
    }

    for (const skill of skills
      .filter((source) => !attachedSkills.has(source.source_id))
      .sort((a, b) => (a.source_id < b.source_id ? -1 : a.source_id > b.source_id ? 1 : 0))) {
      drafts.push({
        kind:
          skill.content_type === 'READING'
            ? 'reading'
            : skill.content_type === 'GRAMMAR'
              ? 'grammar'
              : 'lexical',
        sources: [skill],
        pieces: pieces(skill),
      });
    }

    let text = '';
    const units: PedagogicalUnit[] = [];

    for (const draft of drafts) {
      if (text.length > 0) {
        text += '\n\n';
      }

      const start = text.length;
      const spans: SourceSpan[] = [];

      for (const piece of draft.pieces) {
        const normalized = piece.html
          ? htmlToText(piece.raw, config.unicode)
          : normalizeText(piece.raw, config.unicode);

        if (!normalized) {
          throw new IngestionError('EMPTY_CONTENT');
        }

        if (spans.length > 0) {
          text += '\n';
        }

        const pieceStart = text.length;
        text += normalized;

        spans.push({
          sourceId: piece.source.source_id,
          jsonPath: piece.path,
          rawStart: 0,
          rawEnd: piece.raw.length,
          rawChecksum: hash(piece.raw),
          start: pieceStart,
          end: text.length,
        });
      }

      const ids = [...new Set(draft.sources.map((source) => source.source_id))].sort();

      units.push({
        id: `unit_${hash(canonical({ ids, normalizationVersion, text: text.slice(start) }))}`,
        kind: draft.kind,
        start,
        end: text.length,
        sourceIds: ids,
        skillCodes: [...new Set(draft.sources.flatMap((source) => source.skill_codes))].sort(),
        spans,
      });
    }

    if (!text || units.length > 10000 || text.length > 2 * 1024 * 1024) {
      throw new IngestionError('EMPTY_CONTENT');
    }

    const represented = new Set(units.flatMap((unit) => unit.sourceIds));
    if (represented.size !== sourceIds.size || [...sourceIds].some((id) => !represented.has(id))) {
      throw new IngestionError('INTEGRITY_ERROR');
    }

    output.push({
      id: `kotobahub:lesson-text:${key}`,
      parentId: first.parent_id,
      corpusVersion: corpus.corpusVersion,
      locale: first.locale,
      jlptLevel: first.jlpt_level === 'N5' ? 'JLPT_N5' : 'JLPT_N4',
      trackSlug: first.track_slug,
      unitSlug: first.unit_slug,
      lessonSlug: first.lesson_slug,
      normalizationVersion,
      text,
      checksum: hash(text),
      units,
    });
  }

  return output;
}
