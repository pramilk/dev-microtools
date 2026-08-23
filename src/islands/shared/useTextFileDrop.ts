import { useState } from 'preact/hooks';

/**
 * Lets a plain-text input (a `<textarea>`) accept a dropped file directly, instead of
 * requiring a separate upload control. Reads the file as UTF-8 text — only suitable for
 * tools that already treat their input as text; a tool that needs the raw bytes (hashing,
 * base64 of binary data) must keep using `FileDropzone` instead.
 */
export function useTextFileDrop(onText: (text: string) => void) {
  const [isDragActive, setIsDragActive] = useState(false);

  return {
    isDragActive,
    dropHandlers: {
      onDragOver: (event: DragEvent) => {
        event.preventDefault();
        setIsDragActive(true);
      },
      onDragLeave: () => setIsDragActive(false),
      onDrop: (event: DragEvent) => {
        event.preventDefault();
        setIsDragActive(false);
        const dropped = event.dataTransfer?.files?.[0];
        if (!dropped) return;
        void dropped.text().then(onText);
      },
    },
  };
}
