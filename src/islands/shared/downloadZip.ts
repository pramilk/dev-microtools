import { downloadUrl } from './downloadUrl';

/**
 * Picks a filename that hasn't been used yet in this zip, appending `-1`, `-2`, ... on a
 * collision — two source files with the same base name but different original extensions
 * (`photo.png` and `photo.jpg`, both converted to the same output format) would otherwise
 * silently overwrite each other inside the archive.
 */
export function uniqueZipName(base: string, extension: string, used: Set<string>): string {
  let name = `${base}.${extension}`;
  let suffix = 1;
  while (used.has(name)) {
    name = `${base}-${suffix}.${extension}`;
    suffix += 1;
  }
  used.add(name);
  return name;
}

/**
 * Zips a set of already-produced blobs and downloads the archive — the "Download all" action
 * shared by every batch image tool. `fflate` is dynamically imported so a visitor who never
 * clicks "Download all" (or a tool with no batch mode at all) never pays for it.
 */
export async function downloadZip(entries: { name: string; blob: Blob }[], zipFilename: string): Promise<void> {
  const { zipSync } = await import('fflate');
  const files: Record<string, Uint8Array> = {};
  for (const entry of entries) {
    files[entry.name] = new Uint8Array(await entry.blob.arrayBuffer());
  }

  const zipped = zipSync(files);
  const blob = new Blob([zipped as BlobPart], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  downloadUrl(url, zipFilename);
  URL.revokeObjectURL(url);
}
