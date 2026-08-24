import { useState } from 'preact/hooks';

interface NodeProps {
  label: string | null;
  value: unknown;
  path: string;
  collapsed: Set<string>;
  toggle: (path: string) => void;
}

/** One node of the tree — objects/arrays are collapsible; scalars are leaves. */
function JsonTreeNode({ label, value, path, collapsed, toggle }: NodeProps) {
  const isContainer = value !== null && typeof value === 'object';

  if (!isContainer) {
    const kind = value === null ? 'null' : typeof value;
    return (
      <div class="tree-row">
        {label !== null && <span class="tree-key">{label}: </span>}
        <span class={`tree-scalar tree-scalar--${kind}`}>{JSON.stringify(value)}</span>
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries: [string, unknown][] = isArray
    ? (value as unknown[]).map((item, index) => [String(index), item])
    : Object.entries(value as Record<string, unknown>);
  const isCollapsed = collapsed.has(path);
  const summary = isArray ? `Array(${entries.length})` : `Object(${entries.length})`;

  return (
    <div class="tree-node">
      <button type="button" class="tree-toggle" onClick={() => toggle(path)} aria-expanded={!isCollapsed}>
        <span aria-hidden="true">{isCollapsed ? '▸' : '▾'}</span>
        {label !== null && <span class="tree-key">{label}: </span>}
        <span class="tree-summary">{summary}</span>
      </button>
      {!isCollapsed && (
        <div class="tree-children">
          {entries.length === 0 && <p class="tree-empty">(empty)</p>}
          {entries.map(([key, item]) => (
            <JsonTreeNode key={key} label={isArray ? null : key} value={item} path={`${path}/${key}`} collapsed={collapsed} toggle={toggle} />
          ))}
        </div>
      )}
    </div>
  );
}

interface Props {
  value: unknown;
  /** Accessible label for the scrollable tree container. */
  label?: string;
  tall?: boolean;
}

/**
 * A collapsible tree view for an arbitrary parsed JSON value, with its own per-node
 * expand/collapse state. Extracted from JSON Formatter's tree view (its second real use,
 * in the cURL Command Builder's response viewer) — this is the plain version, with no
 * search/highlight; JSON Formatter keeps that layered on top of its own copy since it's
 * the one tool that actually needs it.
 */
export function JsonTree({ value, label = 'JSON as a collapsible tree', tall = false }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (path: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div class={`tree-view output${tall ? ' output--tall' : ''}`} aria-label={label}>
      <JsonTreeNode label={null} value={value} path="$" collapsed={collapsed} toggle={toggle} />
      <style>{`
        .tree-view { overflow: auto; font-family: var(--font-mono); font-size: var(--text-sm); }
        .tree-node { display: flex; flex-direction: column; }
        .tree-toggle {
          display: flex; align-items: center; gap: .35em; background: none; border: none;
          cursor: pointer; font: inherit; color: var(--text); padding: .1rem 0; text-align: left;
        }
        .tree-toggle:hover { color: var(--accent); }
        .tree-summary { color: var(--text-subtle); }
        .tree-children {
          margin-left: .55em; padding-left: .75em; border-left: 1px dashed var(--border);
        }
        .tree-empty { margin: 0; color: var(--text-subtle); font-style: italic; padding-left: 1.2em; }
        .tree-row { padding: .1rem 0; }
        .tree-key { color: var(--accent); font-weight: 600; }
        .tree-scalar--string { color: var(--success); }
        .tree-scalar--number { color: var(--warning); }
        .tree-scalar--boolean { color: var(--accent); }
        .tree-scalar--null { color: var(--text-subtle); font-style: italic; }
      `}</style>
    </div>
  );
}
