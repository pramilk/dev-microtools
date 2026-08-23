import { type ToolResult, ok, err } from './result';

export interface PasswordOptions {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
  /** Excludes characters that are easy to misread when handed to someone verbally or on paper: 0/O, 1/l/I, and | */
  excludeAmbiguous: boolean;
}

export const DEFAULT_PASSWORD_OPTIONS: PasswordOptions = {
  length: 20,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: true,
  excludeAmbiguous: false,
};

export const MIN_PASSWORD_LENGTH = 4;
export const MAX_PASSWORD_LENGTH = 128;
export const MAX_PASSWORD_BATCH = 100;

const CHARSETS = {
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  numbers: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.<>?/~',
} as const;

const AMBIGUOUS = new Set('0O1lI|');

const withoutAmbiguous = (charset: string): string =>
  charset
    .split('')
    .filter((char) => !AMBIGUOUS.has(char))
    .join('');

function buildCharset(options: PasswordOptions): ToolResult<string> {
  let charset = '';
  if (options.uppercase) charset += CHARSETS.uppercase;
  if (options.lowercase) charset += CHARSETS.lowercase;
  if (options.numbers) charset += CHARSETS.numbers;
  if (options.symbols) charset += CHARSETS.symbols;

  if (charset === '') {
    return err('Select at least one character type — uppercase, lowercase, numbers or symbols.');
  }

  if (options.excludeAmbiguous) charset = withoutAmbiguous(charset);

  return ok(charset);
}

/** Unbiased random index in [0, max) via rejection sampling — `% max` on a raw random byte skews small values. */
function randomIndex(max: number): number {
  const range = 256 - (256 % max);
  const bytes = new Uint8Array(1);
  let value: number;
  do {
    crypto.getRandomValues(bytes);
    value = bytes[0]!;
  } while (value >= range);
  return value % max;
}

function validateOptions(options: PasswordOptions): string | null {
  if (!Number.isInteger(options.length) || options.length < MIN_PASSWORD_LENGTH || options.length > MAX_PASSWORD_LENGTH) {
    return `Password length must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH}.`;
  }
  return null;
}

/** Generates one password from the given options, using the Web Crypto CSPRNG. */
export function generatePassword(options: PasswordOptions): ToolResult<string> {
  const lengthError = validateOptions(options);
  if (lengthError) return err(lengthError);

  const charsetResult = buildCharset(options);
  if (!charsetResult.ok) return charsetResult;
  const charset = charsetResult.value;

  let password = '';
  for (let i = 0; i < options.length; i += 1) {
    password += charset[randomIndex(charset.length)];
  }
  return ok(password);
}

/** Generates several passwords at once, e.g. for provisioning a batch of accounts. */
export function generatePasswords(count: number, options: PasswordOptions): ToolResult<string[]> {
  if (!Number.isInteger(count) || count < 1) {
    return err('Enter how many passwords you need — at least 1.');
  }
  if (count > MAX_PASSWORD_BATCH) {
    return err(`That is more than this tool generates at once. Try ${MAX_PASSWORD_BATCH} or fewer.`);
  }

  const passwords: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const result = generatePassword(options);
    if (!result.ok) return result;
    passwords.push(result.value);
  }
  return ok(passwords);
}

/** Bits of entropy for a password of the given length drawn from the given options' charset. */
export function passwordEntropyBits(options: PasswordOptions): number {
  const charsetResult = buildCharset(options);
  if (!charsetResult.ok || options.length <= 0) return 0;
  return Math.floor(options.length * Math.log2(charsetResult.value.length));
}

export type PasswordStrengthLabel = 'Weak' | 'Fair' | 'Strong' | 'Very strong';

export interface PasswordStrength {
  bits: number;
  label: PasswordStrengthLabel;
  tone: 'error' | 'warning' | 'success';
}

/**
 * Labels entropy against rough offline-attack budgets: below 40 bits is crackable in
 * hours on consumer hardware, 40-60 within a plausible attacker's budget, 60-80 is
 * comfortable for most threat models, and 80+ is effectively unbreakable by brute force.
 */
export function passwordStrength(bits: number): PasswordStrength {
  if (bits < 40) return { bits, label: 'Weak', tone: 'error' };
  if (bits < 60) return { bits, label: 'Fair', tone: 'warning' };
  if (bits < 80) return { bits, label: 'Strong', tone: 'success' };
  return { bits, label: 'Very strong', tone: 'success' };
}
