import { useState } from 'preact/hooks';
import { formatBytes } from './formatBytes';

interface Props {
  file: File | null;
  onFileSelected: (file: File | null) => void;
  /** Accessible name for the hidden file input — should say what the file is for. */
  chooseLabel: string;
  /** Native `accept` filter, e.g. "image/*". Optional — most tools accept anything. */
  accept?: string;
  /** Overrides the default "size" line shown once a file is chosen. */
  describeFile?: (file: File) => string;
}

/** The one drag-and-drop / choose-a-file control every file-accepting tool shares. */
export function FileDropzone({ file, onFileSelected, chooseLabel, accept, describeFile }: Props) {
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      class={`dropzone${dragOver ? ' dropzone--active' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        const dropped = event.dataTransfer?.files?.[0] ?? null;
        if (dropped) onFileSelected(dropped);
      }}
    >
      {file ? (
        <>
          <p class="dropzone__name">{file.name}</p>
          <p class="field__hint">{describeFile ? describeFile(file) : formatBytes(file.size)}</p>
          <button
            type="button"
            class="btn"
            onClick={() => onFileSelected(null)}
            title="Remove this file and choose another"
          >
            Remove
          </button>
        </>
      ) : (
        <>
          <p>Drag a file here, or</p>
          <label class="btn">
            Choose file
            <input
              type="file"
              class="sr-only"
              accept={accept}
              aria-label={chooseLabel}
              onChange={(event) => onFileSelected((event.target as HTMLInputElement).files?.[0] ?? null)}
            />
          </label>
        </>
      )}

      <style>{`
        .dropzone {
          border: 2px dashed var(--border-strong); border-radius: var(--radius-lg);
          padding: var(--space-6) var(--space-4); text-align: center;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: var(--space-2); color: var(--text-muted); background: var(--surface);
          min-height: 10rem;
        }
        .dropzone--active { border-color: var(--accent); background: var(--accent-subtle); }
        .dropzone__name { font-family: var(--font-mono); color: var(--text); font-weight: 600; margin: 0; }
      `}</style>
    </div>
  );
}
