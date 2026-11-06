import { CopyButton } from './CopyButton';

export interface ResultRow {
  label: string;
  value: string;
  /** Optional one-line explanation shown under the value. */
  hint?: string;
  /** Text to copy when it should differ from what is displayed. Defaults to `value`. */
  copyValue?: string;
}

interface Props {
  rows: readonly ResultRow[];
  /** Accessible name for the list, e.g. "Date difference". */
  label: string;
}

/**
 * A definition list of labelled results, each with its own copy button. Used by tools whose
 * output is several small facts rather than one block of text.
 */
export function ResultRows({ rows, label }: Props) {
  return (
    <dl class="result-rows" aria-label={label}>
      {rows.map((row) => (
        <>
          <dt key={`k-${row.label}`}>{row.label}</dt>
          <dd key={`v-${row.label}`}>
            <span class="result-rows__text">
              <span class="result-rows__value">{row.value}</span>
              {row.hint && <span class="result-rows__hint">{row.hint}</span>}
            </span>
            <CopyButton value={row.copyValue ?? row.value} describe={row.label} />
          </dd>
        </>
      ))}
    </dl>
  );
}
