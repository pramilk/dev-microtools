import { type ToolResult, ok, err, messageFrom } from './result';

export type DataFormat = 'json' | 'yaml' | 'csv';

export const DATA_FORMATS: DataFormat[] = ['json', 'yaml', 'csv'];

export const DATA_FORMAT_LABELS: Record<DataFormat, string> = {
  json: 'JSON',
  yaml: 'YAML',
  csv: 'CSV',
};

/**
 * Bounds how much text this tool will attempt to convert client-side. CSV parsing,
 * JSON.stringify and js-yaml's dump are all synchronous — an unbounded input would
 * block the main thread with no way to show progress or cancel.
 */
export const MAX_INPUT_LENGTH = 5_000_000;

export interface DataFormatOptions {
  /** CSV field delimiter. Only affects CSV parsing/serialising. */
  delimiter: string;
  /** CSV only: whether the first row is a header naming each column. */
  hasHeader: boolean;
}

export const DEFAULT_DATA_FORMAT_OPTIONS: DataFormatOptions = { delimiter: ',', hasHeader: true };

// ------------------------------------------------------------------------- CSV

/**
 * Parses RFC 4180-style CSV: quoted fields, `""` as an escaped quote, and quoted
 * fields that contain the delimiter or a line break. Returns raw string rows —
 * CSV has no type system, so no cell is ever coerced to a number or boolean here.
 */
export function parseCsv(text: string, delimiter = ','): ToolResult<string[][]> {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i]!;

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      if (field !== '') {
        return err(`A " appears in the middle of an unquoted field near position ${i} — quotes are only valid at the start of a field.`);
      }
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === delimiter) {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (char === '\r') {
      i += 1;
      continue;
    }
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    field += char;
    i += 1;
  }

  if (inQuotes) return err('Unterminated quoted field — a closing " is missing.');

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return ok(rows);
}

function escapeCsvField(field: string, delimiter: string): string {
  if (field.includes('"') || field.includes(delimiter) || field.includes('\n') || field.includes('\r')) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

function rowsToCsvString(rows: string[][], delimiter: string): string {
  return rows.map((row) => row.map((field) => escapeCsvField(field, delimiter)).join(delimiter)).join('\r\n');
}

function csvRowsToValue(rows: string[][], hasHeader: boolean): unknown {
  if (rows.length === 0) return [];
  if (!hasHeader) return rows;

  const [header, ...dataRows] = rows as [string[], ...string[][]];
  return dataRows.map((row) => {
    const record: Record<string, string> = {};
    header.forEach((key, index) => {
      record[key || `column${index + 1}`] = row[index] ?? '';
    });
    return record;
  });
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function stringifyCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  // A nested object/array has no flat CSV representation — embed it as JSON text
  // rather than silently dropping data or throwing.
  return JSON.stringify(value);
}

const describeType = (value: unknown): string => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array of mixed values';
  return `a ${typeof value}`;
};

function valueToCsvRows(value: unknown): ToolResult<string[][]> {
  if (!Array.isArray(value)) {
    return err(`Converting to CSV needs an array at the top level — this value is ${describeType(value)}.`);
  }
  if (value.length === 0) return ok([]);

  if (value.every(isPlainObject)) {
    const records = value as Record<string, unknown>[];
    const headers: string[] = [];
    for (const record of records) {
      for (const key of Object.keys(record)) {
        if (!headers.includes(key)) headers.push(key);
      }
    }
    const rows = records.map((record) => headers.map((key) => stringifyCsvCell(record[key])));
    return ok([headers, ...rows]);
  }

  if (value.every((item) => Array.isArray(item))) {
    return ok((value as unknown[][]).map((row) => row.map(stringifyCsvCell)));
  }

  return err('Converting to CSV needs a flat array of objects, or an array of arrays — this array mixes other kinds of values.');
}

// ------------------------------------------------------------------------- I/O

let yamlModule: typeof import('js-yaml') | null = null;
async function loadYaml(): Promise<typeof import('js-yaml')> {
  yamlModule ??= await import('js-yaml');
  return yamlModule;
}

async function parseValue(input: string, format: DataFormat, options: DataFormatOptions): Promise<ToolResult<unknown>> {
  if (format === 'json') {
    try {
      return ok(JSON.parse(input) as unknown);
    } catch (error) {
      return err(messageFrom(error, 'Could not parse as JSON.'));
    }
  }

  if (format === 'yaml') {
    try {
      const yaml = await loadYaml();
      return ok(yaml.load(input));
    } catch (error) {
      return err(messageFrom(error, 'Could not parse as YAML.'));
    }
  }

  const rows = parseCsv(input, options.delimiter);
  if (!rows.ok) return rows;
  return ok(csvRowsToValue(rows.value, options.hasHeader));
}

async function stringifyValue(value: unknown, format: DataFormat, options: DataFormatOptions): Promise<ToolResult<string>> {
  if (format === 'json') {
    try {
      return ok(JSON.stringify(value, null, 2));
    } catch (error) {
      return err(messageFrom(error, 'Could not serialise as JSON — the value may contain a circular reference.'));
    }
  }

  if (format === 'yaml') {
    try {
      const yaml = await loadYaml();
      return ok(yaml.dump(value));
    } catch (error) {
      return err(messageFrom(error, 'Could not serialise as YAML.'));
    }
  }

  const rows = valueToCsvRows(value);
  if (!rows.ok) return rows;
  return ok(rowsToCsvString(rows.value, options.delimiter));
}

/**
 * Guesses a text blob's format from its shape, for auto-selecting "From" when someone
 * pastes or drops data in rather than picking a format first. Deliberately conservative —
 * a wrong guess is corrected in one click, but a false "detection" that's actually wrong
 * is worse than admitting "not sure" (returning null leaves the current selection alone).
 */
export function detectFormat(text: string): DataFormat | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      // Falls through — starts like JSON but isn't valid; could still be YAML flow syntax.
    }
  }

  const firstLine = trimmed.split(/\r?\n/, 1)[0]!;

  // A document marker, a "key:" mapping, or a "- " list item on the first line.
  if (trimmed.startsWith('---') || /^-\s/.test(firstLine) || /^[\w"'.-]+:(\s|$)/.test(firstLine)) {
    return 'yaml';
  }

  // Several lines, with a delimiter on the first — most likely a CSV/TSV header row.
  if (/[,;\t|]/.test(firstLine) && trimmed.includes('\n')) {
    return 'csv';
  }

  return null;
}

/** Converts between JSON, YAML and CSV by parsing to a common JS value, then re-serialising. */
export async function convertDataFormat(
  input: string,
  from: DataFormat,
  to: DataFormat,
  options: DataFormatOptions = DEFAULT_DATA_FORMAT_OPTIONS
): Promise<ToolResult<string>> {
  const trimmed = input.trim();
  if (trimmed === '') return err('Enter some data to convert.');
  if (input.length > MAX_INPUT_LENGTH) {
    return err(
      `Input is too large to convert in the browser (${input.length.toLocaleString()} characters, limit ${MAX_INPUT_LENGTH.toLocaleString()}).`
    );
  }

  const parsed = await parseValue(input, from, options);
  if (!parsed.ok) return err(`Invalid ${DATA_FORMAT_LABELS[from]} input: ${parsed.error}`);
  if (parsed.value === undefined) {
    return err(`This ${DATA_FORMAT_LABELS[from]} input parsed to an empty document — there is no data to convert.`);
  }

  return stringifyValue(parsed.value, to, options);
}
