/**
 * Best-effort "Sentence case" using automatic proper-noun detection, via the `compromise`
 * NLP library. Deliberately separate from `convertCase`/`CASE_TYPES` in wordCounter.ts:
 * every other case type is a synchronous, deterministic string transform, while this one
 * needs an async dynamically-imported dependency and produces a second output (which words
 * it wasn't sure about) — forcing it into the same interface would violate ISP for every
 * other case button that doesn't need any of that.
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
 */
export async function applySentenceCase(text: string): Promise<SentenceCaseResult> {
  if (text.trim() === '') return { text, lowConfidenceRanges: [] };

  const [{ default: nlp }, { COMMON_ENGLISH_WORDS }] = await Promise.all([
    import('compromise'),
    import('./data/commonEnglishWords'),
  ]);
  const doc = nlp(text);
  const sentences = doc.json() as CompromiseSentence[];

  let result = '';
  const lowConfidenceRanges: LowConfidenceRange[] = [];

  for (const sentence of sentences) {
    const contextualNameSlots = findContextualNameSlots(sentence.terms);

    sentence.terms.forEach((term, i) => {
      const tags = term.tags ?? [];
      const isProperNoun = tags.includes('ProperNoun');
      const isAcronym = tags.includes('Acronym');
      const isConfirmed = CONFIRMED_PROPER_NOUN_TAGS.some((t) => tags.includes(t));
      const isSentenceStart = i === 0;
      const isIContraction = tags.includes('Pronoun') && I_CONTRACTION_RE.test(term.normal);
      const isContextualNameSlot = contextualNameSlots.has(i) && !isConfirmed;

      // An unconfirmed guess — flagged below — that's also an ordinary dictionary word
      // ("Fox", "Name") is genuinely a toss-up, so it's demoted to lowercase by default
      // rather than kept capitalized; see the `reason` doc on LowConfidenceRange for why the
      // other flagged case ('unrecognized') keeps the opposite default. Context (see
      // `findContextualNameSlots`) is a stronger, independent signal that overrides this —
      // checked first, since it can apply even to a word compromise never tagged ProperNoun.
      const isUnconfirmedGuess = !isContextualNameSlot && isProperNoun && !isConfirmed && !isIContraction;
      const isCommonWordGuess = isUnconfirmedGuess && COMMON_ENGLISH_WORDS.has(term.normal.toLowerCase());
      const guessedForm = capitalizeProperNoun(term.text);

      let word: string;
      if (isAcronym) {
        word = term.text.toUpperCase();
      } else if (isContextualNameSlot) {
        word = guessedForm;
      } else if (isCommonWordGuess) {
        word = term.text.toLowerCase();
      } else if (isProperNoun) {
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
