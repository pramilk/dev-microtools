export { MAX_PDF_FILE_SIZE, validatePdfFile } from './pdfFile';

/**
 * Types and wording for Unlock PDF — free of any heavy import, since the island imports this
 * module on page load. The pdf-lib pipeline lives in `pdfUnlockEngine.ts` and the cipher in
 * `pdfCrypto.ts`; only the tool's Web Worker loads those.
 */

export interface PdfUnlockOptions {
  /** The open or permissions password. Empty is a real attempt: many files open with none. */
  password: string;
  /**
   * The visitor confirmed they may remove the file's restrictions. Required only when the
   * password given is the open password rather than the permissions password.
   */
  confirmRestrictionRemoval: boolean;
}

export const DEFAULT_UNLOCK_OPTIONS: PdfUnlockOptions = { password: '', confirmRestrictionRemoval: false };

/** What the engine learned about a chosen file before any password is asked for. */
export type PdfUnlockSourceInfo =
  | { encrypted: false }
  | {
      encrypted: true;
      /** e.g. "AES-256" or "RC4 128-bit". */
      cipher: string;
      /** The empty password does not open it — an open password is required. */
      needsPassword: boolean;
      /** What the file forbids (only known to be meaningful when `needsPassword` is false). */
      restrictions: string[];
      /** Not every tool can read the file: names the reason when the engine cannot decrypt it. */
      unsupported: string | null;
    };

export interface PdfUnlockReport {
  pageCount: number;
  originalBytes: number;
  outputBytes: number;
  cipher: string;
  /** Which password matched. 'none' = the file opened with no password at all. */
  openedWith: 'none' | 'open-password' | 'permissions-password';
  /** Restrictions that were on the file and are now gone. */
  removedRestrictions: string[];
  /** The file was digitally signed; rewriting it invalidates the signature. */
  signed: boolean;
}

export interface PdfUnlockOutput {
  bytes: Uint8Array;
  report: PdfUnlockReport;
}

export const OPENED_WITH_LABELS: Record<PdfUnlockReport['openedWith'], string> = {
  none: 'The file opened without a password.',
  'open-password': 'Opened with the open password.',
  'permissions-password': 'Opened with the permissions password.',
};

export const unlockedFileName = (name: string): string => `${name.replace(/\.pdf$/i, '') || 'document'}-unlocked.pdf`;
