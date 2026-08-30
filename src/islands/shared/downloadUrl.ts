/**
 * Triggers a browser "Save As" for a URL already in hand (typically a `URL.createObjectURL`
 * result the caller made for previewing) — every image tool needs exactly this dance
 * (temporary anchor, click, remove) to turn a blob URL into a download.
 */
export function downloadUrl(url: string, filename: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
