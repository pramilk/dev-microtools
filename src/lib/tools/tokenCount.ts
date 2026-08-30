/**
 * LLM token counting and cost estimation.
 *
 * Two things live here, and the split matters:
 *
 * 1. `estimateTokens` — a dependency-free heuristic that runs on every keystroke. It is an
 *    *estimate*, and the UI must always label it as one.
 * 2. The model catalogue — encodings, prices and context windows, so cost can be worked out
 *    from a token count.
 *
 * Exact counting is deliberately NOT here: it needs a multi-megabyte BPE vocabulary and so
 * has to be dynamically imported. It lives in `exactTokenizer.ts` for the same reason
 * `sentenceCase.ts` is separate from `wordCounter.ts` — an async, lazily-loaded dependency
 * does not belong in the interface of a synchronous pure function.
 *
 * Why estimate at all when an exact tokenizer exists? Because it only exists for OpenAI.
 * Anthropic and Google have never published their tokenizers or vocabularies, so for those
 * models no client-side tool can do better than an estimate — and a tool with no backend
 * cannot ask a vendor's token-counting endpoint either, since that needs an API key. Each
 * model carries its own `estimateFactor` for this; see the constants above MODELS.
 *
 * The estimate also covers the moment before the exact vocabulary has finished downloading,
 * so the tool always has a number to show.
 */

/** The BPE encodings OpenAI has published, and the only ones that can be counted exactly. */
export type TokenEncoding = 'o200k_base' | 'cl100k_base';

export type Provider = 'OpenAI' | 'Anthropic' | 'Google';

/**
 * Tuning constants for {@link estimateTokens}, one set per encoding.
 *
 * These are fitted, not guessed: each value was chosen by measuring this estimator against
 * the real `gpt-tokenizer` output over a corpus of English prose, source code (TypeScript,
 * CSS, Markdown), JSON, SQL, URLs, and non-Latin scripts, then rounded to a stable value
 * near the optimum rather than pinned to the exact fitted number, which would be overfitted
 * to that corpus. Measured mean absolute error with these values: ~3.6% on English prose,
 * ~11% on source code, ~7% overall — against ~15% for the widely-quoted "characters ÷ 4".
 */
interface EstimatorProfile {
  /** Characters a Latin-script word fits into its first token. */
  wordFirstToken: number;
  /** Characters per additional token, once a word is longer than `wordFirstToken`. */
  wordPerExtraToken: number;
  /** Characters per token for Han, kana and Hangul, which are dense in every encoding. */
  cjkCharsPerToken: number;
  /** UTF-8 bytes per token for other non-Latin alphabets (Cyrillic, Greek, Arabic…). */
  otherScriptBytesPerToken: number;
  /** Effective punctuation characters per token. */
  punctuationPerToken: number;
  /** UTF-8 bytes per token for emoji and other non-ASCII symbols. */
  symbolBytesPerToken: number;
  /** Effective characters per token inside a run of indentation or repeated spaces. */
  spacesPerToken: number;
  /** Effective newlines per token inside a run of blank lines. */
  newlinesPerToken: number;
}

const ESTIMATOR_PROFILES: Record<TokenEncoding, EstimatorProfile> = {
  // Used by GPT-4o and everything after it. Much better multilingual coverage than
  // cl100k_base, which is why the non-Latin constants are far more generous here.
  o200k_base: {
    wordFirstToken: 10,
    wordPerExtraToken: 3,
    cjkCharsPerToken: 1.6,
    otherScriptBytesPerToken: 6,
    punctuationPerToken: 3,
    symbolBytesPerToken: 3,
    spacesPerToken: 4,
    newlinesPerToken: 2,
  },
  // GPT-4 and GPT-3.5-turbo.
  cl100k_base: {
    wordFirstToken: 10,
    wordPerExtraToken: 2.5,
    cjkCharsPerToken: 1,
    otherScriptBytesPerToken: 4,
    punctuationPerToken: 3,
    symbolBytesPerToken: 3,
    spacesPerToken: 4,
    newlinesPerToken: 2,
  },
};

/**
 * Segments text the way a BPE pre-tokenizer does, before any merging: newline runs,
 * horizontal whitespace runs, digit runs, letter runs, ASCII punctuation runs, and
 * everything else (emoji, symbols). Every branch below corresponds to one capture group,
 * in the same order.
 */
const SEGMENT_RE =
  /(\r?\n)+|([^\S\r\n]+)|(\p{N}+)|(\p{L}[\p{L}\p{M}]*)|([\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E]+)|([^\s\p{L}\p{M}\p{N}]+)/gu;

/** Latin script including the accented Latin-1 Supplement and Latin Extended-A/B blocks. */
const LATIN_WORD_RE = /^[A-Za-zÀ-ɏ]+$/;
/** Kana, CJK ideographs, Hangul and compatibility ideographs — dense in every encoding. */
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿가-힯豈-﫿]/u;

/**
 * BPE has dedicated tokens for camelCase parts, so `getUserName` costs roughly what
 * `get user name` costs. Splitting on the same boundaries keeps identifiers honest.
 */
const CASE_BOUNDARY_RE = /(?<=\p{Ll})(?=\p{Lu})|(?<=\p{Lu})(?=\p{Lu}\p{Ll})/gu;

const REPEATED_CHAR_RUN_RE = /(.)\1*/gsu;

const encoder = new TextEncoder();
const utf8Length = (text: string): number => encoder.encode(text).length;

/**
 * Length of a run of characters, discounted for repetition.
 *
 * BPE merges repeats geometrically — a rule of 60 dashes in a comment banner is a handful
 * of tokens, not 60 — so counting such a run linearly is the single biggest source of
 * over-estimation on real source code.
 */
function effectiveRunLength(text: string): number {
  let effective = 0;
  for (const [run] of text.matchAll(REPEATED_CHAR_RUN_RE)) {
    effective += run.length <= 3 ? run.length : 3 + Math.log2(run.length - 2);
  }
  return effective;
}

/** Tokens a single Latin-script word costs: one, plus one per few characters beyond the first token. */
function latinWordTokens(word: string, profile: EstimatorProfile): number {
  let tokens = 0;
  for (const part of word.split(CASE_BOUNDARY_RE)) {
    tokens += 1 + Math.max(0, Math.ceil((part.length - profile.wordFirstToken) / profile.wordPerExtraToken));
  }
  return tokens;
}

/**
 * Estimates how many tokens `text` costs under the given encoding, with no vocabulary
 * download. Always an approximation — see the accuracy figures on `EstimatorProfile`.
 */
export function estimateTokens(text: string, encoding: TokenEncoding): number {
  if (text === '') return 0;
  const profile = ESTIMATOR_PROFILES[encoding];
  let tokens = 0;

  for (const match of text.matchAll(SEGMENT_RE)) {
    const [segment, newlines, spaces, digits, letters, punctuation] = match;

    if (newlines !== undefined) {
      tokens += Math.max(1, Math.round(effectiveRunLength(segment) / profile.newlinesPerToken));
    } else if (spaces !== undefined) {
      if (segment.length > 1) {
        // Only indentation and padding runs cost anything beyond the absorbed first space.
        tokens += Math.max(1, Math.round(effectiveRunLength(segment.slice(1)) / profile.spacesPerToken));
      } else if (match.index + segment.length >= text.length) {
        // A single space is normally absorbed into the token for the word that follows it,
        // so it is free — but a trailing space has no such word and is a token of its own.
        tokens += 1;
      }
    } else if (digits !== undefined) {
      // Both published encodings cap a numeric token at three digits.
      tokens += Math.ceil(segment.length / 3);
    } else if (letters !== undefined) {
      if (LATIN_WORD_RE.test(segment)) {
        tokens += latinWordTokens(segment, profile);
      } else if (CJK_RE.test(segment)) {
        tokens += Math.max(1, Math.round(segment.length / profile.cjkCharsPerToken));
      } else {
        tokens += Math.max(1, Math.round(utf8Length(segment) / profile.otherScriptBytesPerToken));
      }
    } else if (punctuation !== undefined) {
      tokens += Math.max(1, Math.round(effectiveRunLength(segment) / profile.punctuationPerToken));
    } else {
      tokens += Math.max(1, Math.round(utf8Length(segment) / profile.symbolBytesPerToken));
    }
  }

  return tokens;
}

/**
 * The date the prices and context windows below were last checked against each vendor's
 * published pricing page.
 *
 * Model prices change often and without notice. This is a snapshot, the UI says so and
 * links to the source, and every model can be overridden with a custom rate — but this
 * constant still needs re-checking periodically, and bumping when it is.
 */
export const PRICING_AS_OF = '2026-08-29';

/** Where the numbers came from, shown in the UI so a stale price is verifiable, not trusted. */
export const PRICING_SOURCES: Readonly<Record<Provider, string>> = {
  OpenAI: 'https://developers.openai.com/api/docs/pricing',
  Anthropic: 'https://www.anthropic.com/pricing',
  Google: 'https://ai.google.dev/gemini-api/docs/pricing',
};

/**
 * A second price band that kicks in above a token threshold.
 *
 * Google prices its Pro models higher once a prompt passes 200K tokens. Ignoring that would
 * under-quote exactly the long-context prompts people come here to price, so it is modelled
 * rather than flattened to the cheaper rate.
 */
export interface PriceTier {
  /** Input tokens above which this band applies. */
  aboveTokens: number;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
}

export interface TokenModel {
  id: string;
  label: string;
  provider: Provider;
  /**
   * The published BPE encoding, when the vendor has released one. `null` means the
   * tokenizer is proprietary and only an estimate is possible.
   */
  encoding: TokenEncoding | null;
  /** The encoding whose shape the heuristic estimate is modelled on. */
  estimateBasis: TokenEncoding;
  /**
   * Correction applied to the o200k-shaped estimate for models with no public tokenizer.
   * 1 means "no correction" — always the case for OpenAI, where the count is exact anyway.
   */
  estimateFactor: number;
  /** USD per million input tokens. */
  inputPricePerMillion: number;
  /** USD per million output tokens. */
  outputPricePerMillion: number;
  /** Higher rates above a token threshold, where the vendor publishes them. */
  highVolumeTier?: PriceTier;
  /** Total context window in tokens. */
  contextWindow: number;
  /** Shown beside the model when its price carries a caveat (promotional rate, tiering). */
  priceNote?: string;
}

/**
 * Estimate corrections for vendors that have never published a tokenizer.
 *
 * Anthropic documents roughly 3.5 characters per token for English against OpenAI's ~4, so
 * the same text costs modestly more tokens on Claude — about 1.15x. Anthropic then changed
 * tokenizer with Opus 4.7, and documents the newer one as using up to ~1.35x as many tokens
 * as the older one; CLAUDE_NEW_TOKENIZER folds that in. Google documents ~4 characters per
 * token, matching OpenAI, so its models need no correction.
 *
 * These are approximations of an approximation. The UI never presents a non-OpenAI count as
 * exact, and there is no honest way for a client-side tool to do better — see the FAQ on the
 * tool's content page for the one route that can: each vendor's own token-counting endpoint,
 * which needs an API key and therefore a backend.
 */
const NO_CORRECTION = 1;
const CLAUDE_OLD_TOKENIZER = 1.15;
const CLAUDE_NEW_TOKENIZER = 1.35;

/**
 * Named separately so {@link DEFAULT_MODEL} can point at it directly. Indexing into MODELS
 * for a default would give a possibly-undefined element that every caller then has to
 * assert away.
 */
const GPT_5_4: TokenModel = { id: 'gpt-5.4', label: 'GPT-5.4', provider: 'OpenAI', encoding: 'o200k_base', estimateBasis: 'o200k_base', estimateFactor: NO_CORRECTION, inputPricePerMillion: 2.5, outputPricePerMillion: 15, contextWindow: 400_000 };

/**
 * The model catalogue — prices, context windows and tokenizers, as published on
 * {@link PRICING_SOURCES} on {@link PRICING_AS_OF}.
 *
 * Adding a model is a one-line edit here; nothing else in the tool needs to change, and the
 * provider grouping in the UI is derived from this list. Deliberately current models only:
 * a stale entry with a stale price is worse than an absent one, since the whole point of
 * the tool is to quote a number someone will budget against.
 */
export const MODELS: readonly TokenModel[] = [
  // -- OpenAI ---------------------------------------------------------------------
  // Every current OpenAI text model uses o200k_base, so every one of these is counted
  // exactly. (cl100k_base is still supported by the estimator and the exact tokenizer —
  // it is the GPT-4 / GPT-3.5 vocabulary — but no model that old is listed here.)
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', provider: 'OpenAI', encoding: 'o200k_base', estimateBasis: 'o200k_base', estimateFactor: NO_CORRECTION, inputPricePerMillion: 4, outputPricePerMillion: 20, contextWindow: 1_050_000 },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', provider: 'OpenAI', encoding: 'o200k_base', estimateBasis: 'o200k_base', estimateFactor: NO_CORRECTION, inputPricePerMillion: 2, outputPricePerMillion: 12, contextWindow: 1_050_000 },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', provider: 'OpenAI', encoding: 'o200k_base', estimateBasis: 'o200k_base', estimateFactor: NO_CORRECTION, inputPricePerMillion: 0.2, outputPricePerMillion: 1.2, contextWindow: 1_050_000 },
  { id: 'gpt-5.5', label: 'GPT-5.5', provider: 'OpenAI', encoding: 'o200k_base', estimateBasis: 'o200k_base', estimateFactor: NO_CORRECTION, inputPricePerMillion: 5, outputPricePerMillion: 30, contextWindow: 400_000 },
  GPT_5_4,
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini', provider: 'OpenAI', encoding: 'o200k_base', estimateBasis: 'o200k_base', estimateFactor: NO_CORRECTION, inputPricePerMillion: 0.75, outputPricePerMillion: 4.5, contextWindow: 400_000 },
  { id: 'gpt-5.4-nano', label: 'GPT-5.4 nano', provider: 'OpenAI', encoding: 'o200k_base', estimateBasis: 'o200k_base', estimateFactor: NO_CORRECTION, inputPricePerMillion: 0.2, outputPricePerMillion: 1.25, contextWindow: 400_000 },
  { id: 'gpt-5.2', label: 'GPT-5.2', provider: 'OpenAI', encoding: 'o200k_base', estimateBasis: 'o200k_base', estimateFactor: NO_CORRECTION, inputPricePerMillion: 1.75, outputPricePerMillion: 14, contextWindow: 400_000 },
  { id: 'gpt-5', label: 'GPT-5', provider: 'OpenAI', encoding: 'o200k_base', estimateBasis: 'o200k_base', estimateFactor: NO_CORRECTION, inputPricePerMillion: 1.25, outputPricePerMillion: 10, contextWindow: 400_000 },
  { id: 'gpt-5-mini', label: 'GPT-5 mini', provider: 'OpenAI', encoding: 'o200k_base', estimateBasis: 'o200k_base', estimateFactor: NO_CORRECTION, inputPricePerMillion: 0.25, outputPricePerMillion: 2, contextWindow: 400_000 },
  { id: 'gpt-5-nano', label: 'GPT-5 nano', provider: 'OpenAI', encoding: 'o200k_base', estimateBasis: 'o200k_base', estimateFactor: NO_CORRECTION, inputPricePerMillion: 0.05, outputPricePerMillion: 0.4, contextWindow: 400_000 },
  { id: 'o3', label: 'o3', provider: 'OpenAI', encoding: 'o200k_base', estimateBasis: 'o200k_base', estimateFactor: NO_CORRECTION, inputPricePerMillion: 2, outputPricePerMillion: 8, contextWindow: 200_000 },
  { id: 'o4-mini', label: 'o4-mini', provider: 'OpenAI', encoding: 'o200k_base', estimateBasis: 'o200k_base', estimateFactor: NO_CORRECTION, inputPricePerMillion: 1.1, outputPricePerMillion: 4.4, contextWindow: 200_000 },

  // -- Anthropic ------------------------------------------------------------------
  // No published tokenizer, so `encoding` is null for all of these and the count is always
  // an estimate. Opus 4.7 introduced a new tokenizer that Fable 5, Opus 5 and Opus 4.8
  // share; Sonnet 4.6 and Haiku 4.5 predate it.
  { id: 'claude-fable-5', label: 'Claude Fable 5', provider: 'Anthropic', encoding: null, estimateBasis: 'o200k_base', estimateFactor: CLAUDE_NEW_TOKENIZER, inputPricePerMillion: 10, outputPricePerMillion: 50, contextWindow: 1_000_000 },
  { id: 'claude-opus-5', label: 'Claude Opus 5', provider: 'Anthropic', encoding: null, estimateBasis: 'o200k_base', estimateFactor: CLAUDE_NEW_TOKENIZER, inputPricePerMillion: 5, outputPricePerMillion: 25, contextWindow: 1_000_000 },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', provider: 'Anthropic', encoding: null, estimateBasis: 'o200k_base', estimateFactor: CLAUDE_NEW_TOKENIZER, inputPricePerMillion: 5, outputPricePerMillion: 25, contextWindow: 1_000_000 },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', provider: 'Anthropic', encoding: null, estimateBasis: 'o200k_base', estimateFactor: CLAUDE_NEW_TOKENIZER, inputPricePerMillion: 2, outputPricePerMillion: 10, contextWindow: 1_000_000 },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'Anthropic', encoding: null, estimateBasis: 'o200k_base', estimateFactor: CLAUDE_OLD_TOKENIZER, inputPricePerMillion: 3, outputPricePerMillion: 15, contextWindow: 1_000_000 },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'Anthropic', encoding: null, estimateBasis: 'o200k_base', estimateFactor: CLAUDE_OLD_TOKENIZER, inputPricePerMillion: 1, outputPricePerMillion: 5, contextWindow: 200_000 },

  // -- Google ---------------------------------------------------------------------
  // Also no published tokenizer. Context windows are the 1M the Gemini family has carried
  // since 1.5 — Google's pricing page does not restate them per model.
  { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash', provider: 'Google', encoding: null, estimateBasis: 'o200k_base', estimateFactor: NO_CORRECTION, inputPricePerMillion: 0.75, outputPricePerMillion: 3.75, contextWindow: 1_048_576, priceNote: 'Promotional rate through 31 Dec 2026; doubles after that.' },
  { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', provider: 'Google', encoding: null, estimateBasis: 'o200k_base', estimateFactor: NO_CORRECTION, inputPricePerMillion: 1.5, outputPricePerMillion: 9, contextWindow: 1_048_576 },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', provider: 'Google', encoding: null, estimateBasis: 'o200k_base', estimateFactor: NO_CORRECTION, inputPricePerMillion: 0.3, outputPricePerMillion: 2.5, contextWindow: 1_048_576 },
  { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro', provider: 'Google', encoding: null, estimateBasis: 'o200k_base', estimateFactor: NO_CORRECTION, inputPricePerMillion: 2, outputPricePerMillion: 12, highVolumeTier: { aboveTokens: 200_000, inputPricePerMillion: 4, outputPricePerMillion: 18 }, contextWindow: 1_048_576, priceNote: 'Rate doubles for prompts over 200,000 tokens.' },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', provider: 'Google', encoding: null, estimateBasis: 'o200k_base', estimateFactor: NO_CORRECTION, inputPricePerMillion: 0.25, outputPricePerMillion: 1.5, contextWindow: 1_048_576 },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'Google', encoding: null, estimateBasis: 'o200k_base', estimateFactor: NO_CORRECTION, inputPricePerMillion: 1.25, outputPricePerMillion: 10, highVolumeTier: { aboveTokens: 200_000, inputPricePerMillion: 2.5, outputPricePerMillion: 15 }, contextWindow: 1_048_576, priceNote: 'Higher rate for prompts over 200,000 tokens.' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'Google', encoding: null, estimateBasis: 'o200k_base', estimateFactor: NO_CORRECTION, inputPricePerMillion: 0.3, outputPricePerMillion: 2.5, contextWindow: 1_048_576 },
  { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', provider: 'Google', encoding: null, estimateBasis: 'o200k_base', estimateFactor: NO_CORRECTION, inputPricePerMillion: 0.1, outputPricePerMillion: 0.4, contextWindow: 1_048_576 },
];

/** The model selected before anyone chooses one. */
export const DEFAULT_MODEL = GPT_5_4;
export const DEFAULT_MODEL_ID = GPT_5_4.id;

/** Providers in catalogue order, for grouping the model picker. */
export const PROVIDERS: readonly Provider[] = ['OpenAI', 'Anthropic', 'Google'];

export function findModel(id: string): TokenModel | undefined {
  return MODELS.find((model) => model.id === id);
}

/** Like {@link findModel}, but always returns a model — for UI state that must resolve to one. */
export function modelOrDefault(id: string): TokenModel {
  return findModel(id) ?? DEFAULT_MODEL;
}

/** Models grouped by provider, so the picker never hard-codes the grouping. */
export function modelsByProvider(): { provider: Provider; models: TokenModel[] }[] {
  return PROVIDERS.map((provider) => ({
    provider,
    models: MODELS.filter((model) => model.provider === provider),
  })).filter((group) => group.models.length > 0);
}

/**
 * Estimated token count for a model, including the correction for models with no public
 * tokenizer. For OpenAI models this is the same heuristic the exact tokenizer replaces
 * once it has loaded.
 */
export function estimateTokensForModel(text: string, model: TokenModel): number {
  return Math.round(estimateTokens(text, model.estimateBasis) * model.estimateFactor);
}

/**
 * Estimates every model at once, scanning the text once per distinct encoding rather than
 * once per model.
 *
 * The comparison table needs a count for all ~26 models on every keystroke. Calling
 * {@link estimateTokensForModel} in a loop would re-scan the whole input that many times,
 * which is the difference between a responsive tool and a janky one on a large paste —
 * every model shares a handful of encodings, so the scan is shared too.
 */
export function estimateTokensForAllModels(text: string): ReadonlyMap<string, number> {
  const byBasis = new Map<TokenEncoding, number>();
  const byModel = new Map<string, number>();

  for (const model of MODELS) {
    let base = byBasis.get(model.estimateBasis);
    if (base === undefined) {
      base = estimateTokens(text, model.estimateBasis);
      byBasis.set(model.estimateBasis, base);
    }
    byModel.set(model.id, Math.round(base * model.estimateFactor));
  }

  return byModel;
}

/** The rates that actually apply to a prompt of this size, after any high-volume tier. */
export function ratesFor(model: TokenModel, inputTokens: number): { inputPricePerMillion: number; outputPricePerMillion: number } {
  const tier = model.highVolumeTier;
  if (tier && inputTokens > tier.aboveTokens) {
    return { inputPricePerMillion: tier.inputPricePerMillion, outputPricePerMillion: tier.outputPricePerMillion };
  }
  return { inputPricePerMillion: model.inputPricePerMillion, outputPricePerMillion: model.outputPricePerMillion };
}

export interface CostInput {
  inputTokens: number;
  outputTokens: number;
  /** How many times this call is made. Turns a per-call price into a real bill. */
  calls: number;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
}

export interface CostEstimate {
  /** Cost of one call's input tokens, in USD. */
  inputCost: number;
  /** Cost of one call's output tokens, in USD. */
  outputCost: number;
  /** Cost of a single call, in USD. */
  perCallCost: number;
  /** `perCallCost` × `calls`, in USD. */
  totalCost: number;
}

const PER_MILLION = 1_000_000;

/**
 * Works out what a prompt costs. Negative or non-finite inputs are clamped to zero rather
 * than producing a nonsensical negative bill.
 */
export function estimateCost(input: CostInput): CostEstimate {
  const clamp = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0);

  const inputCost = (clamp(input.inputTokens) * clamp(input.inputPricePerMillion)) / PER_MILLION;
  const outputCost = (clamp(input.outputTokens) * clamp(input.outputPricePerMillion)) / PER_MILLION;
  const perCallCost = inputCost + outputCost;

  return {
    inputCost,
    outputCost,
    perCallCost,
    totalCost: perCallCost * clamp(input.calls),
  };
}

/**
 * Formats a USD amount for display.
 *
 * Fractions of a cent are the normal case for a single prompt, so anything under a dollar
 * keeps four significant digits rather than being rounded to two decimals — `$0.013` shown
 * as "$0.01" is a 30% error on the number people actually read off this tool, and "$0.0004"
 * shown as "$0.00" is worse. Two decimals is still the floor, so a round $0.50 does not
 * render as "$0.5".
 */
export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return '$0.00';
  if (amount < 0.000001) return '< $0.000001';

  if (amount < 1) {
    const significant = amount.toPrecision(4).replace(/0+$/, '').replace(/\.$/, '');
    const decimals = significant.split('.')[1]?.length ?? 0;
    return `$${decimals >= 2 ? significant : amount.toFixed(2)}`;
  }

  return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Percentage of a model's context window a token count occupies, capped for display at 999. */
export function contextUsagePercent(tokens: number, contextWindow: number): number {
  if (contextWindow <= 0) return 0;
  return Math.min(999, (tokens / contextWindow) * 100);
}
