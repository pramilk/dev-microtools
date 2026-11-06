export type FindingSeverity = 'danger' | 'warning' | 'info' | 'ok';

export interface FindingItem {
  /** Stable id, used as the list key. */
  id: string;
  severity: FindingSeverity;
  title: string;
  detail: string;
  /** A ready-to-use fix (for example a header line), shown in monospace under the detail. */
  fix?: string;
}

const SEVERITY_LABEL: Record<FindingSeverity, string> = {
  danger: 'Danger',
  warning: 'Warning',
  info: 'Note',
  ok: 'OK',
};

interface Props {
  items: readonly FindingItem[];
}

/**
 * Severity-tagged list of findings, shared by the analyzer tools. Takes the smallest shape
 * it needs rather than any one tool's result type, so each tool maps into it.
 */
export function FindingList({ items }: Props) {
  return (
    <ul class="finding-list">
      {items.map((item) => (
        <li key={item.id} class={`finding finding--${item.severity}`}>
          <span class="finding__tag">{SEVERITY_LABEL[item.severity]}</span>
          <div>
            <p class="finding__title">{item.title}</p>
            <p class="finding__detail">{item.detail}</p>
            {item.fix && <code class="finding__fix">{item.fix}</code>}
          </div>
        </li>
      ))}
    </ul>
  );
}
