import { type ToolResult, ok, err } from './result';

export type FakeFieldType =
  | 'fullName'
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'username'
  | 'phone'
  | 'streetAddress'
  | 'city'
  | 'state'
  | 'country'
  | 'zipCode'
  | 'company'
  | 'jobTitle'
  | 'uuid'
  | 'boolean'
  | 'integer'
  | 'float'
  | 'date'
  | 'sentence'
  | 'paragraph'
  | 'color';

export const FAKE_FIELD_TYPES: FakeFieldType[] = [
  'fullName',
  'firstName',
  'lastName',
  'email',
  'username',
  'phone',
  'streetAddress',
  'city',
  'state',
  'country',
  'zipCode',
  'company',
  'jobTitle',
  'uuid',
  'boolean',
  'integer',
  'float',
  'date',
  'sentence',
  'paragraph',
  'color',
];

export const FAKE_FIELD_LABELS: Record<FakeFieldType, string> = {
  fullName: 'Full name',
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  username: 'Username',
  phone: 'Phone',
  streetAddress: 'Street address',
  city: 'City',
  state: 'State/region',
  country: 'Country',
  zipCode: 'Zip/postal code',
  company: 'Company',
  jobTitle: 'Job title',
  uuid: 'UUID',
  boolean: 'Boolean',
  integer: 'Integer',
  float: 'Float',
  date: 'Date',
  sentence: 'Sentence',
  paragraph: 'Paragraph',
  color: 'Colour (hex)',
};

/** Field types with a user-configurable numeric range. */
export const RANGED_FIELD_TYPES = new Set<FakeFieldType>(['integer', 'float']);

export interface FakeDataField {
  id: string;
  type: FakeFieldType;
  /** Column header (CSV) or object key (JSON). */
  label: string;
  min?: number;
  max?: number;
  /** float only. */
  decimals?: number;
}

export type FakeDataFormat = 'json' | 'csv';

export interface FakeDataOptions {
  rowCount: number;
  fields: FakeDataField[];
  format: FakeDataFormat;
  /** Reusing a seed regenerates byte-for-byte identical output; null draws a fresh one each call. */
  seed: number | null;
}

export const MIN_ROWS = 1;
export const MAX_ROWS = 1000;
export const DEFAULT_INTEGER_RANGE = { min: 0, max: 100 };
export const DEFAULT_FLOAT_RANGE = { min: 0, max: 100, decimals: 2 };

// --------------------------------------------------------------------- reference data

const FIRST_NAMES = [
  'Ada', 'Grace', 'Liam', 'Noah', 'Olivia', 'Emma', 'Wei', 'Yuki', 'Diego', 'Sofia',
  'Amara', 'Kwame', 'Fatima', 'Omar', 'Priya', 'Arjun', 'Elena', 'Dmitri', 'Hana', 'Sanjay',
  'Maya', 'Lucas', 'Zoe', 'Ethan', 'Isla', 'Mateo', 'Nadia', 'Kenji', 'Aisha', 'Leo',
  'Chloe', 'Ravi', 'Ingrid', 'Tariq', 'Freya', 'Miguel', 'Anya', 'Jamal', 'Lena', 'Hiro',
];

const LAST_NAMES = [
  'Lovelace', 'Hopper', 'Chen', 'Nakamura', 'Garcia', 'Silva', 'Kowalski', 'Mensah', 'Khan', 'Patel',
  'Nguyen', 'Rossi', 'Muller', 'Andersen', 'Kim', 'Osei', 'Ibrahim', 'Popescu', 'Sato', 'Fernandez',
  'Novak', 'Haddad', 'Larsen', 'Costa', 'Weber', 'Yamamoto', 'Singh', 'Dubois', 'Okafor', 'Ivanov',
];

const EMAIL_DOMAINS = ['example.com', 'mail.example', 'testmail.dev', 'inbox.example', 'workmail.example'];

const STREET_NAMES = [
  'Maple', 'Oak', 'Cedar', 'Elm', 'Sunset', 'Highland', 'River', 'Lakeview', 'Willow', 'Birch',
  'Pine', 'Meadow', 'Harbor', 'Church', 'Union', 'Chestnut', 'Spring', 'Franklin', 'Ridge', 'Grove',
];
const STREET_TYPES = ['St', 'Ave', 'Blvd', 'Rd', 'Ln', 'Dr', 'Ct', 'Way'];

const CITIES = [
  'Springfield', 'Riverside', 'Fairview', 'Georgetown', 'Salem', 'Madison', 'Clinton', 'Arlington',
  'Franklin', 'Greenville', 'Bristol', 'Kingston', 'Newport', 'Ashford', 'Dover', 'Auburn',
  'Manchester', 'Oxford', 'Cambridge', 'Brighton',
];

const STATES = [
  'California', 'Texas', 'New York', 'Ontario', 'Bavaria', 'Queensland', 'Catalonia', 'Lombardy',
  'Gauteng', 'Punjab', 'Sao Paulo', 'Victoria', 'Bavaria', 'Alberta', 'Andalusia', 'Kansai',
];

const COUNTRIES = [
  'United States', 'Canada', 'United Kingdom', 'Germany', 'France', 'Spain', 'Italy', 'Japan',
  'Brazil', 'India', 'Australia', 'South Africa', 'Mexico', 'South Korea', 'Netherlands', 'Sweden',
];

const COMPANY_PREFIXES = [
  'Nova', 'Blue Harbor', 'Summit', 'Cedar', 'Bright', 'North Star', 'Quantum', 'Silverline',
  'Evergreen', 'Redwood', 'Anchor', 'Lumen', 'Vertex', 'Clearwater', 'Ironwood', 'Meridian',
];
const COMPANY_SUFFIXES = ['Group', 'Labs', 'Partners', 'Solutions', 'Dynamics', 'Studio', 'Collective', 'Works'];

const JOB_TITLES = [
  'Software Engineer', 'Product Manager', 'UX Designer', 'Data Analyst', 'Marketing Lead',
  'Operations Manager', 'Sales Associate', 'QA Engineer', 'DevOps Engineer', 'Account Executive',
  'Technical Writer', 'Customer Success Manager', 'Financial Analyst', 'HR Business Partner',
  'Solutions Architect', 'Research Scientist',
];

const LOREM_WORDS = [
  'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit', 'sed', 'do',
  'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore', 'magna', 'aliqua', 'enim',
  'ad', 'minim', 'veniam', 'quis', 'nostrud', 'exercitation', 'ullamco', 'laboris', 'nisi', 'aliquip',
];

// --------------------------------------------------------------------- seeded RNG

/** mulberry32 — small, fast, deterministic from an integer seed. Not cryptographic; this data is fake by design. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(rng: () => number, items: T[]): T => items[Math.floor(rng() * items.length)]!;
const randInt = (rng: () => number, min: number, max: number): number => Math.floor(rng() * (max - min + 1)) + min;
const randFloat = (rng: () => number, min: number, max: number, decimals: number): number =>
  Number((rng() * (max - min) + min).toFixed(decimals));

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}

function loremSentence(rng: () => number): string {
  const wordCount = randInt(rng, 6, 12);
  const words = Array.from({ length: wordCount }, () => pick(rng, LOREM_WORDS));
  const sentence = words.join(' ');
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.';
}

/** A structurally valid v4 UUID drawn from the seeded RNG, so a pinned seed reproduces the same value. */
function seededUuid(rng: () => number): string {
  const hex = () => Math.floor(rng() * 16).toString(16);
  const bytes = Array.from({ length: 32 }, hex);
  bytes[12] = '4';
  bytes[16] = ((parseInt(bytes[16]!, 16) & 0x3) | 0x8).toString(16);
  const s = bytes.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

function randomDate(rng: () => number): string {
  const now = Date.now();
  const fiveYearsMs = 5 * 365 * 24 * 60 * 60 * 1000;
  const timestamp = now - Math.floor(rng() * fiveYearsMs);
  return new Date(timestamp).toISOString().slice(0, 10);
}

interface PersonContext {
  first: string;
  last: string;
}

function fieldValue(rng: () => number, field: FakeDataField, person: PersonContext): string | number | boolean {
  switch (field.type) {
    case 'fullName':
      return `${person.first} ${person.last}`;
    case 'firstName':
      return person.first;
    case 'lastName':
      return person.last;
    case 'email':
      return `${person.first}.${person.last}@${pick(rng, EMAIL_DOMAINS)}`.toLowerCase();
    case 'username':
      return `${person.first}${person.last[0]}${randInt(rng, 1, 999)}`.toLowerCase();
    case 'phone': {
      const area = randInt(rng, 200, 999);
      const exchange = randInt(rng, 200, 999);
      const line = randInt(rng, 1000, 9999);
      return `(${area}) ${exchange}-${line}`;
    }
    case 'streetAddress':
      return `${randInt(rng, 100, 9999)} ${pick(rng, STREET_NAMES)} ${pick(rng, STREET_TYPES)}`;
    case 'city':
      return pick(rng, CITIES);
    case 'state':
      return pick(rng, STATES);
    case 'country':
      return pick(rng, COUNTRIES);
    case 'zipCode':
      return String(randInt(rng, 10000, 99999));
    case 'company':
      return `${pick(rng, COMPANY_PREFIXES)} ${pick(rng, COMPANY_SUFFIXES)}`;
    case 'jobTitle':
      return pick(rng, JOB_TITLES);
    case 'uuid':
      return seededUuid(rng);
    case 'boolean':
      return rng() < 0.5;
    case 'integer':
      return randInt(rng, field.min ?? DEFAULT_INTEGER_RANGE.min, field.max ?? DEFAULT_INTEGER_RANGE.max);
    case 'float':
      return randFloat(
        rng,
        field.min ?? DEFAULT_FLOAT_RANGE.min,
        field.max ?? DEFAULT_FLOAT_RANGE.max,
        field.decimals ?? DEFAULT_FLOAT_RANGE.decimals
      );
    case 'date':
      return randomDate(rng);
    case 'sentence':
      return loremSentence(rng);
    case 'paragraph':
      return Array.from({ length: randInt(rng, 3, 5) }, () => loremSentence(rng)).join(' ');
    case 'color':
      return `#${randInt(rng, 0, 0xffffff).toString(16).padStart(6, '0')}`;
  }
}

function escapeCsvField(field: string): string {
  if (field.includes('"') || field.includes(',') || field.includes('\n') || field.includes('\r')) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

function toCsv(fields: FakeDataField[], rows: Record<string, string | number | boolean>[]): string {
  const header = fields.map((f) => escapeCsvField(f.label)).join(',');
  const body = rows.map((row) => fields.map((f) => escapeCsvField(String(row[f.label]))).join(','));
  return [header, ...body].join('\r\n');
}

export function generateFakeData(options: FakeDataOptions): ToolResult<{ text: string; seed: number }> {
  const { rowCount, fields, format } = options;

  if (fields.length === 0) return err('Add at least one field to generate data.');
  if (!Number.isInteger(rowCount) || rowCount < MIN_ROWS || rowCount > MAX_ROWS) {
    return err(`Row count must be between ${MIN_ROWS} and ${MAX_ROWS}.`);
  }

  const labels = fields.map((f) => f.label.trim());
  if (labels.some((label) => label === '')) return err('Every field needs a non-empty column name.');
  if (new Set(labels).size !== labels.length) return err('Field names must be unique — two fields share the same name.');

  for (const field of fields) {
    if (RANGED_FIELD_TYPES.has(field.type) && field.min !== undefined && field.max !== undefined && field.min > field.max) {
      return err(`"${field.label}": minimum (${field.min}) is greater than maximum (${field.max}).`);
    }
  }

  const seed = options.seed ?? randomSeed();
  const rng = mulberry32(seed);

  const rows: Record<string, string | number | boolean>[] = [];
  for (let i = 0; i < rowCount; i += 1) {
    const person: PersonContext = { first: pick(rng, FIRST_NAMES), last: pick(rng, LAST_NAMES) };
    const row: Record<string, string | number | boolean> = {};
    for (const field of fields) {
      row[field.label] = fieldValue(rng, field, person);
    }
    rows.push(row);
  }

  const text = format === 'csv' ? toCsv(fields, rows) : JSON.stringify(rows, null, 2);
  return ok({ text, seed });
}
