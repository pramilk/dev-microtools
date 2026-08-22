import { CopyButton } from './CopyButton';

interface Props {
  label: string;
  value: string;
  /** Shown in place of the value when there is nothing to display yet. */
  placeholder: string;
  tall?: boolean;
  describe?: string;
  /** Extra controls rendered next to the copy button. */
  actions?: preact.ComponentChildren;
}

/** Read-only result pane with a consistent empty state and copy control. */
export function OutputPane({
  label,
  value,
  placeholder,
  tall = false,
  describe = 'result',
  actions,
}: Props) {
  const isEmpty = value === '';

  return (
    <div class="field">
      <div class="field__label">
        <span>{label}</span>
        <span class="tool-bar__group">
          {actions}
          <CopyButton value={value} describe={describe} />
        </span>
      </div>
      <pre
        class={`output${tall ? ' output--tall' : ''}${isEmpty ? ' output--empty' : ''}`}
        tabIndex={0}
      >
        {isEmpty ? placeholder : value}
      </pre>
    </div>
  );
}
