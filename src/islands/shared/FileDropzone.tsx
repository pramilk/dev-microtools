import { useState } from 'preact/hooks';
import { formatBytes } from './formatBytes';
import { looksLikeImageFile } from '../../lib/tools/imageFile';

interface Props {
  file: File | null;
  onFileSelected: (file: File | null) => void;
  /** Accessible name for the hidden file input — should say what the file is for. */
  chooseLabel: string;
  /** Native `accept` filter, e.g. "image/*". Optional — most tools accept anything. Also enforced against a *dropped* file, unlike the native `accept` attribute (which only constrains the file-picker dialog, never drag-and-drop) — currently only "image/*" is actually checked, since that's the only value any tool passes. */
  accept?: string;
  /** Overrides the default "size" line shown once a file is chosen. */
  describeFile?: (file: File) => string;
}

/** The one drag-and-drop / choose-a-file control every file-accepting tool shares. */
export function FileDropzone({ file, onFileSelected, chooseLabel, accept, describeFile }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);

  const acceptFile = (candidate: File) => {
    if (accept === 'image/*' && !looksLikeImageFile(candidate)) {
      setRejected(`"${candidate.name}" doesn't look like an image — choose an image file instead.`);
      return;
    }
    setRejected(null);
    onFileSelected(candidate);
  };

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
        const dropped = event.dataTransfer?.files?.[0];
        if (dropped) acceptFile(dropped);
      }}
    >
      {file ? (
        <>
          <p class="dropzone__name">{file.name}</p>
          <p class="field__hint">{describeFile ? describeFile(file) : formatBytes(file.size)}</p>
          <button
            type="button"
            class="btn"
            onClick={() => {
              setRejected(null);
              onFileSelected(null);
            }}
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
              onChange={(event) => {
                const input = event.target as HTMLInputElement;
                const chosen = input.files?.[0];
                if (chosen) acceptFile(chosen);
                input.value = '';
              }}
            />
          </label>
          {rejected && (
            <p class="msg msg--error dropzone__rejected" role="alert">
              <span class="msg__icon" aria-hidden="true">
                !
              </span>
              <span>{rejected}</span>
            </p>
          )}
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
        .dropzone__rejected { margin: var(--space-2) 0 0; text-align: left; }
      `}</style>
    </div>
  );
}
