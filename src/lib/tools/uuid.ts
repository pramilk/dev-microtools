import { type ToolResult, ok, err } from './result';

export type UuidVersion = 'v4' | 'v7';

const HEX = '0123456789abcdef';

const bytesToUuid = (bytes: Uint8Array): string => {
  let out = '';
  for (let i = 0; i < 16; i += 1) {
    if (i === 4 || i === 6 || i === 8 || i === 10) out += '-';
    const byte = bytes[i]!;
    out += HEX[byte >> 4]! + HEX[byte & 0x0f]!;
  }
  return out;
};

/** Random UUID. Uses the native generator where available, CSPRNG bytes otherwise. */
export function uuidV4(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  return bytesToUuid(bytes);
}

/**
 * Time-ordered UUID (RFC 9562). The first 48 bits are a Unix millisecond timestamp,
 * which makes these sort chronologically — the reason to prefer v7 over v4 for
 * database primary keys, where random values fragment the index.
 */
export function uuidV7(now: number = Date.now()): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));

  const timestamp = BigInt(Math.floor(now));
  for (let i = 0; i < 6; i += 1) {
    bytes[i] = Number((timestamp >> BigInt(8 * (5 - i))) & 0xffn);
  }

  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant
  return bytesToUuid(bytes);
}

export function generateUuids(count: number, version: UuidVersion): ToolResult<string[]> {
  if (!Number.isInteger(count) || count < 1) {
    return err('Enter how many UUIDs you need — at least 1.');
  }
  if (count > 1000) {
    return err('That is more than this tool generates at once. Try 1000 or fewer.');
  }

  const generate = version === 'v7' ? () => uuidV7() : uuidV4;
  return ok(Array.from({ length: count }, generate));
}

export const UUID_BULK_FORMATS = ['lines', 'json', 'csv', 'sql'] as const;
export type UuidBulkFormat = (typeof UUID_BULK_FORMATS)[number];

/** Renders a batch of UUIDs in a few common "paste elsewhere" shapes. */
export function formatUuids(uuids: string[], format: UuidBulkFormat): string {
  if (uuids.length === 0) return '';

  if (format === 'json') return JSON.stringify(uuids, null, 2);
  if (format === 'csv') return uuids.join(',');
  if (format === 'sql') return uuids.map((id) => `('${id}')`).join(',\n') + ';';
  return uuids.join('\n');
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-([1-8])[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface UuidInfo {
  version: number;
  variant: string;
  /** Only present for v7, which embeds its creation time. */
  timestamp?: Date;
}

/** Validates a UUID and extracts what can be read from it. */
export function inspectUuid(input: string): ToolResult<UuidInfo> {
  const trimmed = input.trim();
  if (trimmed === '') return err('Paste a UUID to inspect it.');

  const match = UUID_PATTERN.exec(trimmed);
  if (!match) {
    return err('That is not a valid RFC 4122 UUID. Expected 8-4-4-4-12 hexadecimal digits.');
  }

  const version = Number(match[1]);
  const info: UuidInfo = { version, variant: 'RFC 4122' };

  if (version === 7) {
    const millis = Number.parseInt(trimmed.replace(/-/g, '').slice(0, 12), 16);
    info.timestamp = new Date(millis);
  }

  return ok(info);
}
