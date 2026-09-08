import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import AsciiArtGenerator from './AsciiArtGenerator';

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

class FakeImageBitmap {
  width = 400;
  height = 200;
  close = vi.fn();
}

/**
 * Returns a left-to-right greyscale gradient rather than a flat fill, so the art actually
 * exercises the ramp — a solid colour would produce one repeated character and hide any
 * mapping bug.
 */
class FakeCanvasContext {
  canvas = document.createElement('canvas');
  imageSmoothingEnabled = false;
  imageSmoothingQuality = 'low';
  drawImage() {}
  clearRect() {}
  getImageData(_x: number, _y: number, width: number, height: number) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
      const level = width > 1 ? Math.round(((index % width) / (width - 1)) * 255) : 0;
      data[index * 4] = level;
      data[index * 4 + 1] = level;
      data[index * 4 + 2] = level;
      data[index * 4 + 3] = 255;
    }
    return { data, width, height };
  }
}

function imageFile(name = 'photo.jpg', type = 'image/jpeg'): File {
  return new File([JPEG_BYTES], name, { type });
}

/** Chooses a file through the dropzone's real file input, the way a visitor would. */
async function chooseFile(file: File): Promise<void> {
  const input = screen.getByLabelText('Choose an image to convert to ASCII art');
  fireEvent.change(input, { target: { files: [file] } });
}

const preview = () => screen.getByRole('img', { name: /ASCII art preview/i });

beforeEach(() => {
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(new FakeImageBitmap()));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    (() => new FakeCanvasContext()) as unknown as typeof HTMLCanvasElement.prototype.getContext
  );
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:fake-url'), revokeObjectURL: vi.fn() });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('AsciiArtGenerator', () => {
  it('starts with a dropzone and no output', () => {
    render(<AsciiArtGenerator />);
    expect(screen.getByLabelText('Choose an image to convert to ASCII art')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /ASCII art preview/i })).not.toBeInTheDocument();
  });

  it('converts a chosen image into ASCII art and reports the grid size', async () => {
    render(<AsciiArtGenerator />);
    await chooseFile(imageFile());

    // 400x200 at the default 100-character width is 100x25, aspect-corrected.
    expect(await screen.findByText(/400×200px/)).toBeInTheDocument();
    expect(screen.getByText(/100×25 characters/)).toBeInTheDocument();

    const art = await waitFor(() => preview());
    expect(art.textContent).toContain('█');
    expect(art.textContent!.split('\n')).toHaveLength(25);
  });

  it('maps the dark end of the gradient to the densest character and the light end to blank', async () => {
    render(<AsciiArtGenerator />);
    await chooseFile(imageFile());

    const art = await waitFor(() => preview());
    const firstLine = art.textContent!.split('\n')[0]!;
    expect(firstLine.startsWith('█')).toBe(true);
    // Trailing blanks are trimmed, so the light end of the gradient produces a short line.
    expect(firstLine.length).toBeLessThan(100);
  });

  it('enables copy and download once there is output', async () => {
    render(<AsciiArtGenerator />);
    await chooseFile(imageFile());

    await waitFor(() => preview());
    expect(screen.getByRole('button', { name: /^copy$/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /download \.txt/i })).toBeEnabled();
  });

  it('flips the tonal mapping when switching to a dark background', async () => {
    render(<AsciiArtGenerator />);
    await chooseFile(imageFile());

    const before = (await waitFor(() => preview())).textContent!.split('\n')[0]!;
    fireEvent.click(screen.getByRole('button', { name: 'Light on dark' }));

    await waitFor(() => {
      const after = preview().textContent!.split('\n')[0]!;
      // Dark-on-light starts dense at the dark end; light-on-dark starts blank there.
      expect(after.startsWith('█')).toBe(false);
      expect(after).not.toBe(before);
    });
  });

  it('re-renders with a different character set when one is chosen', async () => {
    render(<AsciiArtGenerator />);
    await chooseFile(imageFile());
    // Blocks is the default, so switching to the punctuation ramp is the real change here.
    await waitFor(() => expect(preview().textContent).toContain('█'));

    fireEvent.click(screen.getByRole('button', { name: 'Standard' }));

    await waitFor(() => expect(preview().textContent).toContain('@'));
    expect(preview().textContent).not.toContain('█');
  });

  it('changes the grid when the width slider moves', async () => {
    render(<AsciiArtGenerator />);
    await chooseFile(imageFile());
    await waitFor(() => preview());

    fireEvent.input(screen.getByLabelText('Width in characters'), { target: { value: '60' } });

    expect(await screen.findByText(/Width \(60 characters\)/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/60×15 characters/)).toBeInTheDocument());
    await waitFor(() => expect(preview().textContent!.split('\n')).toHaveLength(15));
  });

  it('lightens the art when brightness is raised', async () => {
    render(<AsciiArtGenerator />);
    await chooseFile(imageFile());
    const dense = (await waitFor(() => preview())).textContent!.replace(/[\s\n]/g, '').length;

    fireEvent.input(screen.getByLabelText('Brightness'), { target: { value: '80' } });

    await waitFor(() => expect(preview().textContent!.replace(/[\s\n]/g, '').length).toBeLessThan(dense));
  });

  it('shows a colour download and per-character colour spans in colour mode', async () => {
    render(<AsciiArtGenerator />);
    await chooseFile(imageFile());
    await waitFor(() => preview());

    fireEvent.click(screen.getByRole('button', { name: 'Colour' }));

    await waitFor(() => expect(preview().querySelectorAll('span[style*="color"]').length).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: /download \.html/i })).toBeEnabled();
  });

  it('re-converts when auto levels is switched off', async () => {
    render(<AsciiArtGenerator />);
    await chooseFile(imageFile());
    const stretched = (await waitFor(() => preview())).textContent!;

    const toggle = screen.getByLabelText(/auto levels/i);
    expect(toggle).toBeChecked();
    fireEvent.click(toggle);

    // The fake gradient already spans black to white, so the stretch is a near no-op on it;
    // what must be true either way is that the toggle is wired to the conversion and the
    // tool keeps producing art rather than blanking out.
    await waitFor(() => expect(screen.getByLabelText(/auto levels/i)).not.toBeChecked());
    expect(preview().textContent).toContain('█');
    expect(preview().textContent!.split('\n')).toHaveLength(stretched.split('\n').length);
  });

  it('seeds the custom field with plain ASCII rather than the Unicode default', async () => {
    render(<AsciiArtGenerator />);
    await chooseFile(imageFile());
    await waitFor(() => preview());

    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));

    expect(screen.getByLabelText(/Characters, lightest to darkest/)).toHaveValue(' .:-=+*#%@');
    await waitFor(() => expect(preview().textContent).toContain('@'));
  });

  it('lets a visitor type their own character set', async () => {
    render(<AsciiArtGenerator />);
    await chooseFile(imageFile());
    await waitFor(() => preview());

    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.input(screen.getByLabelText(/Characters, lightest to darkest/), { target: { value: ' oO0' } });

    await waitFor(() => expect(preview().textContent).toContain('0'));
    expect(preview().textContent).not.toContain('█');
  });

  it('shows a visible error, not a silent failure, for a one-character ramp', async () => {
    render(<AsciiArtGenerator />);
    await chooseFile(imageFile());
    await waitFor(() => preview());

    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    fireEvent.input(screen.getByLabelText(/Characters, lightest to darkest/), { target: { value: '#' } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/single character/i);
    await waitFor(() => expect(screen.queryByRole('img', { name: /ASCII art preview/i })).not.toBeInTheDocument());
  });

  it('recovers once the custom ramp is valid again', async () => {
    render(<AsciiArtGenerator />);
    await chooseFile(imageFile());
    await waitFor(() => preview());

    fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
    const field = screen.getByLabelText(/Characters, lightest to darkest/);
    fireEvent.input(field, { target: { value: '' } });
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    fireEvent.input(field, { target: { value: ' .#' } });
    await waitFor(() => expect(preview().textContent).toContain('#'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('explains why a GIF is rejected instead of silently doing nothing', async () => {
    render(<AsciiArtGenerator />);
    await chooseFile(imageFile('animation.gif', 'image/gif'));

    expect(await screen.findByRole('alert')).toHaveTextContent(/GIF isn't supported/i);
    expect(screen.queryByRole('img', { name: /ASCII art preview/i })).not.toBeInTheDocument();
  });

  it('reports an undecodable image rather than throwing', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decode failed')));
    render(<AsciiArtGenerator />);
    await chooseFile(imageFile('broken.jpg'));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Couldn't read that as an image/i);
  });

  it('reports a missing 2D canvas instead of rendering nothing', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext
    );
    render(<AsciiArtGenerator />);
    await chooseFile(imageFile());

    expect(await screen.findByRole('alert')).toHaveTextContent(/would not give the tool a 2D canvas/i);
  });

  it('loads the bundled sample image when asked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob([JPEG_BYTES], { type: 'image/jpeg' }) })
    );
    render(<AsciiArtGenerator />);

    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    expect(await screen.findByText(/logo\.png/)).toBeInTheDocument();
    await waitFor(() => expect(preview()).toBeInTheDocument());
  });

  it('reports a failed sample fetch rather than appearing to do nothing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    render(<AsciiArtGenerator />);

    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not load the sample image/i);
  });

  it('clears back to the dropzone and resets the sliders', async () => {
    render(<AsciiArtGenerator />);
    await chooseFile(imageFile());
    await waitFor(() => preview());

    fireEvent.input(screen.getByLabelText('Width in characters'), { target: { value: '150' } });
    await screen.findByText(/Width \(150 characters\)/);

    fireEvent.click(screen.getByRole('button', { name: /clear/i }));

    expect(screen.getByLabelText('Choose an image to convert to ASCII art')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /ASCII art preview/i })).not.toBeInTheDocument();

    await chooseFile(imageFile());
    expect(await screen.findByText(/Width \(100 characters\)/)).toBeInTheDocument();
  });
});
