/**
 * Best-effort "Sentence case" using two independent proper-noun signals, combined:
 *
 *  1. `compromise`, a small rule-based NLP library with its own built-in lexicon of common
 *     names/places/organizations — cheap, and crucially *casing-invariant*: it recognizes
 *     "paris" as a place from its dictionary alone, even in all-lowercase or ALL-CAPS input.
 *     Its weakness is that anything outside that fixed lexicon is just a capitalization
 *     guess (see `CONFIRMED_PROPER_NOUN_TAGS` below).
 *  2. A small transformer NER (named-entity-recognition) model (`classifyWithTransformer`,
 *     run via `@huggingface/transformers`/WASM — see that function's own doc comment) —
 *     genuinely learned, context-aware entity detection, far better than compromise's
 *     guesswork at telling "Fox" the surname from "fox" the animal. Its weakness is the
 *     mirror image of compromise's strength: it leans on normal capitalization as training
 *     signal, so it's noticeably weaker on already all-caps/all-lowercase input.
 *
 * Neither alone covers both cases well, so this module runs both and lets either one
 * promote a word to "confirmed" (see `isConfirmed` in `applySentenceCase`) — compromise
 * covers the casing-mangled-input case, the NER model covers everything else compromise's
 * lexicon doesn't happen to contain.
 *
 * Deliberately separate from `convertCase`/`CASE_TYPES` in wordCounter.ts: every other case
 * type is a synchronous, deterministic string transform, while this one needs async
 * dynamically-imported dependencies and produces a second output (which words it wasn't
 * sure about) — forcing it into the same interface would violate ISP for every other case
 * button that doesn't need any of that.
 *
 * compromise ships no separate @types package and its own `.json()` typings are `any`
 * (verified in node_modules/compromise/types/view/one.d.ts) — CompromiseTerm/Sentence below
 * re-establish a typed boundary immediately at the import site rather than letting `any`
 * leak into this module.
 */

interface CompromiseTerm {
  text: string;
  pre: string;
  post: string;
  normal: string;
  tags: string[];
}

interface CompromiseSentence {
  terms: CompromiseTerm[];
}

/**
 * Tags that mean compromise matched this word against a known name/place/org list, not
 * just a capitalization guess. Empirically confirmed via node_modules/compromise@14.16.0:
 * a mid-sentence capitalized common noun (e.g. "Fox", "Dog") gets tagged only `ProperNoun`
 * with none of these — that's the "guessed, please review" case this module flags.
 */
const CONFIRMED_PROPER_NOUN_TAGS = [
  'Person', 'FirstName', 'LastName', 'MaleName', 'FemaleName',
  'Place', 'City', 'Country', 'Region', 'Address',
  'Organization', 'Acronym',
];

/** Matches "I", "I'm", "I've", "I'll", "I'd" regardless of input casing or apostrophe style. */
const I_CONTRACTION_RE = /^i(['’](m|ve|ll|d))?$/i;

/**
 * Common function words that can immediately follow a name-introducing trigger without
 * actually being a name — "named after", "called for" — so the word after "named"/"called"
 * isn't blindly trusted. Deliberately short: broad enough to catch the frequent real
 * false-positive phrasings, not an attempt at an exhaustive stopword list.
 */
const NAME_SLOT_GUARD_WORDS = new Set([
  'after', 'before', 'for', 'by', 'in', 'on', 'at', 'with', 'without', 'because', 'so',
  'that', 'which', 'who', 'as', 'like', 'than', 'off', 'out', 'up', 'down', 'over', 'to',
]);

/**
 * Finds words sitting in a name-introducing slot — "named X", "called X", "known as X",
 * "name is X" — regardless of whether X is capitalized in the input or appears in any name
 * lexicon. This is what compromise's own tagging alone cannot do: it can only guess from a
 * word's own capitalization or a fixed name list, so a lowercase, unrecognized name like
 * "pranshi" in "my daughter's name is pranshi" gets no signal at all otherwise. Operates on
 * compromise's already-tokenized terms (not raw text) so word boundaries and normalization
 * ("Name" vs "name") are already handled consistently with the rest of this module.
 */
function findContextualNameSlots(terms: CompromiseTerm[]): Set<number> {
  const slots = new Set<number>();
  for (let i = 0; i < terms.length; i += 1) {
    const normal = terms[i]!.normal;
    let slotIndex = -1;
    if (normal === 'named' || normal === 'called') {
      slotIndex = i + 1;
    } else if (normal === 'known' && terms[i + 1]?.normal === 'as') {
      slotIndex = i + 2;
    } else if (normal === 'name' && (terms[i + 1]?.normal === 'is' || terms[i + 1]?.normal === 'was')) {
      slotIndex = i + 2;
    }

    const candidate = slotIndex >= 0 ? terms[slotIndex] : undefined;
    if (candidate && !NAME_SLOT_GUARD_WORDS.has(candidate.normal)) {
      slots.add(slotIndex);
    }
  }
  return slots;
}

export interface TextRange {
  start: number;
  end: number;
}

export interface LowConfidenceRange extends TextRange {
  /**
   * The reasons get different defaults, not just different hover text, now that a click can
   * flip any of them in a moment (see `toggleGuessedCase`):
   *  - 'unrecognized': the word isn't an ordinary English word at all, so a stray-capital
   *    explanation is implausible — kept capitalized by default (e.g. "Pramil", "SpaceX").
   *  - 'commonWord': the word is also an ordinary English word (e.g. "Fox", "Name"), so it's
   *    a genuine toss-up between "real name" and "capitalized out of habit" — demoted to
   *    lowercase by default instead, since that's no longer a one-way door.
   *  - 'contextual': the word sits in a name-introducing slot ("named X", "name is X") —
   *    see `findContextualNameSlots`. A stronger signal than capitalization alone, so it's
   *    kept capitalized by default even when the word was lowercase in the original input
   *    (this is the only reason that can flag a word the input never capitalized at all).
   */
  reason: 'commonWord' | 'unrecognized' | 'contextual';
  /**
   * The word's form if it IS a name — e.g. "SpaceX", capital preserved as guessed — kept
   * regardless of which form is currently shown, so `toggleGuessedCase` can produce either
   * side of the toggle without re-deriving a generic capitalization that would flatten a
   * stylized brand name's internal capital.
   */
  original: string;
}

export interface SentenceCaseResult {
  text: string;
  /**
   * Words compromise guessed are proper nouns from capitalization/context alone, with no
   * match in its known name/place/organization lists — worth a second look before trusting.
   */
  lowConfidenceRanges: LowConfidenceRange[];
}

/** The four CoNLL-2003 entity types the NER model below was fine-tuned on — person, org,
 *  location, and a catch-all "miscellaneous" for nationalities/events/other proper nouns. */
export type NerEntityType = 'PER' | 'ORG' | 'LOC' | 'MISC';

/** One entity span from the NER model, as character offsets into the *original* input text
 *  passed to `classify` — not into compromise's per-sentence terms, which is why
 *  `applySentenceCase` below tracks its own running input-text cursor to align the two. */
export interface NerEntity {
  type: NerEntityType;
  /** The model's own confidence for this span, 0-1. */
  score: number;
  start: number;
  end: number;
}

/** Runs NER over a whole block of text. Injected into `applySentenceCase` (rather than
 *  called directly) purely for testability — see that function's doc comment — with
 *  `classifyWithTransformer` below as the one real, production implementation. */
export type NerClassifier = (text: string) => Promise<NerEntity[]>;

/** Below this score, a NER hit is treated the same as compromise's own uncertain
 *  capitalization guess — flagged for review rather than trusted outright. Not tuned against
 *  a labeled validation set; chosen as a reasonable operating point for a CoNLL-trained
 *  model, which typically reports ~90-95% F1 at its default decision boundary. */
const NER_CONFIDENT_THRESHOLD = 0.85;

/** ONNX port of `dslim/distilbert-NER` (Apache-2.0), itself DistilBERT fine-tuned on the
 *  English CoNLL-2003 NER dataset — the same 4-class scheme as `NerEntityType`. Loaded via
 *  `@huggingface/transformers` (Apache-2.0), which runs it through ONNX Runtime Web/WASM
 *  entirely in the browser, same as this site's other on-device AI tools (Background
 *  Remover, Face & Plate Blur) — nothing here is ever uploaded anywhere. */
const NER_MODEL_ID = 'onnx-community/distilbert-NER-ONNX';

/** The shape `@huggingface/transformers`' token-classification pipeline resolves to and
 *  returns, trimmed to the fields this module actually reads. The package ships its own
 *  types, but importing them here would pull its whole type surface into this module just
 *  for two call shapes — a local, minimal boundary is clearer at the call site below. */
type TokenClassificationEntity = { entity_group: string; score: number; start: number; end: number };
type TokenClassifierPipeline = (text: string, options: { aggregation_strategy: 'simple' }) => Promise<TokenClassificationEntity[]>;
interface TransformersModule {
  pipeline: (task: 'token-classification', model: string, options?: { dtype?: string }) => Promise<TokenClassifierPipeline>;
}

// Loaded lazily, once per session — the model is ~40 MB quantized, far too heavy to ever
// bundle or fetch on page load. Cached at module scope like Background Remover's own
// `ortModulePromise`/`sessionPromise`, so only the first "Sentence case" click on a given
// page load pays the download/instantiation cost.
let classifierPromise: Promise<TokenClassifierPipeline> | null = null;
function loadClassifier(): Promise<TokenClassifierPipeline> {
  classifierPromise ??= (import('@huggingface/transformers') as Promise<TransformersModule>).then(({ pipeline }) =>
    // 'q8': int8-quantized weights — a large accuracy-preserving size cut versus the default
    // fp32 export, the same trade-off `onnxruntime-web` callers elsewhere on this site make.
    pipeline('token-classification', NER_MODEL_ID, { dtype: 'q8' })
  );
  return classifierPromise;
}

const NER_ENTITY_TYPES = new Set<string>(['PER', 'ORG', 'LOC', 'MISC']);

/**
 * The real, production `NerClassifier`: runs the whole input through the transformer model
 * in one pass (aggregated so multi-word entities like "John Smith" come back as one span,
 * not two) and maps its output to this module's own minimal `NerEntity` shape.
 *
 * Deliberately not itself unit-tested — like `removeBackgroundFromImage` in
 * `backgroundRemove.ts`, it depends on a real multi-megabyte WASM model with no meaningful
 * way to fake at this layer. `applySentenceCase`'s own merge logic (the part with real
 * decisions to get right) takes `classify` as a parameter specifically so *that* can be unit
 * tested against a fake classifier instead — see `sentenceCase.test.ts`.
 */
export async function classifyWithTransformer(text: string): Promise<NerEntity[]> {
  let classify: TokenClassifierPipeline;
  try {
    classify = await loadClassifier();
  } catch (error) {
    // Lets a retry actually retry instead of permanently caching a failed load.
    classifierPromise = null;
    throw new Error(
      `Could not load the name-detection AI model — check your connection and try again. (${error instanceof Error ? error.message : String(error)})`
    );
  }

  const output = await classify(text, { aggregation_strategy: 'simple' });
  const entities: NerEntity[] = [];
  for (const item of output) {
    if (!NER_ENTITY_TYPES.has(item.entity_group)) continue; // e.g. stray sub-token labels the aggregator didn't merge
    entities.push({ type: item.entity_group as NerEntityType, score: item.score, start: item.start, end: item.end });
  }
  return entities;
}

function capitalize(word: string): string {
  if (word === '') return word;
  return word[0]!.toUpperCase() + word.slice(1).toLowerCase();
}

/** True for a tail like "paceX" (SpaceX) or "ayPal" (PayPal) — a real internal capital, not
 * just an all-caps or all-lowercase word that happens to need normalizing. */
function hasStylizedInternalCase(word: string): boolean {
  const tail = word.slice(1);
  return /\p{Lu}/u.test(tail) && /\p{Ll}/u.test(tail);
}

/**
 * Capitalizes a proper noun's first letter without touching the rest of the word — unlike
 * `capitalize`, which forces the tail to lowercase. Proper nouns are often stylized brand
 * names with a meaningful internal capital (SpaceX, PayPal, YouTube); forcing those to
 * lowercase turned "SpaceX" into "Spacex", a real capitalization bug this avoids. Words with
 * no genuine internal capital (all-caps shouting, or already all-lowercase) still go through
 * the normalizing `capitalize`, so "PARIS" still becomes "Paris" rather than staying shouted.
 */
function capitalizeProperNoun(word: string): string {
  if (word === '') return word;
  if (hasStylizedInternalCase(word)) return word[0]!.toUpperCase() + word.slice(1);
  return capitalize(word);
}

/**
 * Dynamically imports compromise (~136KB gzipped) only when actually invoked, per this
 * repo's rule to keep heavy per-tool libraries out of the initial bundle.
 *
 * `classify` is required, not defaulted to `classifyWithTransformer` — every real caller is
 * the Sentence Case Worker (see `src/workers/sentenceCase.worker.ts`), which passes the real
 * one explicitly, and every test passes a fake one. A default here would make it too easy
 * for a test to accidentally exercise the real multi-megabyte model. If the NER pass fails
 * (offline, blocked by an extension, first-load network hiccup) this degrades to
 * compromise-only behavior rather than failing the whole feature — compromise alone is a
 * complete, previously-shipped implementation of this same function.
 */
export async function applySentenceCase(text: string, classify: NerClassifier): Promise<SentenceCaseResult> {
  if (text.trim() === '') return { text, lowConfidenceRanges: [] };

  const [[{ default: nlp }, { COMMON_ENGLISH_WORDS }], nerEntities] = await Promise.all([
    Promise.all([import('compromise'), import('./data/commonEnglishWords')]),
    classify(text).catch((error: unknown) => {
      console.warn('Sentence case: AI name-detection model unavailable, falling back to dictionary-only detection.', error);
      return [] as NerEntity[];
    }),
  ]);
  const doc = nlp(text);
  const sentences = doc.json() as CompromiseSentence[];

  let result = '';
  // Tracks each term's own position in the *original* input text (not `result`, which is
  // being built up in a different, transformed casing) — `nerEntities`' start/end offsets
  // are relative to that original text, since it's what was handed to `classify` above.
  // `term.pre`/`term.text`/`term.post` reconstruct the original exactly when concatenated in
  // order, so a running cursor over them recovers each term's real input offset without
  // needing a separate offset API from compromise.
  let inputCursor = 0;
  const lowConfidenceRanges: LowConfidenceRange[] = [];

  for (const sentence of sentences) {
    const contextualNameSlots = findContextualNameSlots(sentence.terms);

    sentence.terms.forEach((term, i) => {
      const termStart = inputCursor + term.pre.length;
      const termEnd = termStart + term.text.length;
      inputCursor = termEnd + term.post.length;

      const tags = term.tags ?? [];
      const isProperNounGuess = tags.includes('ProperNoun');
      const isAcronym = tags.includes('Acronym');
      const isConfirmedByDictionary = CONFIRMED_PROPER_NOUN_TAGS.some((t) => tags.includes(t));
      const isSentenceStart = i === 0;
      const isIContraction = tags.includes('Pronoun') && I_CONTRACTION_RE.test(term.normal);
      const isContextualNameSlot = contextualNameSlots.has(i) && !isConfirmedByDictionary;

      // A NER entity "covers" this term if the term's whole span sits inside it — aggregated
      // entity spans align to whole-word boundaries, so this is exact, not approximate.
      const nerMatch = nerEntities.find((entity) => entity.start <= termStart && termEnd <= entity.end) ?? null;
      const isConfirmedByNer = nerMatch !== null && nerMatch.score >= NER_CONFIDENT_THRESHOLD;
      const isNerGuess = nerMatch !== null && !isConfirmedByNer;

      // Either signal can independently promote a word to "confirmed, no flag needed" —
      // compromise's dictionary lookup is casing-invariant (works on all-caps/all-lowercase
      // input), the NER model is contextual (catches real names outside that dictionary) —
      // see this module's top-level doc comment for why both are needed together.
      const isConfirmed = isConfirmedByDictionary || isConfirmedByNer;

      // An unconfirmed guess — flagged below — that's also an ordinary dictionary word
      // ("Fox", "Name") is genuinely a toss-up, so it's demoted to lowercase by default
      // rather than kept capitalized; see the `reason` doc on LowConfidenceRange for why the
      // other flagged case ('unrecognized') keeps the opposite default. Context (see
      // `findContextualNameSlots`) is a stronger, independent signal that overrides this —
      // checked first, since it can apply even to a word neither signal tagged as a name.
      const isUnconfirmedGuess = !isContextualNameSlot && !isConfirmed && !isIContraction && (isProperNounGuess || isNerGuess);
      const isCommonWordGuess = isUnconfirmedGuess && COMMON_ENGLISH_WORDS.has(term.normal.toLowerCase());
      const guessedForm = capitalizeProperNoun(term.text);

      let word: string;
      if (isAcronym) {
        word = term.text.toUpperCase();
      } else if (isContextualNameSlot) {
        word = guessedForm;
      } else if (isCommonWordGuess) {
        word = term.text.toLowerCase();
      } else if (isConfirmed || isProperNounGuess || isNerGuess) {
        word = guessedForm;
      } else if (isSentenceStart || isIContraction) {
        word = capitalize(term.text);
      } else {
        word = term.text.toLowerCase();
      }

      result += term.pre;
      const wordStart = result.length;
      result += word;
      result += term.post;

      if (isContextualNameSlot) {
        lowConfidenceRanges.push({ start: wordStart, end: wordStart + word.length, reason: 'contextual', original: guessedForm });
      } else if (isUnconfirmedGuess) {
        const reason = isCommonWordGuess ? 'commonWord' : 'unrecognized';
        lowConfidenceRanges.push({ start: wordStart, end: wordStart + word.length, reason, original: guessedForm });
      }
    });
  }

  return { text: result, lowConfidenceRanges };
}

/**
 * Flips a flagged word between this tool's capitalized guess and plain lowercase, so a user
 * who disagrees with an uncertain guess (see `LowConfidenceRange`) can fix it with one click
 * instead of retyping it. Toggling back restores `original` exactly — including any internal
 * capital ("SpaceX") — rather than re-deriving a generic capitalization that would flatten it.
 */
export function toggleGuessedCase(current: string, original: string): string {
  return current === original ? original.toLowerCase() : original;
}
