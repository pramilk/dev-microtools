import { type ToolResult, ok, err } from './result';

export { MAX_PDF_FILE_SIZE, validatePdfFile } from './pdfFile';

/**
 * Settings, validation and result types for Protect PDF — free of any heavy import, since the
 * island imports this module on page load. The pdf-lib pipeline lives in `pdfProtectEngine.ts`
 * and the cipher in `pdfCrypto.ts`; only the tool's Web Worker loads those.
 */

export type PdfEncryption = 'aes256' | 'aes128';

/** Longest password a revision can use: R6 truncates at 127 UTF-8 bytes, R4 at the 32-byte pad. */
export const MAX_PASSWORD_BYTES: Record<PdfEncryption, number> = { aes256: 127, aes128: 32 };

export type PrintPermission = 'full' | 'low' | 'none';

export interface PdfPermissions {
  print: PrintPermission;
  copy: boolean;
  edit: boolean;
  annotate: boolean;
  fillForms: boolean;
  assemble: boolean;
  /** Text extraction for screen readers. Keep on: turning it off locks out assistive technology. */
  accessibility: boolean;
}

export interface PdfProtectOptions {
  /** Needed to open the file. Empty = anyone can open it (permissions only). */
  userPassword: string;
  /** Lifts the permissions. Empty = a random one nobody knows is generated. */
  ownerPassword: string;
  encryption: PdfEncryption;
  permissions: PdfPermissions;
}

export const ALL_PERMITTED: PdfPermissions = { print: 'full', copy: true, edit: true, annotate: true, fillForms: true, assemble: true, accessibility: true };

export const DEFAULT_PROTECT_OPTIONS: PdfProtectOptions = { userPassword: '', ownerPassword: '', encryption: 'aes256', permissions: ALL_PERMITTED };

export const ENCRYPTION_LABELS: Record<PdfEncryption, string> = {
  aes256: 'AES-256 (recommended)',
  aes128: 'AES-128 (older readers)',
};

export const ENCRYPTION_HINTS: Record<PdfEncryption, string> = {
  aes256: 'The strongest option, from Acrobat X (2010) on and every modern browser and phone viewer.',
  aes128: 'Opens in readers back to Acrobat 7 (2005). Weaker key derivation and passwords limited to 32 Latin-1 characters.',
};

export const PRINT_LABELS: Record<PrintPermission, string> = {
  full: 'Allowed',
  low: 'Low resolution only',
  none: 'Not allowed',
};

// Permission bits of the /P entry (ISO 32000-1 Table 22); bit n is `1 << (n - 1)`.
const BIT_PRINT = 1 << 2;
const BIT_MODIFY = 1 << 3;
const BIT_COPY = 1 << 4;
const BIT_ANNOTATE = 1 << 5;
const BIT_FILL_FORMS = 1 << 8;
const BIT_ACCESSIBILITY = 1 << 9;
const BIT_ASSEMBLE = 1 << 10;
const BIT_PRINT_HIGH = 1 << 11;
/** Bits 7-8 and 13-32 are reserved and must be 1. */
const RESERVED_BITS = 0xfffff0c0;

/** The signed 32-bit /P value for a set of permissions. */
export function permissionFlags(permissions: PdfPermissions): number {
  let flags = RESERVED_BITS;
  if (permissions.print !== 'none') flags |= BIT_PRINT;
  if (permissions.print === 'full') flags |= BIT_PRINT_HIGH;
  if (permissions.edit) flags |= BIT_MODIFY;
  if (permissions.copy) flags |= BIT_COPY;
  if (permissions.annotate) flags |= BIT_ANNOTATE;
  if (permissions.fillForms) flags |= BIT_FILL_FORMS;
  if (permissions.accessibility) flags |= BIT_ACCESSIBILITY;
  if (permissions.assemble) flags |= BIT_ASSEMBLE;
  return flags | 0;
}

/**
 * The inverse of `permissionFlags`: what a /P value allows. Revision 2 only defines the bits
 * for printing, modifying, copying and annotating; everything else it leaves permitted. From
 * revision 3, printing is "low resolution only" unless the high-quality bit is also set.
 */
export function permissionsFromFlags(flags: number, revision: number): PdfPermissions {
  const has = (bit: number): boolean => (flags & bit) !== 0;
  const legacy = revision < 3;
  return {
    print: !has(BIT_PRINT) ? 'none' : legacy || has(BIT_PRINT_HIGH) ? 'full' : 'low',
    edit: has(BIT_MODIFY),
    copy: has(BIT_COPY),
    annotate: has(BIT_ANNOTATE),
    fillForms: legacy || has(BIT_FILL_FORMS),
    accessibility: legacy || has(BIT_ACCESSIBILITY),
    assemble: legacy || has(BIT_ASSEMBLE),
  };
}

/** What the file will forbid, in words, for the options summary and the result panel. Empty = nothing restricted. */
export function restrictionsOf(permissions: PdfPermissions): string[] {
  const restrictions: string[] = [];
  if (permissions.print === 'none') restrictions.push('Printing');
  if (permissions.print === 'low') restrictions.push('High-quality printing');
  if (!permissions.copy) restrictions.push('Copying text and images');
  if (!permissions.edit) restrictions.push('Editing content');
  if (!permissions.annotate) restrictions.push('Adding comments and annotations');
  if (!permissions.fillForms) restrictions.push('Filling in forms');
  if (!permissions.assemble) restrictions.push('Inserting, deleting and rotating pages');
  if (!permissions.accessibility) restrictions.push('Screen-reader text access');
  return restrictions;
}

const utf8Length = (value: string): number => new TextEncoder().encode(value.normalize('NFKC')).length;

/** Why a password can't be used with this encryption, or null if it can. */
export function passwordProblem(password: string, encryption: PdfEncryption, label: string): string | null {
  if (encryption === 'aes128') {
    if (Array.from(password).some((char) => char.charCodeAt(0) > 0xff)) {
      return `The ${label} has characters AES-128 can't store (anything beyond Latin-1, such as emoji or non-Latin scripts). Use AES-256 or simplify the password.`;
    }
    if (password.length > MAX_PASSWORD_BYTES.aes128) {
      return `The ${label} is longer than the ${MAX_PASSWORD_BYTES.aes128} characters AES-128 supports. Shorten it or switch to AES-256.`;
    }
    return null;
  }
  if (utf8Length(password) > MAX_PASSWORD_BYTES.aes256) {
    return `The ${label} is longer than ${MAX_PASSWORD_BYTES.aes256} bytes, the most PDF encryption uses. Shorten it.`;
  }
  return null;
}

/** Checks the options as a whole; the first problem found is returned, worded for the visitor. */
export function validateProtectOptions(options: PdfProtectOptions): ToolResult<PdfProtectOptions> {
  const { userPassword, ownerPassword, encryption, permissions } = options;
  const restricted = restrictionsOf(permissions).length > 0;

  if (userPassword === '' && !restricted) {
    return err('Enter an open password, or restrict at least one permission — as it stands the file would not be protected at all.');
  }
  const userProblem = passwordProblem(userPassword, encryption, 'open password');
  if (userProblem) return err(userProblem);
  const ownerProblem = passwordProblem(ownerPassword, encryption, 'permissions password');
  if (ownerProblem) return err(ownerProblem);
  if (restricted && ownerPassword !== '' && ownerPassword === userPassword) {
    return err('The permissions password must differ from the open password — with the same one, anyone who opens the file has full rights and the restrictions mean nothing.');
  }
  return ok(options);
}

export type OpenPasswordStrength = { label: 'Weak' | 'Fair' | 'Strong'; tone: 'error' | 'warning' | 'success' };

/**
 * A rough read on a typed open password. The file can be attacked offline with no rate
 * limit, so length matters far more than clever substitutions — hence the length-led bands.
 * Not an entropy estimate: a common phrase of any length is still weak.
 */
export function rateOpenPassword(password: string): OpenPasswordStrength | null {
  if (password === '') return null;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length;
  const length = Array.from(password).length;
  if (length >= 16 || (length >= 12 && classes >= 3)) return { label: 'Strong', tone: 'success' };
  if (length >= 10 || (length >= 8 && classes >= 3)) return { label: 'Fair', tone: 'warning' };
  return { label: 'Weak', tone: 'error' };
}

export interface PdfProtectSourceInfo {
  pageCount: number;
  /** The file carries a digital signature, which encrypting invalidates. */
  signed: boolean;
}

export interface PdfProtectReport {
  pageCount: number;
  originalBytes: number;
  outputBytes: number;
  encryption: PdfEncryption;
  openPassword: boolean;
  /** A random permissions password was generated because none was given. */
  generatedOwnerPassword: boolean;
  restrictions: string[];
  signed: boolean;
}

export interface PdfProtectOutput {
  bytes: Uint8Array;
  report: PdfProtectReport;
}

export const protectedFileName = (name: string): string => `${name.replace(/\.pdf$/i, '') || 'document'}-protected.pdf`;
