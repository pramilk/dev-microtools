interface Props {
  /** Text to save. Empty disables the button. */
  value: string;
  /** Filename offered to the user, including extension. */
  filename: string;
  mimeType?: string;
  label?: string;
  describe?: string;
}

/** The single "save as a file" control used by every tool that produces one. */
export function DownloadButton({
  value,
  filename,
  mimeType = 'text/plain',
  label = 'Download',
  describe = 'result',
}: Props) {
  const disabled = value === '';

  const download = () => {
    if (disabled) return;

    const blob = new Blob([value], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <button
      type="button"
      class="btn"
      onClick={download}
      disabled={disabled}
      title={disabled ? 'Nothing to download yet' : `Save ${describe} as ${filename}`}
    >
      <span aria-hidden="true">⭳</span> {label}
    </button>
  );
}
