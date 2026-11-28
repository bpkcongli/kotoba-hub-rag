import type { ApprovedCorpus } from '@/modules/knowledge/domain/models/ingestion';

export interface PolicyRef {
  readonly id: string;
  readonly revision: number;
  readonly contentSha256: string;
}

export interface RubricApproval {
  readonly approvedBy: string;
  readonly role: string;
  readonly approvedAt: string;
  readonly reviewedContentSha256: string;
}

export interface RubricProvenance {
  readonly authorship: 'HUMAN_AUTHORED' | 'AI_ASSISTED';
  readonly sourceRefs: readonly {
    readonly repository: 'kotoba-hub' | 'kotoba-hub-rag';
    readonly path: string;
    readonly fileSha256: string;
    readonly role: 'CURRENT_BEHAVIOR' | 'PROPOSED_POLICY' | 'CURRICULUM_SCOPE';
  }[];
  readonly license: string | null;
  readonly usageScope: 'DESIGN_REVIEW_ONLY' | 'INTERNAL_RUNTIME';
}

export interface RubricDocument extends PolicyRef {
  readonly schemaVersion: '1.0.0';
  readonly status: 'DRAFT' | 'APPROVED' | 'RETIRED';
  readonly approval: RubricApproval | null;
  readonly provenance: RubricProvenance;
}

export interface LocalizedAnchor {
  readonly en: string;
  readonly id: string;
}

export interface GradingPolicy extends RubricDocument {
  readonly kind: 'FREE_RESPONSE_GRADING_POLICY';
  readonly content: {
    readonly scope: {
      readonly operation: 'GRADE_PRACTICE_ANSWER';
      readonly questionType: 'FREE_RESPONSE';
      readonly sourceLanguages: readonly ['EN', 'ID'];
      readonly answerLanguage: 'JA';
      readonly jlptLevels: readonly ['N5', 'N4'];
    };
    readonly criteria: {
      readonly meaning: {
        readonly maxPoints: 60;
        readonly anchors: Readonly<Record<'0' | '20' | '40' | '60', LocalizedAnchor>>;
      };
      readonly grammar: {
        readonly maxPoints: 30;
        readonly anchors: Readonly<Record<'0' | '10' | '20' | '30', LocalizedAnchor>>;
      };
      readonly naturalness: {
        readonly maxPoints: 10;
        readonly anchors: Readonly<Record<'0' | '5' | '10', LocalizedAnchor>>;
      };
    };
    readonly scoring: {
      readonly profile: 'MEANING_60_GRAMMAR_30_NATURALNESS_10_V1';
      readonly algorithm: 'SUM_THEN_CAP_V1';
      readonly integerScores: true;
      readonly passThreshold: 80;
      readonly maxScoreByMeaning: Readonly<Record<'0' | '20' | '40' | '60', number>>;
      readonly majorGrammarScores: readonly [0, 10];
      readonly majorGrammarCap: 79;
      readonly reconstructionNaturalnessScore: 0;
      readonly reconstructionNaturalnessCap: 79;
    };
    readonly equivalence: {
      readonly referenceRole: 'NON_EXHAUSTIVE_EXAMPLE';
      readonly acceptNaturalKanaKanjiVariants: true;
      readonly acceptNaturalEllipsis: true;
      readonly acceptEquivalentVocabularyAndWordOrder: true;
      readonly registerPolicy: 'ACCEPT_PLAIN_OR_POLITE_UNLESS_SOURCE_CONSTRAINS';
      readonly requireExactReferenceGrammarPattern: false;
      readonly sourceLocaleAffectsScore: false;
    };
    readonly inputHandling: {
      readonly preserveSubmittedRepresentations: true;
      readonly rawRomajiRole: 'AUXILIARY_ONLY';
      readonly normalizationConflict: 'UNGRADABLE';
      readonly sourceReferenceConflict: 'UNGRADABLE';
      readonly materialSourceAmbiguity: 'UNGRADABLE';
    };
    readonly feedback: {
      readonly localeSource: 'language.feedbackLocale';
      readonly minLength: 1;
      readonly maxLength: 500;
      readonly format: 'PLAIN_TEXT';
      readonly includePrimaryReason: true;
    };
    readonly failureHandling: {
      readonly ungradable: 'FAIL_WITHOUT_GRADE';
      readonly insufficientEvidence: 'FAIL_WITHOUT_GRADE';
      readonly providerFailure: 'FAIL_WITHOUT_GRADE';
    };
  };
}

export interface RubricGuidance extends RubricDocument {
  readonly kind: 'FREE_RESPONSE_RUBRIC_GUIDANCE';
  readonly content: {
    readonly policyRef: PolicyRef;
    readonly scope: {
      readonly questionType: 'FREE_RESPONSE';
      readonly jlptLevel: 'N5' | 'N4';
      readonly trackSlug: string;
      readonly unitSlug: string;
      readonly lessonSlug: string;
      readonly skillCode: string;
    };
    readonly locale: 'en' | 'id';
    readonly semanticChecks: readonly string[];
    readonly acceptableVariations: readonly string[];
    readonly commonErrors: readonly { readonly code: string; readonly description: string }[];
    readonly illustrations: readonly {
      readonly sourceLanguage: 'EN' | 'ID';
      readonly sourceSentence: string;
      readonly japaneseAnswer: string;
      readonly relationship: 'EQUIVALENT' | 'MEANING_CHANGED' | 'GRAMMAR_ERROR';
      readonly explanation: string;
    }[];
  };
}

export interface RubricFileRef {
  readonly path: string;
  readonly sha256: string;
}

export interface RubricBundleManifest {
  readonly schemaVersion: 'uc-02-rubric-bundle-v1';
  readonly corpusVersion: string;
  readonly sourceCorpus: { readonly corpusVersion: string; readonly manifestSha256: string };
  readonly trustedReviewers: readonly { readonly id: string; readonly role: string }[];
  readonly policy: RubricFileRef;
  readonly guidances: readonly RubricFileRef[];
}

export interface RubricBundle {
  readonly corpusVersion: string;
  readonly policyRef: PolicyRef;
  readonly policy: GradingPolicy;
  readonly guidances: readonly RubricGuidance[];
  readonly sourceCorpus: ApprovedCorpus;
}
