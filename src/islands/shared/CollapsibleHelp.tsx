import type { ComponentChildren } from 'preact';

interface Props {
  /** The always-visible line the visitor clicks to expand it. */
  summary: string;
  children: ComponentChildren;
}

/**
 * An accent-highlighted, collapsed-by-default "how do I get this input?" callout, for tools
 * whose input is awkward to obtain (an email's raw source, a response-header dump, a
 * certificate). Native `<details>` so it is keyboard-operable and needs no state.
 *
 * Collapsed by default so it never pushes the tool down, but highlighted so a first-time
 * visitor who has no idea where to find the input notices it.
 */
export function CollapsibleHelp({ summary, children }: Props) {
  return (
    <details class="help-callout">
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
