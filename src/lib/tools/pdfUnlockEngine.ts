import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObjectStreamParser,
  PDFParser,
  PDFRawStream,
  PDFRef,
  PDFStream,
  PDFString,
  type PDFObject,
} from 'pdf-lib';
import { type ToolResult, ok, err, messageFrom } from './result';
import { looksLikePdf } from './pdfFile';
import { createDecryptor, openEncryption, type CipherMethod, type StandardEncryptionParams } from './pdfCrypto';
import { UNREADABLE_MESSAGE, hasSignature } from './pdfPageAssembly';
import { buildSamplePdf as buildPlainSamplePdf, protectPdf } from './pdfProtectEngine';
import { DEFAULT_PROTECT_OPTIONS, permissionsFromFlags, restrictionsOf } from './pdfProtect';
import type { PdfUnlockOptions, PdfUnlockOutput, PdfUnlockSourceInfo } from './pdfUnlock';

/**
 * The Unlock PDF pipeline. Imported only by `workers/pdfUnlock.worker.ts`, so pdf-lib and the
 * cipher never load on the page itself.
 *
 * pdf-lib can't decrypt, so this reads the Standard security handler's /Encrypt dictionary,
 * proves the password with `pdfCrypto.ts`, decrypts the strings and streams of every indirect
 * object in the loaded object graph, drops /Encrypt from the trailer and saves.
 *
 * One wrinkle: modern files pack most objects into compressed *object streams*, and the whole
 * stream is encrypted. pdf-lib inflates a stream while loading — on ciphertext, which fails —
 * so for the duration of the load the object-stream parser is swapped for one that just sets
 * each stream aside (with its object number, which RC4 and AES-128 need for the key). Once the
 * password has been proven, each is decrypted and handed to the real parser.
 */

const NOT_PDF_MESSAGE = 'This file doesn’t start with a PDF header, so it isn’t a PDF — it may be a different file type renamed to .pdf.';
const NOT_ENCRYPTED_MESSAGE = 'This PDF isn’t password-protected, so there’s nothing to unlock.';
const NEEDS_PASSWORD_MESSAGE = 'This PDF needs a password to open. Enter the open password (or the permissions password) above.';
const WRONG_PASSWORD_MESSAGE = 'That password doesn’t open this PDF. Check it for typos (passwords are case-sensitive) and try again.';
const CONFIRM_MESSAGE =
  'This PDF has restrictions, and the password you gave is its open password rather than its permissions password. Tick “I own this document or have permission to remove its restrictions” to unlock it anyway.';
const DAMAGED_MESSAGE = 'The encrypted data in this PDF couldn’t be decrypted — the file may be damaged or truncated. Try downloading or exporting it again.';

const name = (value: string): PDFName => PDFName.of(value);

// ------------------------------------------------------------------ loading

interface DeferredObjectStream {
  ref: PDFRef | null;
  stream: PDFRawStream;
}

/** A parser stand-in whose `parseIntoContext` does nothing — the real one runs later, on decrypted bytes. */
const INERT_PARSER = { parseIntoContext: async (): Promise<void> => undefined } as unknown as PDFObjectStreamParser;

/**
 * Loading swaps two pdf-lib internals for its duration, so two loads must never overlap. The
 * worker handles requests as they arrive (inspect and unlock can be in flight together), and
 * a load awaits, hence this queue.
 */
let loadQueue: Promise<void> = Promise.resolve();
const settled = (): void => undefined;

function serialized<T>(task: () => Promise<T>): Promise<T> {
  const result = loadQueue.then(task);
  loadQueue = result.then(settled, settled);
  return result;
}

interface LoadedDocument {
  doc: PDFDocument;
  deferred: DeferredObjectStream[];
}

async function loadSettingObjectStreamsAside(bytes: Uint8Array): Promise<ToolResult<LoadedDocument>> {
  if (!looksLikePdf(bytes)) return err(NOT_PDF_MESSAGE);

  // `parseIndirectObjectHeader` is private in pdf-lib's typings but an ordinary prototype method.
  const parserPrototype = PDFParser.prototype as unknown as { parseIndirectObjectHeader: () => PDFRef };
  const originalHeader = parserPrototype.parseIndirectObjectHeader;
  const originalForStream = PDFObjectStreamParser.forStream;
  const deferred: DeferredObjectStream[] = [];
  const latest: { ref: PDFRef | null } = { ref: null };

  parserPrototype.parseIndirectObjectHeader = function wrapped(this: unknown): PDFRef {
    const ref = originalHeader.call(this);
    latest.ref = ref;
    return ref;
  };
  PDFObjectStreamParser.forStream = (stream) => {
    deferred.push({ ref: latest.ref, stream });
    return INERT_PARSER;
  };
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false, ignoreEncryption: true });
    return ok({ doc, deferred });
  } catch {
    return err(UNREADABLE_MESSAGE);
  } finally {
    parserPrototype.parseIndirectObjectHeader = originalHeader;
    PDFObjectStreamParser.forStream = originalForStream;
  }
}

// ------------------------------------------------------------------ reading /Encrypt

interface ParsedEncryption {
  params: StandardEncryptionParams;
  streamMethod: CipherMethod;
  stringMethod: CipherMethod;
  cipher: string;
  encryptRef: PDFRef | null;
}

const bytesAt = (dict: PDFDict, key: string): Uint8Array | undefined => {
  const value = dict.lookup(name(key));
  return value instanceof PDFString || value instanceof PDFHexString ? value.asBytes() : undefined;
};

const numberAt = (dict: PDFDict, key: string): number | undefined => {
  const value = dict.lookup(name(key));
  return value instanceof PDFNumber ? value.asNumber() : undefined;
};

/** The cipher a crypt-filter name (`/StmF`, `/StrF`) selects, or null if it is one we cannot read. */
function methodNamed(encrypt: PDFDict, key: 'StmF' | 'StrF'): CipherMethod | null {
  const filterName = encrypt.lookup(name(key));
  if (!(filterName instanceof PDFName)) return 'none';
  const filterKey = filterName.decodeText();
  if (filterKey === 'Identity') return 'none';
  const filters = encrypt.lookup(name('CF'));
  const filter = filters instanceof PDFDict ? filters.lookup(name(filterKey)) : undefined;
  if (!(filter instanceof PDFDict)) return null;
  const method = filter.lookup(name('CFM'));
  switch (method instanceof PDFName ? method.decodeText() : '') {
    case 'V2':
      return 'rc4';
    case 'AESV2':
      return 'aesv2';
    case 'AESV3':
      return 'aesv3';
    case 'None':
      return 'none';
    default:
      return null;
  }
}

const describeCipher = (method: CipherMethod, keyBytes: number): string => {
  switch (method) {
    case 'aesv3':
      return 'AES-256';
    case 'aesv2':
      return 'AES-128';
    case 'rc4':
      return `RC4 ${keyBytes * 8}-bit`;
    case 'none':
      return 'unencrypted';
  }
};

function readEncryption(doc: PDFDocument): ToolResult<ParsedEncryption> {
  const { context } = doc;
  const entry = context.trailerInfo.Encrypt;
  const encryptRef = entry instanceof PDFRef ? entry : null;
  const encrypt = entry instanceof PDFRef ? context.lookup(entry) : entry;
  if (!(encrypt instanceof PDFDict)) return err(UNREADABLE_MESSAGE);

  const filter = encrypt.lookup(name('Filter'));
  if (!(filter instanceof PDFName) || filter.decodeText() !== 'Standard') {
    return err('This PDF is protected with a certificate or a custom security handler, not a password, so it can’t be unlocked here.');
  }
  const version = numberAt(encrypt, 'V') ?? 0;
  const revision = numberAt(encrypt, 'R') ?? 0;
  if (![1, 2, 4, 5].includes(version) || revision < 2 || revision > 6) {
    return err(`This PDF uses an encryption format this tool doesn’t support (version ${version}, revision ${revision}).`);
  }

  const streamMethod = version >= 4 ? methodNamed(encrypt, 'StmF') : 'rc4';
  const stringMethod = version >= 4 ? methodNamed(encrypt, 'StrF') : 'rc4';
  if (streamMethod === null || stringMethod === null) {
    return err('This PDF uses a custom encryption filter this tool doesn’t support.');
  }

  const keyBytes = version === 1 ? 5 : version >= 4 ? 16 : Math.min(16, Math.max(5, Math.floor((numberAt(encrypt, 'Length') ?? 40) / 8)));
  const owner = bytesAt(encrypt, 'O');
  const user = bytesAt(encrypt, 'U');
  const permissions = numberAt(encrypt, 'P');
  if (!owner || !user || permissions === undefined) return err(UNREADABLE_MESSAGE);

  const idEntry = context.trailerInfo.ID;
  const idFirst = idEntry instanceof PDFArray ? idEntry.lookup(0) : undefined;
  const metadataFlag = encrypt.lookup(name('EncryptMetadata'));

  return ok({
    params: {
      revision: revision as StandardEncryptionParams['revision'],
      keyBytes,
      owner,
      user,
      ownerKey: bytesAt(encrypt, 'OE'),
      userKey: bytesAt(encrypt, 'UE'),
      permissions: permissions | 0,
      id0: idFirst instanceof PDFString || idFirst instanceof PDFHexString ? idFirst.asBytes() : new Uint8Array(0),
      encryptMetadata: metadataFlag instanceof PDFBool ? metadataFlag.asBoolean() : true,
    },
    streamMethod,
    stringMethod,
    cipher: describeCipher(streamMethod === 'none' ? stringMethod : streamMethod, keyBytes),
    encryptRef,
  });
}

// ------------------------------------------------------------------ inspecting

export function inspectUnlockSource(bytes: Uint8Array): Promise<ToolResult<PdfUnlockSourceInfo>> {
  return serialized(async () => {
    const loaded = await loadSettingObjectStreamsAside(bytes);
    if (!loaded.ok) return loaded;
    if (!loaded.value.doc.isEncrypted) return ok({ encrypted: false });

    const parsed = readEncryption(loaded.value.doc);
    if (!parsed.ok) return ok({ encrypted: true, cipher: 'Unknown', needsPassword: false, restrictions: [], unsupported: parsed.error });
    const { params, cipher } = parsed.value;
    return ok({
      encrypted: true,
      cipher,
      needsPassword: openEncryption(params, '') === null,
      restrictions: restrictionsOf(permissionsFromFlags(params.permissions, params.revision)),
      unsupported: null,
    });
  });
}

// ------------------------------------------------------------------ decrypting

type Decryptor = (data: Uint8Array) => Uint8Array;

/** True for a stream whose /Filter chain names the Identity crypt filter — stored unencrypted on purpose. */
function usesIdentityCrypt(stream: PDFStream): boolean {
  const filter = stream.dict.lookup(name('Filter'));
  const filters = filter instanceof PDFArray ? filter.asArray() : [filter];
  const position = filters.findIndex((entry) => entry instanceof PDFName && entry.decodeText() === 'Crypt');
  if (position < 0) return false;
  const parms = stream.dict.lookup(name('DecodeParms'));
  const own = parms instanceof PDFArray ? parms.lookup(position) : parms;
  const filterName = own instanceof PDFDict ? own.lookup(name('Name')) : undefined;
  return !(filterName instanceof PDFName) || filterName.decodeText() === 'Identity';
}

/** Decrypts every string reachable *directly* from `value` (references are not followed). */
function decryptStrings(value: PDFObject, decrypt: Decryptor): PDFObject {
  if (value instanceof PDFString || value instanceof PDFHexString) {
    return PDFHexString.of(Array.from(decrypt(value.asBytes()), (byte) => byte.toString(16).padStart(2, '0')).join(''));
  }
  if (value instanceof PDFDict) {
    // A signature's /Contents was never encrypted (the byte range it signs includes it).
    const isSignature = value.has(name('ByteRange'));
    for (const [key, entry] of value.entries()) {
      if (isSignature && key === name('Contents')) continue;
      const next = decryptStrings(entry, decrypt);
      if (next !== entry) value.set(key, next);
    }
  } else if (value instanceof PDFArray) {
    for (let i = 0; i < value.size(); i += 1) {
      const entry = value.get(i);
      const next = decryptStrings(entry, decrypt);
      if (next !== entry) value.set(i, next);
    }
  }
  return value;
}

/** A raw stream carrying `contents` in place of its old bytes, with /Length brought up to date. */
function withContents(stream: PDFStream, contents: Uint8Array): PDFRawStream {
  stream.dict.set(name('Length'), PDFNumber.of(contents.length));
  return PDFRawStream.of(stream.dict, contents);
}

export function unlockPdf(bytes: Uint8Array, options: PdfUnlockOptions): Promise<ToolResult<PdfUnlockOutput>> {
  return serialized(async () => {
    const loaded = await loadSettingObjectStreamsAside(bytes);
    if (!loaded.ok) return loaded;
    const { doc, deferred } = loaded.value;
    if (!doc.isEncrypted) return err(NOT_ENCRYPTED_MESSAGE);

    const parsed = readEncryption(doc);
    if (!parsed.ok) return parsed;
    const { params, streamMethod, stringMethod, cipher, encryptRef } = parsed.value;

    const opened = openEncryption(params, options.password);
    if (!opened) return err(options.password === '' ? NEEDS_PASSWORD_MESSAGE : WRONG_PASSWORD_MESSAGE);
    const restrictions = restrictionsOf(permissionsFromFlags(params.permissions, params.revision));
    if (opened.role === 'user' && restrictions.length > 0 && !options.confirmRestrictionRemoval) return err(CONFIRM_MESSAGE);

    const { context } = doc;
    const decryptStream = createDecryptor(opened.fileKey, streamMethod);
    const decryptString = createDecryptor(opened.fileKey, stringMethod);
    const skipEncryptRef = encryptRef?.toString();

    try {
      // Objects that were parsed directly carry encrypted strings and streams. Those unpacked
      // from an object stream below do not — their container was the encrypted part.
      for (const [ref, object] of context.enumerateIndirectObjects()) {
        if (ref.toString() === skipEncryptRef) continue;
        if (object instanceof PDFStream) {
          decryptStrings(object.dict, decryptString(ref.objectNumber, ref.generationNumber));
          const isPlainMetadata = !params.encryptMetadata && object.dict.lookup(name('Type')) === name('Metadata');
          if (!isPlainMetadata && !usesIdentityCrypt(object)) {
            context.assign(ref, withContents(object, decryptStream(ref.objectNumber, ref.generationNumber)(object.getContents())));
          }
        } else {
          decryptStrings(object, decryptString(ref.objectNumber, ref.generationNumber));
        }
      }

      for (const { ref, stream } of deferred) {
        if (!ref) return err(UNREADABLE_MESSAGE);
        const plain = withContents(stream, decryptStream(ref.objectNumber, ref.generationNumber)(stream.getContents()));
        await PDFObjectStreamParser.forStream(plain).parseIntoContext();
      }

      context.trailerInfo.Encrypt = undefined;
      if (encryptRef) context.delete(encryptRef);

      // The document was constructed before its object streams were unpacked, so its catalog
      // (which may live in one) was never found. Save from the repaired context, then reload
      // the result as a normal document to count pages and check signatures.
      const output = await doc.save({ addDefaultPage: false, updateFieldAppearances: false });
      const reloaded = await PDFDocument.load(output, { updateMetadata: false, throwOnInvalidObject: false });
      const pageCount = reloaded.getPageCount();
      if (pageCount === 0) return err(UNREADABLE_MESSAGE);

      return ok({
        bytes: output,
        report: {
          pageCount,
          originalBytes: bytes.length,
          outputBytes: output.length,
          cipher,
          openedWith: opened.role === 'owner' ? 'permissions-password' : options.password === '' ? 'none' : 'open-password',
          removedRestrictions: restrictions,
          signed: hasSignature(reloaded),
        },
      });
    } catch (thrown: unknown) {
      const detail = messageFrom(thrown, '');
      return err(/pad|block|length|decrypt/i.test(detail) ? DAMAGED_MESSAGE : `Couldn’t unlock this PDF: ${detail || 'it contains something unexpected.'}`);
    }
  });
}

/** The file "Load example" opens: a password-protected three-page PDF (open password Sample-Pass-42). */
export async function buildSamplePdf(): Promise<Uint8Array> {
  const protectedSample = await protectPdf(await buildPlainSamplePdf(), { ...DEFAULT_PROTECT_OPTIONS, userPassword: 'Sample-Pass-42' });
  if (!protectedSample.ok) throw new Error(protectedSample.error);
  return protectedSample.value.bytes;
}
