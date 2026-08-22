import { type ToolResult, ok, err } from './result';

/**
 * Lenient JSON repair.
 *
 * Rather than pattern-matching common mistakes with regular expressions — which breaks
 * the moment a brace, comma or "//" appears inside a string literal — this is a small
 * recursive-descent parser that accepts the sloppy input people actually have and emits
 * strict JSON. Because the output is rebuilt from parsed tokens rather than patched in
 * place, it cannot produce syntactically invalid JSON, and the result is verified with
 * JSON.parse before being returned.
 *
 * Every change is recorded so the UI can tell the user exactly what was altered. Silent
 * "fixes" would be worse than an error message: the point is to show your data was
 * changed, not to hide it.
 */

export interface JsonRepairNote {
  kind: RepairKind;
  description: string;
  count: number;
}

export interface RepairedJson {
  /** Compact, strictly valid JSON. */
  json: string;
  notes: JsonRepairNote[];
}

export type RepairKind =
  | 'comments'
  | 'single-quotes'
  | 'smart-quotes'
  | 'unquoted-key'
  | 'trailing-comma'
  | 'missing-comma'
  | 'missing-colon'
  | 'python-literal'
  | 'special-number'
  | 'number-format'
  | 'invalid-escape'
  | 'newline-in-string'
  | 'unterminated-string'
  | 'unclosed-bracket'
  | 'duplicate-key'
  | 'surrounding-text'
  | 'multiple-documents';

const DESCRIPTIONS: Record<RepairKind, string> = {
  comments: 'Removed comments — JSON does not allow // or /* */.',
  'single-quotes': 'Converted single-quoted strings to double quotes.',
  'smart-quotes': 'Replaced curly “smart” quotes with straight quotes.',
  'unquoted-key': 'Added quotes around object keys.',
  'trailing-comma': 'Removed a trailing comma before a closing bracket.',
  'missing-comma': 'Inserted a missing comma between items.',
  'missing-colon': 'Inserted a missing colon between a key and its value.',
  'python-literal': 'Converted Python-style True / False / None to JSON literals.',
  'special-number': 'Replaced NaN, Infinity or undefined with null — JSON has no way to represent them.',
  'number-format': 'Rewrote a number into valid JSON form (hex, leading +, or a bare decimal point).',
  'invalid-escape': 'Fixed an invalid backslash escape inside a string.',
  'newline-in-string': 'Escaped a literal line break inside a string.',
  'unterminated-string': 'Closed a string that was never terminated.',
  'unclosed-bracket': 'Closed a bracket or brace that was left open.',
  'duplicate-key': 'Removed an earlier duplicate key, keeping the last value — which is what JSON parsers do.',
  'surrounding-text': 'Ignored text before or after the JSON, such as a log prefix.',
  'multiple-documents': 'Found several JSON documents and wrapped them in an array.',
};

/** Quote characters accepted as string delimiters, mapped to their closing partner. */
const QUOTES: Record<string, string> = {
  '"': '"',
  "'": "'",
  '`': '`',
  '‘': '’',
  '“': '”',
};

const CLOSING_SMART_QUOTES = new Set(['’', '”']);

/** Literals accepted beyond JSON's own, longest first so prefixes do not win. */
const LITERALS: [token: string, output: string, kind: RepairKind | null][] = [
  ['undefined', 'null', 'special-number'],
  ['Infinity', 'null', 'special-number'],
  ['-Infinity', 'null', 'special-number'],
  ['NaN', 'null', 'special-number'],
  ['None', 'null', 'python-literal'],
  ['True', 'true', 'python-literal'],
  ['False', 'false', 'python-literal'],
  ['TRUE', 'true', 'python-literal'],
  ['FALSE', 'false', 'python-literal'],
  ['NULL', 'null', 'python-literal'],
  ['true', 'true', null],
  ['false', 'false', null],
  ['null', 'null', null],
];

const STRICT_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const WHITESPACE = new Set([' ', '\t', '\n', '\r', '\f', '\v', ' ', '﻿']);
const IDENTIFIER_START = /[A-Za-z_$]/;
const IDENTIFIER_PART = /[\w$.-]/;

class LenientParser {
  private pos = 0;
  private readonly counts = new Map<RepairKind, number>();

  constructor(private readonly src: string) {}

  // ------------------------------------------------------------- utilities

  private note(kind: RepairKind): void {
    this.counts.set(kind, (this.counts.get(kind) ?? 0) + 1);
  }

  private get done(): boolean {
    return this.pos >= this.src.length;
  }

  private peek(offset = 0): string | undefined {
    return this.src[this.pos + offset];
  }

  /** Skips whitespace and comments. Comments are the only trivia JSON forbids. */
  private skipTrivia(): void {
    for (;;) {
      const ch = this.peek();
      if (ch === undefined) return;

      if (WHITESPACE.has(ch)) {
        this.pos += 1;
        continue;
      }

      if (ch === '/' && this.peek(1) === '/') {
        this.note('comments');
        while (!this.done && this.peek() !== '\n') this.pos += 1;
        continue;
      }

      if (ch === '/' && this.peek(1) === '*') {
        this.note('comments');
        this.pos += 2;
        while (!this.done && !(this.peek() === '*' && this.peek(1) === '/')) this.pos += 1;
        this.pos += 2;
        continue;
      }

      if (ch === '#') {
        // YAML/shell-style comment; occasionally seen in hand-written config.
        this.note('comments');
        while (!this.done && this.peek() !== '\n') this.pos += 1;
        continue;
      }

      return;
    }
  }

  // --------------------------------------------------------------- strings

  /** Reads a string in any quote style and returns it as a strict JSON string. */
  private readString(): string {
    const open = this.peek()!;
    const close = QUOTES[open] ?? open;

    if (open === "'" || open === '`') this.note('single-quotes');
    else if (open !== '"') this.note('smart-quotes');

    this.pos += 1;
    let value = '';

    while (!this.done) {
      const ch = this.peek()!;

      if (ch === '\\') {
        value += this.readEscape();
        continue;
      }

      if (ch === close || (open !== '"' && CLOSING_SMART_QUOTES.has(ch))) {
        this.pos += 1;
        return JSON.stringify(value);
      }

      if (ch === '\n' || ch === '\r') {
        // A raw newline inside a string is invalid JSON. Escaping it preserves the
        // author's intent better than truncating the string at the line break.
        this.note('newline-in-string');
        value += '\n';
        this.pos += 1;
        if (ch === '\r' && this.peek() === '\n') this.pos += 1;
        continue;
      }

      value += ch;
      this.pos += 1;
    }

    this.note('unterminated-string');
    return JSON.stringify(value);
  }

  /** Decodes one backslash escape into its literal character. */
  private readEscape(): string {
    const next = this.peek(1);
    this.pos += 2;

    switch (next) {
      case 'n':
        return '\n';
      case 't':
        return '\t';
      case 'r':
        return '\r';
      case 'b':
        return '\b';
      case 'f':
        return '\f';
      case '/':
        return '/';
      case '\\':
        return '\\';
      case '"':
        return '"';
      case 'u': {
        const hex = this.src.slice(this.pos, this.pos + 4);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          this.pos += 4;
          return String.fromCharCode(Number.parseInt(hex, 16));
        }
        this.note('invalid-escape');
        return 'u';
      }
      case undefined:
        this.note('invalid-escape');
        return '\\';
      default:
        // \' and friends are valid in JavaScript but not JSON. Keeping the character
        // and dropping the backslash is what the author meant.
        this.note('invalid-escape');
        return next;
    }
  }

  // --------------------------------------------------------------- numbers

  private readNumber(): string {
    const start = this.pos;
    while (!this.done && /[-+0-9a-fA-FxXeE._]/.test(this.peek()!)) this.pos += 1;
    const raw = this.src.slice(start, this.pos);

    if (STRICT_NUMBER.test(raw)) return raw;

    let cleaned = raw.replace(/_/g, '');

    if (/^[+-]?0[xX][0-9a-fA-F]+$/.test(cleaned)) {
      this.note('number-format');
      return String(Number(cleaned));
    }

    if (cleaned.startsWith('+')) {
      this.note('number-format');
      cleaned = cleaned.slice(1);
    }
    if (cleaned.startsWith('.')) cleaned = `0${cleaned}`;
    else if (cleaned.startsWith('-.')) cleaned = `-0${cleaned.slice(1)}`;
    if (cleaned.endsWith('.')) cleaned += '0';

    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed)) {
      this.note('special-number');
      return 'null';
    }

    if (!STRICT_NUMBER.test(cleaned)) this.note('number-format');
    return STRICT_NUMBER.test(cleaned) ? cleaned : String(parsed);
  }

  // -------------------------------------------------------------- literals

  private readLiteral(): string | null {
    for (const [token, output, kind] of LITERALS) {
      if (!this.src.startsWith(token, this.pos)) continue;
      const after = this.peek(token.length);
      if (after !== undefined && /[\w$]/.test(after)) continue;

      this.pos += token.length;
      if (kind) this.note(kind);
      return output;
    }
    return null;
  }

  /** Reads a bare identifier used as an object key, e.g. `{name: 1}`. */
  private readBareKey(): string | null {
    if (!IDENTIFIER_START.test(this.peek() ?? '')) return null;

    const start = this.pos;
    while (!this.done && IDENTIFIER_PART.test(this.peek()!)) this.pos += 1;

    this.note('unquoted-key');
    return JSON.stringify(this.src.slice(start, this.pos));
  }

  // ------------------------------------------------------------ structures

  private readObject(): string {
    this.pos += 1; // consume {
    const entries: { key: string; text: string }[] = [];

    for (;;) {
      this.skipTrivia();

      if (this.done) {
        this.note('unclosed-bracket');
        break;
      }
      if (this.peek() === '}') {
        this.pos += 1;
        break;
      }
      if (this.peek() === ',') {
        // A comma with no entry before it: either a leading or a doubled comma.
        this.note('trailing-comma');
        this.pos += 1;
        continue;
      }

      const key = this.readKey();
      if (key === null) {
        // Unrecognisable character; skip it rather than looping forever.
        this.pos += 1;
        continue;
      }

      this.skipTrivia();
      if (this.peek() === ':' || this.peek() === '=') {
        this.pos += 1;
      } else {
        this.note('missing-colon');
      }

      this.skipTrivia();
      const value = this.readValue();

      const existing = entries.findIndex((entry) => entry.key === key);
      if (existing !== -1) {
        this.note('duplicate-key');
        entries.splice(existing, 1);
      }
      entries.push({ key, text: `${key}:${value}` });

      if (!this.consumeSeparator('}')) break;
    }

    return `{${entries.map((entry) => entry.text).join(',')}}`;
  }

  private readKey(): string | null {
    const ch = this.peek();
    if (ch === undefined) return null;
    if (ch in QUOTES) return this.readString();
    return this.readBareKey();
  }

  private readArray(): string {
    this.pos += 1; // consume [
    const items: string[] = [];

    for (;;) {
      this.skipTrivia();

      if (this.done) {
        this.note('unclosed-bracket');
        break;
      }
      if (this.peek() === ']') {
        this.pos += 1;
        break;
      }
      if (this.peek() === ',') {
        this.note('trailing-comma');
        this.pos += 1;
        continue;
      }

      const before = this.pos;
      items.push(this.readValue());
      if (this.pos === before) {
        // Guarantees forward progress even on input we cannot interpret.
        this.pos += 1;
      }

      if (!this.consumeSeparator(']')) break;
    }

    return `[${items.join(',')}]`;
  }

  /**
   * Consumes the comma between entries. Returns false when the container has ended.
   * Reports both a trailing comma before the closer and a missing comma between items.
   */
  private consumeSeparator(closer: '}' | ']'): boolean {
    this.skipTrivia();

    if (this.done) {
      this.note('unclosed-bracket');
      return false;
    }

    if (this.peek() === closer) {
      this.pos += 1;
      return false;
    }

    if (this.peek() === ',') {
      this.pos += 1;
      this.skipTrivia();
      if (this.peek() === closer) {
        this.note('trailing-comma');
        this.pos += 1;
        return false;
      }
      if (this.done) {
        this.note('trailing-comma');
        this.note('unclosed-bracket');
        return false;
      }
      return true;
    }

    // Something that is neither a comma nor the closer: the comma was left out.
    this.note('missing-comma');
    return true;
  }

  private readValue(): string {
    this.skipTrivia();

    const ch = this.peek();
    if (ch === undefined) return 'null';
    if (ch === '{') return this.readObject();
    if (ch === '[') return this.readArray();
    if (ch in QUOTES) return this.readString();

    const literal = this.readLiteral();
    if (literal !== null) return literal;

    if (/[-+.0-9]/.test(ch)) return this.readNumber();

    // A bare word used as a value, e.g. {"status": ok} — treat it as a string.
    const bare = this.readBareKey();
    if (bare !== null) return bare;

    return 'null';
  }

  // ------------------------------------------------------------------ main

  parse(): ToolResult<RepairedJson> {
    const structural = this.findFirstStructural();

    if (structural === -1) {
      // No object or array anywhere, so the document can only be a bare scalar.
      // Bare words are deliberately NOT accepted here: without them, ordinary prose
      // would be "repaired" into an array of strings instead of being rejected.
      this.skipTrivia();
      if (this.done) return err('Nothing to repair — the input is empty.');

      const ch = this.peek()!;
      if (!(ch in QUOTES) && !/[-+.0-9]/.test(ch) && !this.literalAhead()) {
        return err(
          'Could not find any JSON in that input — there is no object, array, string or number to repair.'
        );
      }

      return this.finish([this.readValue()]);
    }

    // Anything before the first { or [ is a log prefix, a variable assignment, or
    // similar noise around the payload.
    if (structural > 0) {
      this.note('surrounding-text');
      this.pos = structural;
    }

    const documents = [this.readValue()];

    // Trailing content is either several concatenated documents (newline-delimited
    // JSON is the common case) or junk to ignore. Only a genuine document start counts
    // as another document — a trailing bare word is junk, not data.
    for (;;) {
      this.skipTrivia();
      if (this.done) break;

      if (this.peek() === ',') {
        this.pos += 1;
        continue;
      }

      if (this.isDocumentStart(this.peek()!)) {
        const before = this.pos;
        documents.push(this.readValue());
        if (this.pos === before) this.pos += 1;
        continue;
      }

      this.note('surrounding-text');
      break;
    }

    return this.finish(documents);
  }

  private finish(documents: string[]): ToolResult<RepairedJson> {
    if (documents.length > 1) this.note('multiple-documents');
    const json = documents.length > 1 ? `[${documents.join(',')}]` : documents[0]!;

    // The output is rebuilt from tokens so it should always be valid, but this is a
    // correctness guarantee worth paying for: never hand back a "fix" that is broken.
    try {
      JSON.parse(json);
    } catch {
      return err('That input is too damaged to repair automatically.');
    }

    return ok({ json, notes: this.report() });
  }

  /** True when a recognised literal token starts at the cursor, without consuming it. */
  private literalAhead(): boolean {
    return LITERALS.some(([token]) => {
      if (!this.src.startsWith(token, this.pos)) return false;
      const after = this.peek(token.length);
      return after === undefined || !/[\w$]/.test(after);
    });
  }

  /** Characters that can legitimately begin a whole JSON document. */
  private isDocumentStart(ch: string): boolean {
    return ch === '{' || ch === '[' || ch in QUOTES || /[-0-9]/.test(ch);
  }

  private findFirstStructural(): number {
    for (let i = this.pos; i < this.src.length; i += 1) {
      const ch = this.src[i]!;
      if (ch === '{' || ch === '[') return i;
    }
    return -1;
  }

  private report(): JsonRepairNote[] {
    return [...this.counts.entries()].map(([kind, count]) => ({
      kind,
      description: DESCRIPTIONS[kind],
      count,
    }));
  }
}

/**
 * Attempts to turn malformed JSON into valid JSON.
 *
 * Returns the repaired document along with a description of every change made. Fails
 * rather than guessing when the input contains no recoverable JSON at all.
 */
export function repairJson(input: string): ToolResult<RepairedJson> {
  if (input.trim() === '') return err('Nothing to repair — paste some JSON first.');
  return new LenientParser(input).parse();
}

/** True when the input is already strict JSON and needs no repair. */
export function isStrictJson(input: string): boolean {
  try {
    JSON.parse(input);
    return true;
  } catch {
    return false;
  }
}
