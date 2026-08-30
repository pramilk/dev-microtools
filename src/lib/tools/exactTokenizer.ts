/**
 * Exact BPE tokenization using OpenAI's published vocabularies, via `gpt-tokenizer` (MIT).
 *
 * Kept out of `tokenCount.ts` on purpose. Everything there is synchronous, pure and free;
 * this module's vocabulary is roughly 450 KB (cl100k_base) to 1 MB (o200k_base) gzipped, so
 * it is dynamically imported — fetched on the first count against a model that has a public
 * vocabulary, never as part of the page's own payload. The heuristic estimate in
 * `tokenCount.ts` carries the number while it is in flight, and remains the answer for
 * models whose vendor never published one.
 *
 * That size is also why this is worth the dependency at all: reproducing a BPE merge table
 * is not something a hand-written tokenizer can approximate, and "how many tokens is this,
 * exactly" is the whole question the tool exists to answer.
 */

import { type ToolResult, ok, err, messageFrom } from './result';
import type { TokenEncoding } from './tokenCount';

/** One token, as the model actually sees it. */
export interface TokenPiece {
  /** The token's numeric id in the vocabulary. */
  id: number;
  /**
   * The token's text. A token can be a fragment of a multi-byte character, in which case
   * this contains U+FFFD — that is not a bug, it is what that token genuinely is.
   */
  text: string;
}

export interface ExactCount {
  /** Total tokens in the input. Always the full count, even when `pieces` is truncated. */
  total: number;
  /** Decoded tokens, for the visualiser. Truncated to `maxPieces`. */
  pieces: TokenPiece[];
  /** True when `pieces` holds only the first `maxPieces` of `total`. */
  piecesTruncated: boolean;
}

/**
 * Approximate transfer size of each vocabulary, gzipped, so the UI can name the download it
 * is waiting on rather than showing a bare spinner. Measured from the built bundle.
 */
export const ENCODING_DOWNLOAD_KB: Readonly<Record<TokenEncoding, number>> = {
  o200k_base: 1040,
  cl100k_base: 450,
};

/** Which OpenAI models each published encoding covers, for the UI's explanation. */
export const ENCODING_LABELS: Readonly<Record<TokenEncoding, string>> = {
  o200k_base: 'o200k_base — the GPT-5 family, GPT-4o/4.1 and the o-series',
  cl100k_base: 'cl100k_base — GPT-4 and GPT-3.5 Turbo',
};

type Encoder = {
  encode: (text: string) => number[];
  decode: (tokens: Iterable<number>) => string;
};

/**
 * Loaded vocabularies, so switching models back and forth never re-parses one. The dynamic
 * `import()` is itself cached by the browser and the bundler; this additionally caches the
 * resolved module object so repeated counts do no work at all.
 */
const loaded = new Map<TokenEncoding, Encoder>();

/** True when the vocabulary is already in memory, so the UI can skip its loading state. */
export function isEncodingLoaded(encoding: TokenEncoding): boolean {
  return loaded.has(encoding);
}

async function loadEncoder(encoding: TokenEncoding): Promise<Encoder> {
  const cached = loaded.get(encoding);
  if (cached) return cached;

  // Written as an explicit branch rather than a template-literal import so the bundler can
  // resolve both chunks statically and split them — a computed specifier would either fail
  // to split or pull in every vocabulary at once.
  const encoder: Encoder =
    encoding === 'o200k_base'
      ? await import('gpt-tokenizer/encoding/o200k_base')
      : await import('gpt-tokenizer/encoding/cl100k_base');

  loaded.set(encoding, encoder);
  return encoder;
}

export interface CountExactlyOptions {
  /** Cap on how many decoded tokens come back, to keep the visualiser's DOM bounded. */
  maxPieces?: number;
}

const DEFAULT_MAX_PIECES = 2000;

/**
 * Counts tokens exactly, downloading the vocabulary on first use.
 *
 * Returns a `ToolResult` rather than throwing: the download can fail on a flaky connection,
 * and that has to surface as a message the visitor can act on, not a silent empty result.
 */
export async function countExactly(
  text: string,
  encoding: TokenEncoding,
  options: CountExactlyOptions = {}
): Promise<ToolResult<ExactCount>> {
  const maxPieces = options.maxPieces ?? DEFAULT_MAX_PIECES;

  if (text === '') return ok({ total: 0, pieces: [], piecesTruncated: false });

  let encoder: Encoder;
  try {
    encoder = await loadEncoder(encoding);
  } catch {
    // The browser's own message here is always some form of "Failed to fetch dynamically
    // imported module", which tells a visitor nothing they can act on — so this branch
    // deliberately replaces it with guidance rather than surfacing it.
    return err(
      `Could not download the ${encoding} vocabulary needed for an exact count. Check your connection and try again — the estimate is still shown, and it works offline.`
    );
  }

  try {
    const ids = encoder.encode(text);
    const shown = ids.slice(0, maxPieces);
    return ok({
      total: ids.length,
      // Decoded one token at a time on purpose: it keeps the pieces aligned 1:1 with the
      // ids, which is what the visualiser needs to show token boundaries faithfully.
      pieces: shown.map((id) => ({ id, text: encoder.decode([id]) })),
      piecesTruncated: ids.length > shown.length,
    });
  } catch (error) {
    return err(messageFrom(error, 'Could not tokenize this input.'));
  }
}
