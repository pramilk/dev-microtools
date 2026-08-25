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

export interface TextRange {
  start: number;
  end: number;
}

export interface LowConfidenceRange extends TextRange {
  /**
   * A guessed proper noun that's also an ordinary English word (e.g. "Fox", "Name") is more
   * likely just capitalized by habit than a real name — but it's still kept capitalized
   * (not silently lowercased) since plenty of real names are also common words ("Grace",
   * "Mark", "Will"). This only changes the reason shown on hover, never the casing decision.
   */
  reason: 'commonWord' | 'unrecognized';
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
    sentence.terms.forEach((term, i) => {
      const tags = term.tags ?? [];
      const isProperNoun = tags.includes('ProperNoun');
      const isAcronym = tags.includes('Acronym');
      const isConfirmed = CONFIRMED_PROPER_NOUN_TAGS.some((t) => tags.includes(t));
      const isSentenceStart = i === 0;
      const isIContraction = tags.includes('Pronoun') && I_CONTRACTION_RE.test(term.normal);

      let word: string;
      if (isAcronym) {
        word = term.text.toUpperCase();
      } else if (isProperNoun || isSentenceStart || isIContraction) {
        word = capitalize(term.text);
      } else {
        word = term.text.toLowerCase();
      }

      result += term.pre;
      const wordStart = result.length;
      result += word;
      result += term.post;

      // A guessed proper noun that isn't a "confirmed" tag and isn't just "I"/"I'm" (which
      // is always correctly capitalized regardless, so flagging it would just be noise).
      if (isProperNoun && !isConfirmed && !isIContraction) {
        const reason = COMMON_ENGLISH_WORDS.has(term.normal.toLowerCase()) ? 'commonWord' : 'unrecognized';
        lowConfidenceRanges.push({ start: wordStart, end: wordStart + word.length, reason });
      }
    });
  }

  return { text: result, lowConfidenceRanges };
}
