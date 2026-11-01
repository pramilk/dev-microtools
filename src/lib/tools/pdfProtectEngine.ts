import { PDFArray, PDFBool, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFStream, PDFString, type PDFObject } from 'pdf-lib';
import { type ToolResult, ok, err, messageFrom } from './result';
import { looksLikePdf } from './pdfFile';
import { createSecurityHandler, encodePassword, randomBytes } from './pdfCrypto';
import { UNREADABLE_MESSAGE, hasSignature } from './pdfPageAssembly';
import { drawSamplePage, sampleDoc } from './pdfSamplePages';
import { permissionFlags, restrictionsOf, validateProtectOptions, type PdfProtectOptions, type PdfProtectOutput, type PdfProtectSourceInfo } from './pdfProtect';

/**
 * The Protect PDF pipeline. Imported only by `workers/pdfProtect.worker.ts`, so pdf-lib and
 * the cipher never load on the page itself.
 *
 * pdf-lib can't encrypt, so this does it at the object level: load the (unencrypted) file,
 * encrypt the strings and stream bytes of every indirect object with the security handler from
 * `pdfCrypto.ts`, add the `/Encrypt` dictionary to the trailer, and save with a classic
 * cross-reference table. Object streams are off because the strings inside them must not be
 * encrypted individually — the container is — and pdf-lib has already expanded them on load.
 */

const NOT_PDF_MESSAGE = 'This file doesn’t start with a PDF header, so it isn’t a PDF — it may be a different file type renamed to .pdf.';
const ENCRYPTED_MESSAGE =
  'This PDF is already password-protected (it has a password or permission restrictions). Remove that protection first with Unlock PDF, then protect the unlocked copy with new settings.';
const NO_PAGES_MESSAGE = 'This PDF has no pages, so there’s nothing to protect.';

const name = (value: string): PDFName => PDFName.of(value);

const toHex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

async function loadUnencrypted(bytes: Uint8Array): Promise<ToolResult<PDFDocument>> {
  if (!looksLikePdf(bytes)) return err(NOT_PDF_MESSAGE);
  let doc: PDFDocument;
  try {
    // Encryption is checked via `isEncrypted` rather than by catching pdf-lib's
    // `EncryptedPDFError`, whose ES5 compilation breaks `instanceof` (see pdfCompressEngine).
    doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false, ignoreEncryption: true });
  } catch {
    return err(UNREADABLE_MESSAGE);
  }
  if (doc.isEncrypted) return err(ENCRYPTED_MESSAGE);
  try {
    if (doc.getPageCount() === 0) return err(NO_PAGES_MESSAGE);
  } catch {
    return err(UNREADABLE_MESSAGE);
  }
  return ok(doc);
}

export async function inspectProtectSource(bytes: Uint8Array): Promise<ToolResult<PdfProtectSourceInfo>> {
  const loaded = await loadUnencrypted(bytes);
  if (!loaded.ok) return loaded;
  return ok({ pageCount: loaded.value.getPageCount(), signed: hasSignature(loaded.value) });
}

/** The first element of the trailer /ID, creating an /ID if the file has none (R4 mixes it into the key). */
function documentId(doc: PDFDocument): Uint8Array {
  const { context } = doc;
  const existing = context.trailerInfo.ID;
  if (existing instanceof PDFArray) {
    const first = existing.get(0);
    if (first instanceof PDFHexString || first instanceof PDFString) return first.asBytes();
  }
  const id = randomBytes(16);
  context.trailerInfo.ID = context.obj([PDFHexString.of(toHex(id)), PDFHexString.of(toHex(id))]);
  return id;
}

type Encryptor = (data: Uint8Array) => Uint8Array;

/** Replaces every string reachable *directly* from `value` (no references followed) with its encrypted hex form. */
function encryptStrings(value: PDFObject, encrypt: Encryptor): PDFObject {
  if (value instanceof PDFString || value instanceof PDFHexString) return PDFHexString.of(toHex(encrypt(value.asBytes())));
  if (value instanceof PDFDict) {
    // A signature's /Contents is excluded from encryption by the spec (the byte range it
    // signs includes it). Encrypting the file breaks the signature anyway, but leave the
    // field as the spec lays it out.
    const isSignature = value.has(name('ByteRange'));
    for (const [key, entry] of value.entries()) {
      if (isSignature && key === name('Contents')) continue;
      const next = encryptStrings(entry, encrypt);
      if (next !== entry) value.set(key, next);
    }
  } else if (value instanceof PDFArray) {
    for (let i = 0; i < value.size(); i += 1) {
      const entry = value.get(i);
      const next = encryptStrings(entry, encrypt);
      if (next !== entry) value.set(i, next);
    }
  }
  return value;
}

export async function protectPdf(bytes: Uint8Array, options: PdfProtectOptions): Promise<ToolResult<PdfProtectOutput>> {
  const valid = validateProtectOptions(options);
  if (!valid.ok) return valid;
  const loaded = await loadUnencrypted(bytes);
  if (!loaded.ok) return loaded;
  const doc = loaded.value;
  const { context } = doc;

  const generatedOwnerPassword = options.ownerPassword === '';
  const handler = createSecurityHandler({
    encryption: options.encryption,
    userPassword: encodePassword(options.userPassword, options.encryption),
    // 32 random bytes as a password: unguessable, so only the user password (and the
    // permissions it grants) can ever open the file.
    ownerPassword: generatedOwnerPassword ? randomBytes(32) : encodePassword(options.ownerPassword, options.encryption),
    permissions: permissionFlags(options.permissions),
    id0: documentId(doc),
  });

  try {
    // A snapshot: assigning replacement streams while iterating the live map is legal but needlessly subtle.
    for (const [ref, object] of context.enumerateIndirectObjects()) {
      const encrypt = handler.encryptorFor(ref.objectNumber, ref.generationNumber);
      if (object instanceof PDFStream) {
        encryptStrings(object.dict, encrypt);
        const encrypted = encrypt(object.getContents());
        object.dict.set(name('Length'), PDFNumber.of(encrypted.length));
        context.assign(ref, PDFRawStream.of(object.dict, encrypted));
      } else {
        encryptStrings(object, encrypt);
      }
    }

    const { dict } = handler;
    const encryptDict = PDFDict.withContext(context);
    encryptDict.set(name('Filter'), name('Standard'));
    encryptDict.set(name('V'), PDFNumber.of(dict.version));
    encryptDict.set(name('R'), PDFNumber.of(dict.revision));
    encryptDict.set(name('Length'), PDFNumber.of(dict.keyBits));
    encryptDict.set(
      name('CF'),
      context.obj({ StdCF: { AuthEvent: 'DocOpen', CFM: dict.cryptFilterMethod, Length: dict.cryptFilterBytes } })
    );
    encryptDict.set(name('StmF'), name('StdCF'));
    encryptDict.set(name('StrF'), name('StdCF'));
    encryptDict.set(name('P'), PDFNumber.of(dict.permissions));
    encryptDict.set(name('EncryptMetadata'), PDFBool.True);
    encryptDict.set(name('O'), PDFHexString.of(toHex(dict.owner)));
    encryptDict.set(name('U'), PDFHexString.of(toHex(dict.user)));
    if (dict.ownerKey) encryptDict.set(name('OE'), PDFHexString.of(toHex(dict.ownerKey)));
    if (dict.userKey) encryptDict.set(name('UE'), PDFHexString.of(toHex(dict.userKey)));
    if (dict.permsBlock) encryptDict.set(name('Perms'), PDFHexString.of(toHex(dict.permsBlock)));
    // Registered only now so the loop above never encrypted the dictionary's own strings.
    context.trailerInfo.Encrypt = context.register(encryptDict);

    const output = await doc.save({ useObjectStreams: false, updateFieldAppearances: false });
    return ok({
      bytes: output,
      report: {
        pageCount: doc.getPageCount(),
        originalBytes: bytes.length,
        outputBytes: output.length,
        encryption: options.encryption,
        openPassword: options.userPassword !== '',
        generatedOwnerPassword,
        restrictions: restrictionsOf(options.permissions),
        signed: hasSignature(doc),
      },
    });
  } catch (thrown: unknown) {
    return err(`Couldn’t protect this PDF: ${messageFrom(thrown, 'it contains something unexpected. Try re-exporting it from the app that created it.')}`);
  }
}

/** The file "Load example" opens: three plain pages — enough to see that the protected copy asks for a password. */
export async function buildSamplePdf(): Promise<Uint8Array> {
  const { doc, fonts } = await sampleDoc('Quarterly report (sample)');
  const accent: [number, number, number] = [0.04, 0.43, 0.5];
  const pages = [
    { title: 'Q3 summary', lines: ['Revenue grew 12% on the previous quarter.', 'Churn held steady at 1.8%.'] },
    { title: 'Salary bands', lines: ['This page is the kind of thing worth a password.', 'Copying and editing are blocked in the example.'] },
    { title: 'Next steps', lines: ['Share the password separately from the file.', 'A strong password is the real protection.'] },
  ];
  pages.forEach((page, i) => {
    drawSamplePage(doc.addPage([595, 842]), fonts, accent, { kicker: 'quarterly-report.pdf', title: page.title, lines: page.lines, footer: `quarterly-report.pdf · page ${i + 1} of ${pages.length}` });
  });
  return doc.save();
}
