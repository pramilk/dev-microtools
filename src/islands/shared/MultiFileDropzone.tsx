import { useState } from 'preact/hooks';

interface Props {
  onFilesSelected: (files: File[]) => void;
  /** How many more files the batch can currently take — drives the hint text, since a flat
   *  "up to N" reads as wrong once some files are already added. */
  roomRemaining: number;
  maxFiles: number;
  /** Accessible name for the hidden multi-file input — should say what the files are for. */
  chooseLabel: string;
  /** Native `accept` filter, e.g. "image/*". Passed straight through to the file input. */
  accept?: string;
}

/**
 * A drop zone that accepts one or many files at once — unlike the shared single-file
 * `FileDropzone`, which every non-batch file-based tool here uses.
 */
export function MultiFileDropzone({ onFilesSelected, roomRemaining, maxFiles, chooseLabel, accept }: Props) {
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
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length > 0) onFilesSelected(files);
      }}
    >
      <p>
        {roomRemaining === maxFiles
          ? `Drag one or more images here (up to ${maxFiles} at once), or`
          : roomRemaining > 0
            ? `Drag more images here (${roomRemaining} more allowed), or`
            : `Batch is full (${maxFiles} max) — remove one to add another, or`}
      </p>
      <label class="btn">
        Choose images
        <input
          type="file"
          class="sr-only"
          accept={accept}
          multiple
          aria-label={chooseLabel}
          onChange={(event) => {
            const input = event.target as HTMLInputElement;
            const files = Array.from(input.files ?? []);
            if (files.length > 0) onFilesSelected(files);
            input.value = '';
          }}
        />
      </label>

      <style>{`
        .dropzone {
          border: 2px dashed var(--border-strong); border-radius: var(--radius-lg);
          padding: var(--space-6) var(--space-4); text-align: center;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: var(--space-2); color: var(--text-muted); background: var(--surface);
          min-height: 8rem;
        }
        .dropzone--active { border-color: var(--accent); background: var(--accent-subtle); }
      `}</style>
    </div>
  );
}
