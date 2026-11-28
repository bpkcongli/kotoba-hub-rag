import schema from '@contracts/rubric/rubric.schema.json' with { type: 'json' };
import { Ajv2020 } from 'ajv/dist/2020.js';
import { default as addFormats } from 'ajv-formats';
import { canonicalRubricContent } from '@/modules/knowledge/application/rubric-canonical';
import { canonical, hash } from '@/modules/knowledge/application/validation';
import type { ApprovedCorpus } from '@/modules/knowledge/domain/models/ingestion';
import type {
  GradingPolicy,
  PolicyRef,
  RubricBundle,
  RubricBundleManifest,
  RubricFileRef,
  RubricGuidance,
} from '@/modules/knowledge/domain/models/rubric';

export class RubricError extends Error {
  readonly code: 'INVALID_RUBRIC' | 'UNTRUSTED_RUBRIC' | 'RUBRIC_INTEGRITY' | 'RUBRIC_SCOPE';

  constructor(code: RubricError['code']) {
    super(`Rubric rejected: ${code}`);
    this.name = 'RubricError';
    this.code = code;
  }
}

const ajv = new Ajv2020({
  strict: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
});
addFormats.default(ajv);
ajv.addSchema(schema);

const validatePolicy = ajv.compile<GradingPolicy>({ $ref: `${schema.$id}#/$defs/policy` });
const validateGuidance = ajv.compile<RubricGuidance>({ $ref: `${schema.$id}#/$defs/guidance` });
const text = { type: 'string', minLength: 1, maxLength: 512, pattern: '\\S' };
const digest = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const fileRef = {
  type: 'object',
  additionalProperties: false,
  required: ['path', 'sha256'],
  properties: { path: text, sha256: digest },
};
const validateManifest = ajv.compile<RubricBundleManifest>({
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'corpusVersion',
    'sourceCorpus',
    'trustedReviewers',
    'policy',
    'guidances',
  ],
  properties: {
    schemaVersion: { const: 'uc-02-rubric-bundle-v1' },
    corpusVersion: text,
    sourceCorpus: {
      type: 'object',
      additionalProperties: false,
      required: ['corpusVersion', 'manifestSha256'],
      properties: { corpusVersion: text, manifestSha256: digest },
    },
    trustedReviewers: {
      type: 'array',
      minItems: 1,
      maxItems: 32,
      uniqueItems: true,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'role'],
        properties: { id: text, role: text },
      },
    },
    policy: fileRef,
    guidances: { type: 'array', minItems: 1, maxItems: 4096, uniqueItems: true, items: fileRef },
  },
});

const bundles = new WeakSet<RubricBundle>();

function immutable<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) {
      immutable(child);
    }

    Object.freeze(value);
  }

  return value;
}

export function parseRubricManifest(value: unknown): RubricBundleManifest {
  if (!validateManifest(value)) {
    throw new RubricError('INVALID_RUBRIC');
  }

  const names = [value.policy.path, ...value.guidances.map((entry) => entry.path)];

  if (
    new Set(names).size !== names.length ||
    names.some(
      (name) =>
        name.startsWith('/') ||
        name.includes('\\') ||
        name.split('/').some((part) => part === '..' || part === '.' || !part),
    )
  ) {
    throw new RubricError('INVALID_RUBRIC');
  }

  return immutable(structuredClone(value));
}

export function rubricRef(document: PolicyRef): PolicyRef {
  return { id: document.id, revision: document.revision, contentSha256: document.contentSha256 };
}

export function samePolicyRef(left: PolicyRef, right: PolicyRef): boolean {
  return (
    left.id === right.id &&
    left.revision === right.revision &&
    left.contentSha256 === right.contentSha256
  );
}

export function assertRubricBundle(value: RubricBundle): void {
  if (!bundles.has(value)) {
    throw new RubricError('UNTRUSTED_RUBRIC');
  }
}

export function parseRubricBundle(
  manifestInput: unknown,
  documents: ReadonlyMap<string, string>,
  sourceCorpus: ApprovedCorpus,
): RubricBundle {
  const manifest = parseRubricManifest(manifestInput);

  if (
    manifest.corpusVersion === sourceCorpus.corpusVersion ||
    manifest.sourceCorpus.corpusVersion !== sourceCorpus.corpusVersion ||
    manifest.sourceCorpus.manifestSha256 !== sourceCorpus.manifestSha256
  ) {
    throw new RubricError('RUBRIC_INTEGRITY');
  }

  const read = (ref: RubricFileRef): unknown => {
    const body = documents.get(ref.path);

    if (body === undefined || hash(body) !== ref.sha256) {
      throw new RubricError('RUBRIC_INTEGRITY');
    }

    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new RubricError('INVALID_RUBRIC');
    }
  };

  const approve = (document: GradingPolicy | RubricGuidance): void => {
    if (
      document.status !== 'APPROVED' ||
      document.approval === null ||
      document.provenance.usageScope !== 'INTERNAL_RUNTIME' ||
      document.provenance.license === null ||
      !manifest.trustedReviewers.some(
        (reviewer) =>
          reviewer.id === document.approval?.approvedBy && reviewer.role === document.approval.role,
      )
    ) {
      throw new RubricError('UNTRUSTED_RUBRIC');
    }

    if (
      hash(canonicalRubricContent(document.content)) !== document.contentSha256 ||
      document.approval.reviewedContentSha256 !== document.contentSha256
    ) {
      throw new RubricError('RUBRIC_INTEGRITY');
    }
  };

  const policy = read(manifest.policy);

  if (!validatePolicy(policy)) {
    throw new RubricError('INVALID_RUBRIC');
  }

  approve(policy);

  const policyRef = rubricRef(policy);
  const identities = new Set<string>([`${policy.id}:${policy.revision}`]);
  const scopes = new Set<string>();
  const guidances = manifest.guidances.map((entry) => {
    const guidance = read(entry);

    if (!validateGuidance(guidance)) {
      throw new RubricError('INVALID_RUBRIC');
    }

    approve(guidance);

    const identity = `${guidance.id}:${guidance.revision}`;
    const scope = guidance.content.scope;
    const locale = guidance.content.locale.toUpperCase();
    const scopeKey = canonical({ ...scope, locale });

    if (
      identities.has(identity) ||
      scopes.has(scopeKey) ||
      !samePolicyRef(guidance.content.policyRef, policyRef)
    ) {
      throw new RubricError('RUBRIC_INTEGRITY');
    }

    if (
      !sourceCorpus.sources.some(
        (source) =>
          source.published &&
          source.ingestion_eligible &&
          source.researcher_review === 'approved' &&
          source.hold_reasons.length === 0 &&
          source.jlpt_level === scope.jlptLevel &&
          source.track_slug === scope.trackSlug &&
          source.unit_slug === scope.unitSlug &&
          source.lesson_slug === scope.lessonSlug &&
          source.skill_codes.includes(scope.skillCode) &&
          source.locale === locale,
      )
    ) {
      throw new RubricError('RUBRIC_SCOPE');
    }

    identities.add(identity);
    scopes.add(scopeKey);

    return guidance;
  });

  const bundle = immutable({
    corpusVersion: manifest.corpusVersion,
    policyRef,
    policy,
    guidances,
    sourceCorpus: structuredClone(sourceCorpus),
  });
  bundles.add(bundle);

  return bundle;
}

export { canonicalRubricContent } from '@/modules/knowledge/application/rubric-canonical';
