import { useEffect, useRef, useState } from 'preact/hooks';
import {
  formatSql,
  SQL_DIALECTS,
  SQL_DIALECT_LABELS,
  DEFAULT_SQL_FORMAT_OPTIONS,
  type SqlDialect,
  type SqlKeywordCase,
} from '../lib/tools/sqlFormatter';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';
import { DownloadButton } from './shared/DownloadButton';
import { ShareLinkButton } from './shared/ShareLinkButton';
import { useTextFileDrop } from './shared/useTextFileDrop';

/**
 * The same example query, adapted per dialect for "limit the results" — plain LIMIT
 * isn't valid syntax in T-SQL or Oracle, and loading it there would format into an
 * unhelpfully squashed single line instead of demonstrating the tool properly.
 */
const BASE_SAMPLE = (limitClause: string) =>
  `select o.id, c.name, sum(o.total) as revenue from orders o join customers c on c.id = o.customer_id where o.status = 'paid' and o.created_at >= '2026-01-01' group by o.id, c.name having sum(o.total) > 100 order by revenue desc${limitClause};`;

const DEFAULT_SAMPLE = BASE_SAMPLE(' limit 20');

const SAMPLES: Partial<Record<SqlDialect, string>> = {
  transactsql: `select top 20 o.id, c.name, sum(o.total) as revenue from orders o join customers c on c.id = o.customer_id where o.status = 'paid' and o.created_at >= '2026-01-01' group by o.id, c.name having sum(o.total) > 100 order by revenue desc;`,
  plsql: BASE_SAMPLE(' fetch first 20 rows only'),
};

const sampleFor = (dialect: SqlDialect): string => SAMPLES[dialect] ?? DEFAULT_SAMPLE;

interface ShareState {
  input: string;
  dialect: SqlDialect;
  keywordCase: SqlKeywordCase;
  tabWidth: number;
}

export default function SqlFormatter() {
  const [input, setInput] = useState('');
  const [dialect, setDialect] = useState<SqlDialect>(DEFAULT_SQL_FORMAT_OPTIONS.dialect);
  const [keywordCase, setKeywordCase] = useState<SqlKeywordCase>(DEFAULT_SQL_FORMAT_OPTIONS.keywordCase);
  const [tabWidth, setTabWidth] = useState(DEFAULT_SQL_FORMAT_OPTIONS.tabWidth);
  const [output, setOutput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const { isDragActive, dropHandlers } = useTextFileDrop(setInput);

  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      const state = restored.value;
      setInput(state.input);
      setDialect(state.dialect);
      setKeywordCase(state.keywordCase);
      setTabWidth(state.tabWidth);
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  useEffect(() => {
    const id = (requestId.current += 1);

    if (input.trim() === '') {
      setOutput('');
      setError(null);
      return;
    }

    void formatSql(input, { dialect, keywordCase, tabWidth }).then((result) => {
      // Ignore a stale response if the input or options changed again before this one resolved.
      if (id !== requestId.current) return;
      if (result.ok) {
        setOutput(result.value);
        setError(null);
      } else {
        setOutput('');
        setError(result.error);
      }
    });
  }, [input, dialect, keywordCase, tabWidth]);

  return (
    <div class="tool">
      <div class="tool-bar" role="group" aria-label="Formatting options">
        <label class="checkbox">
          <span class="field__hint">Dialect</span>
          <select
            class="select"
            style="width:auto"
            value={dialect}
            aria-label="SQL dialect"
            onChange={(event) => setDialect((event.target as HTMLSelectElement).value as SqlDialect)}
          >
            {SQL_DIALECTS.map((d) => (
              <option key={d} value={d}>
                {SQL_DIALECT_LABELS[d]}
              </option>
            ))}
          </select>
        </label>
        <label class="checkbox">
          <span class="field__hint">Keywords</span>
          <select
            class="select"
            style="width:auto"
            value={keywordCase}
            aria-label="Keyword case"
            onChange={(event) => setKeywordCase((event.target as HTMLSelectElement).value as SqlKeywordCase)}
          >
            <option value="upper">UPPER</option>
            <option value="lower">lower</option>
            <option value="preserve">Preserve</option>
          </select>
        </label>
        <label class="checkbox">
          <span class="field__hint">Indent</span>
          <select
            class="select"
            style="width:auto"
            value={String(tabWidth)}
            aria-label="Indent width"
            onChange={(event) => setTabWidth(Number((event.target as HTMLSelectElement).value))}
          >
            <option value="2">2 spaces</option>
            <option value="4">4 spaces</option>
          </select>
        </label>

        <span class="tool-bar__spacer" />
        <ShareLinkButton getState={() => ({ input, dialect, keywordCase, tabWidth })} describe="this query" />
        <button type="button" class="btn" onClick={() => setInput(sampleFor(dialect))} title="Load a small example">
          Load example
        </button>
        <button type="button" class="btn" onClick={() => setInput('')} disabled={input === ''} title="Clear the input">
          Clear
        </button>
      </div>

      <div class="panes panes--split">
        <div class="field">
          <label class="field__label" for="sql-input">
            <span>SQL input</span>
          </label>
          <textarea
            id="sql-input"
            class={`textarea textarea--tall${isDragActive ? ' textarea--drag-active' : ''}`}
            spellcheck={false}
            autocomplete="off"
            placeholder="Paste a SQL query here, or drop a .sql file"
            value={input}
            aria-invalid={error !== null}
            onInput={(event) => setInput((event.target as HTMLTextAreaElement).value)}
            {...dropHandlers}
          />
        </div>

        <OutputPane
          label="Formatted SQL"
          value={output}
          placeholder="Formatted SQL appears here."
          tall
          describe="the formatted SQL"
          actions={<DownloadButton value={output} filename="query.sql" mimeType="application/sql" describe="the formatted SQL" />}
        />
      </div>

      <ErrorMessage message={error} />
    </div>
  );
}
