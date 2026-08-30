interface Props {
  enabled: boolean;
  onToggleEnabled: (enabled: boolean) => void;
  /** Kept as raw strings (not numbers) so an in-progress edit like "" or "12." round-trips through the field without the caller reformatting it mid-keystroke. */
  width: string;
  height: string;
  lockAspectRatio: boolean;
  /** The aspect ratio a locked pair snaps to when only one field changes, and the default both fields are pre-filled with the first time "Resize output" is turned on — typically the current crop/source rectangle's own size. */
  sourceWidth: number;
  sourceHeight: number;
  onChange: (next: { width: string; height: string; lockAspectRatio: boolean }) => void;
}

/**
 * Width/height output-size controls with an aspect-ratio lock, shared by any image tool that
 * offers a resize step (Image Cropper today; the planned standalone Image Resizer). Reports
 * its full next state on every change rather than individual setters, so the caller can just
 * hold `{ width, height, lockAspectRatio }` as one piece of state.
 */
export function ResizeFields({ enabled, onToggleEnabled, width, height, lockAspectRatio, sourceWidth, sourceHeight, onChange }: Props) {
  const toggleEnabled = (checked: boolean) => {
    onToggleEnabled(checked);
    if (checked && width.trim() === '' && height.trim() === '') {
      onChange({ width: String(sourceWidth), height: String(sourceHeight), lockAspectRatio });
    }
  };

  const updateWidth = (raw: string) => {
    if (!lockAspectRatio) {
      onChange({ width: raw, height, lockAspectRatio });
      return;
    }
    if (raw.trim() === '') {
      onChange({ width: raw, height: '', lockAspectRatio });
      return;
    }
    const value = Number(raw);
    onChange(
      Number.isFinite(value) && value > 0
        ? { width: raw, height: String(Math.max(1, Math.round((value * sourceHeight) / sourceWidth))), lockAspectRatio }
        : { width: raw, height, lockAspectRatio }
    );
  };

  const updateHeight = (raw: string) => {
    if (!lockAspectRatio) {
      onChange({ width, height: raw, lockAspectRatio });
      return;
    }
    if (raw.trim() === '') {
      onChange({ width: '', height: raw, lockAspectRatio });
      return;
    }
    const value = Number(raw);
    onChange(
      Number.isFinite(value) && value > 0
        ? { width: String(Math.max(1, Math.round((value * sourceWidth) / sourceHeight))), height: raw, lockAspectRatio }
        : { width, height: raw, lockAspectRatio }
    );
  };

  const toggleLock = (checked: boolean) => {
    if (!checked || width.trim() === '') {
      onChange({ width, height, lockAspectRatio: checked });
      return;
    }
    const value = Number(width);
    onChange(
      Number.isFinite(value) && value > 0
        ? { width, height: String(Math.max(1, Math.round((value * sourceHeight) / sourceWidth))), lockAspectRatio: checked }
        : { width, height, lockAspectRatio: checked }
    );
  };

  return (
    <div class="resize-fields">
      <label class="checkbox">
        <input type="checkbox" checked={enabled} onChange={(e) => toggleEnabled((e.target as HTMLInputElement).checked)} />
        <span>Resize output</span>
      </label>
      {enabled && (
        <>
          <div class="resize-fields__grid">
            <label class="control">
              <span class="field__hint">Width (px)</span>
              <input
                type="number"
                class="input"
                min="1"
                value={width}
                placeholder={String(Math.round(sourceWidth))}
                onInput={(e) => updateWidth((e.target as HTMLInputElement).value)}
              />
            </label>
            <label class="control">
              <span class="field__hint">Height (px)</span>
              <input
                type="number"
                class="input"
                min="1"
                value={height}
                placeholder={String(Math.round(sourceHeight))}
                onInput={(e) => updateHeight((e.target as HTMLInputElement).value)}
              />
            </label>
          </div>
          <label class="checkbox">
            <input type="checkbox" checked={lockAspectRatio} onChange={(e) => toggleLock((e.target as HTMLInputElement).checked)} />
            <span>Lock aspect ratio</span>
          </label>
        </>
      )}
      <style>{`
        .resize-fields { display: flex; flex-direction: column; gap: var(--space-2); }
        .resize-fields__grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-2); }
      `}</style>
    </div>
  );
}
