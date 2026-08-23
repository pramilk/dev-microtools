import { type ToolResult, ok, err, messageFrom } from './result';

export type SqlDialect =
  | 'sql'
  | 'mysql'
  | 'mariadb'
  | 'postgresql'
  | 'sqlite'
  | 'transactsql'
  | 'plsql'
  | 'bigquery'
  | 'snowflake'
  | 'redshift';

export const SQL_DIALECTS: SqlDialect[] = [
  'sql',
  'mysql',
  'mariadb',
  'postgresql',
  'sqlite',
  'transactsql',
  'plsql',
  'bigquery',
  'snowflake',
  'redshift',
];

export const SQL_DIALECT_LABELS: Record<SqlDialect, string> = {
  sql: 'Standard SQL',
  mysql: 'MySQL',
  mariadb: 'MariaDB',
  postgresql: 'PostgreSQL',
  sqlite: 'SQLite',
  transactsql: 'SQL Server (T-SQL)',
  plsql: 'Oracle (PL/SQL)',
  bigquery: 'BigQuery',
  snowflake: 'Snowflake',
  redshift: 'Redshift',
};

export type SqlKeywordCase = 'preserve' | 'upper' | 'lower';

export interface SqlFormatOptions {
  dialect: SqlDialect;
  keywordCase: SqlKeywordCase;
  tabWidth: number;
}

export const DEFAULT_SQL_FORMAT_OPTIONS: SqlFormatOptions = {
  dialect: 'sql',
  keywordCase: 'upper',
  tabWidth: 2,
};

/**
 * Bounds how much text this tool will attempt to format client-side. The formatter's
 * parser is synchronous and runs on the main thread with no way to show progress.
 */
export const MAX_INPUT_LENGTH = 500_000;

let formatterModule: typeof import('sql-formatter') | null = null;
async function loadFormatter(): Promise<typeof import('sql-formatter')> {
  formatterModule ??= await import('sql-formatter');
  return formatterModule;
}

/**
 * The underlying parser reports errors as a full grammar dump (every production rule
 * it was willing to accept next) — useful to a parser author, meaningless to a user.
 * Only the first line ("Parse error ... at line N column M") is ever human-readable.
 */
function firstLine(message: string): string {
  return message.split('\n')[0] ?? message;
}

export async function formatSql(input: string, options: SqlFormatOptions = DEFAULT_SQL_FORMAT_OPTIONS): Promise<ToolResult<string>> {
  if (input.trim() === '') return err('Enter some SQL to format.');
  if (input.length > MAX_INPUT_LENGTH) {
    return err(
      `Input is too large to format in the browser (${input.length.toLocaleString()} characters, limit ${MAX_INPUT_LENGTH.toLocaleString()}).`
    );
  }

  try {
    const { format } = await loadFormatter();
    const formatted = format(input, {
      language: options.dialect,
      keywordCase: options.keywordCase,
      tabWidth: options.tabWidth,
      useTabs: false,
    });
    return ok(formatted);
  } catch (error) {
    return err(`Could not format this SQL: ${firstLine(messageFrom(error, 'unknown parse error'))}`);
  }
}
