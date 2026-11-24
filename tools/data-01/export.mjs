import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { URL } from 'node:url';
import { buildAudit, sha256 } from './audit.mjs';

const app = resolve(process.env.KOTOBA_APP ?? '../kotoba-hub');
const out = resolve(process.argv[2] ?? 'artifacts/data-01/snapshot-v1');

const requireApp = createRequire(`${app}/package.json`);
const mysql = requireApp('mysql2/promise');

const tables = {
  tracks:
    'id, slug, curriculum_level, title, description, content_revision, seed_schema_version, is_published, created_at, updated_at',
  units:
    'id, track_id, slug, content_revision, seed_schema_version, is_published, created_at, updated_at',
  lessons:
    'id, unit_id, slug, content_revision, seed_schema_version, is_published, created_at, updated_at',
  skills:
    "id, lesson_id, owner_type, group_track_id, code, slug, curriculum_level, skill_type, content, prerequisite_skill_codes, content_revision, seed_schema_version, is_published, created_at, updated_at, JSON_EXTRACT(revision_payload, '$.sourceRefs') AS source_refs",
  lesson_content_blocks:
    "id, lesson_id, block_type, content, sort_order, content_revision, seed_schema_version, is_published, created_at, updated_at, JSON_EXTRACT(revision_payload, '$.sourceRefs') AS source_refs",
  unit_skill_mappings: 'id, unit_id, lesson_id, skill_id, sort_order',
};
const auditColumns =
  'locale, source_revision, translation_revision, is_published, source_ref_payload, created_at, updated_at';

for (const [table, owner, fields] of [
  ['track_translations', 'track_id', 'title, description'],
  ['unit_translations', 'unit_id', 'title, description'],
  ['lesson_translations', 'lesson_id', 'title, learning_objective'],
  ['skill_translations', 'skill_id', 'title, description, content'],
  ['lesson_content_block_translations', 'content_block_id', 'content'],
])
  tables[table] = `${owner}, ${fields}, ${auditColumns}`;

const appState = () => ({
  commit: execFileSync('git', ['-C', app, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  status_sha256: sha256(
    execFileSync('git', ['-C', app, 'status', '--porcelain'], { encoding: 'utf8' }),
  ),
});

let connection;

try {
  await mkdir(out, { recursive: true });
  // Exclusive creation prevents replacing an earlier snapshot, including after a failed export.
  await writeFile(
    `${out}/export-started.json`,
    JSON.stringify({ started_at: new Date().toISOString() }),
    { flag: 'wx' },
  );

  const before = appState();
  const { DATABASE_URL } = parseEnv(await readFile(`${app}/.env`, 'utf8'));
  if (!DATABASE_URL || new URL(DATABASE_URL).protocol !== 'mysql:')
    throw new Error('DATABASE_CONFIG');

  connection = await mysql.createConnection({
    uri: DATABASE_URL,
    connectTimeout: 10000,
    multipleStatements: false,
    supportBigNumbers: true,
    dateStrings: true,
    timezone: 'Z',
  });

  await connection.query('SET SESSION MAX_EXECUTION_TIME=15000');
  await connection.query("SET SESSION time_zone='+00:00'");
  await connection.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');

  const [[clock]] = await connection.query(
    'SELECT UTC_TIMESTAMP(6) AS captured_at, @@transaction_read_only AS session_default_read_only',
  );

  const [schema] = await connection.query(
    'SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?) ORDER BY TABLE_NAME, ORDINAL_POSITION',
    [Object.keys(tables)],
  );
  const [engines] = await connection.query(
    'SELECT TABLE_NAME, ENGINE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?) ORDER BY TABLE_NAME',
    [Object.keys(tables)],
  );

  if (
    engines.length !== Object.keys(tables).length ||
    engines.some((row) => row.ENGINE !== 'InnoDB')
  ) {
    throw new Error('NON_SNAPSHOT_TABLE');
  }

  const data = {};
  for (const [table, columns] of Object.entries(tables)) {
    const [rows] = await connection.query(
      `SELECT ${columns} FROM \`${table}\` ORDER BY 1, 2 LIMIT 50001`,
    );

    if (rows.length > 50000) throw new Error('ROW_LIMIT');

    data[table] = rows;
  }

  // Aggregate only: no prompt, answer, explanation, delivery or learner row is selected.
  const [bankSummary] = await connection.query(
    'SELECT l.id AS lesson_id, COUNT(*) AS question_count, SUM(q.is_published=1) AS published_count, COUNT(DISTINCT CASE WHEN q.is_published=1 THEN q.difficulty_level END) AS published_difficulties, MIN(CASE WHEN q.is_published=1 THEN q.difficulty_level END) AS min_difficulty, MAX(CASE WHEN q.is_published=1 THEN q.difficulty_level END) AS max_difficulty FROM lesson_post_study_questions q JOIN lessons l ON l.id=q.lesson_id GROUP BY l.id ORDER BY l.id',
  );

  await connection.query('ROLLBACK');
  await connection.end();
  connection = undefined;

  const audit = buildAudit(data);
  const payloads = {
    'candidates.jsonl': audit.documents.map((row) => JSON.stringify(row)).join('\n') + '\n',
    'catalog.json': JSON.stringify(audit.catalog, null, 2) + '\n',
    'exclusions.json': JSON.stringify(audit.exclusions, null, 2) + '\n',
    'schema.json': JSON.stringify({ columns: schema, engines }, null, 2) + '\n',
  };

  const after = appState();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('APP_SOURCE_CHANGED');

  const report = {
    schema_version: 'data-01-audit-v1',
    captured_at_utc: clock.captured_at,
    node_version: process.version,
    mysql2_version: requireApp('mysql2/package.json').version,
    app_source: before,
    app_source_unchanged: true,
    transaction: {
      isolation: 'REPEATABLE READ',
      start: 'WITH CONSISTENT SNAPSHOT, READ ONLY',
      end: 'ROLLBACK',
      table_engines: 'InnoDB',
      session_default_read_only: clock.session_default_read_only,
      account_grants_audited: false,
    },
    read_tables: [...Object.keys(tables), 'lesson_post_study_questions (aggregate only)'],
    source_counts: Object.fromEntries(
      Object.entries(data).map(([table, rows]) => [table, rows.length]),
    ),
    track_scope: data.tracks.map(({ id, slug, curriculum_level, is_published }) => ({
      id,
      slug,
      curriculum_level,
      is_published,
    })),
    bank_summary: bankSummary,
    candidate_documents: audit.documents.length,
    by_level: Object.fromEntries(
      ['N5', 'N4'].map((level) => [
        level,
        audit.documents.filter((row) => row.jlpt_level === level).length,
      ]),
    ),
    by_locale: Object.fromEntries(
      ['EN', 'ID'].map((locale) => [
        locale,
        audit.documents.filter((row) => row.locale === locale).length,
      ]),
    ),
    by_type: Object.fromEntries(
      [...new Set(audit.documents.map((row) => row.content_type))]
        .sort()
        .map((type) => [type, audit.documents.filter((row) => row.content_type === type).length]),
    ),
    published_lessons_with_current_locales: new Set(audit.catalog.map((row) => row.lesson_id)).size,
    ingestion_eligible_documents: 0,
    researcher_review: 'not_recorded',
    source_ref_providers: [
      ...new Set(audit.documents.flatMap((row) => row.source_refs.map((ref) => ref.provider))),
    ].sort(),
    artifacts: Object.fromEntries(
      Object.entries(payloads).map(([name, body]) => [
        name,
        { sha256: sha256(body), bytes: Buffer.byteLength(body) },
      ]),
    ),
  };

  for (const [name, body] of Object.entries(payloads))
    await writeFile(`${out}/${name}`, body, { flag: 'wx' });
  await writeFile(`${out}/audit.json`, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });

  console.log(
    JSON.stringify({
      output: out,
      candidate_documents: report.candidate_documents,
      by_level: report.by_level,
      by_locale: report.by_locale,
      ingestion_eligible_documents: 0,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      failed: true,
      code: typeof error?.code === 'string' ? error.code : 'EXPORT_FAILED',
    }),
  );

  process.exitCode = 1;
} finally {
  await connection?.end();
}
