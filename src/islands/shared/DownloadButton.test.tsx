import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { DownloadButton } from './DownloadButton';

describe('<DownloadButton />', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    createObjectURL = vi.fn(() => 'blob:mock-url');
    revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as typeof URL.revokeObjectURL;
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    clickSpy.mockRestore();
  });

  it('is disabled when there is nothing to download', () => {
    render(<DownloadButton value="" filename="result.txt" />);
    expect(screen.getByRole('button', { name: /download/i })).toBeDisabled();
  });

  it('creates a blob URL and triggers a download', () => {
    render(<DownloadButton value="hello" filename="result.txt" />);
    fireEvent.click(screen.getByRole('button', { name: /download/i }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const [blob] = createObjectURL.mock.calls[0] as [Blob];
    expect(blob.type).toContain('text/plain');
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('revokes the object URL after triggering the download', () => {
    render(<DownloadButton value="hello" filename="result.txt" />);
    fireEvent.click(screen.getByRole('button', { name: /download/i }));

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('uses a custom label and MIME type when given', () => {
    render(
      <DownloadButton value="{}" filename="data.json" mimeType="application/json" label="Save as JSON" />
    );
    fireEvent.click(screen.getByRole('button', { name: /save as json/i }));

    const [blob] = createObjectURL.mock.calls[0] as [Blob];
    expect(blob.type).toContain('application/json');
  });

  it('does nothing when clicked while disabled', () => {
    render(<DownloadButton value="" filename="result.txt" />);
    fireEvent.click(screen.getByRole('button', { name: /download/i }));

    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
