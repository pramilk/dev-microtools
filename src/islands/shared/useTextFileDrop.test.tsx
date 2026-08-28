import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { useTextFileDrop } from './useTextFileDrop';

/** A minimal host for the hook — the shape every tool using it actually renders. */
function Host({ onText }: { onText: (text: string) => void }) {
  const drop = useTextFileDrop(onText);
  return (
    <textarea
      aria-label="Input"
      class={drop.isDragActive ? 'textarea textarea--drag-active' : 'textarea'}
      {...drop.dropHandlers}
    />
  );
}

const textarea = () => screen.getByLabelText('Input');

describe('useTextFileDrop', () => {
  it('starts inactive', () => {
    render(<Host onText={() => {}} />);
    expect(textarea().className).not.toContain('drag-active');
  });

  it('marks itself active while a file is dragged over it', () => {
    render(<Host onText={() => {}} />);

    fireEvent.dragOver(textarea());
    expect(textarea().className).toContain('drag-active');

    fireEvent.dragLeave(textarea());
    expect(textarea().className).not.toContain('drag-active');
  });

  it('reads a dropped file as text and reports it', async () => {
    const onText = vi.fn();
    render(<Host onText={onText} />);

    const file = new File(['line one\nline two'], 'notes.txt', { type: 'text/plain' });
    fireEvent.drop(textarea(), { dataTransfer: { files: [file] } });

    await waitFor(() => expect(onText).toHaveBeenCalledWith('line one\nline two'));
  });

  it('clears the active state after a drop', async () => {
    render(<Host onText={() => {}} />);
    fireEvent.dragOver(textarea());

    fireEvent.drop(textarea(), {
      dataTransfer: { files: [new File(['x'], 'a.txt', { type: 'text/plain' })] },
    });

    await waitFor(() => expect(textarea().className).not.toContain('drag-active'));
  });

  it('reads only the first file when several are dropped', async () => {
    // The hook fills a single text field, so a multi-file drop has to pick one rather
    // than concatenating or silently doing nothing.
    const onText = vi.fn();
    render(<Host onText={onText} />);

    fireEvent.drop(textarea(), {
      dataTransfer: {
        files: [
          new File(['first'], 'a.txt', { type: 'text/plain' }),
          new File(['second'], 'b.txt', { type: 'text/plain' }),
        ],
      },
    });

    await waitFor(() => expect(onText).toHaveBeenCalledTimes(1));
    expect(onText).toHaveBeenCalledWith('first');
  });

  it('ignores a drop carrying no files, e.g. dragged text', async () => {
    const onText = vi.fn();
    render(<Host onText={onText} />);

    fireEvent.drop(textarea(), { dataTransfer: { files: [] } });
    fireEvent.drop(textarea(), { dataTransfer: undefined });

    await waitFor(() => expect(textarea().className).not.toContain('drag-active'));
    expect(onText).not.toHaveBeenCalled();
  });

  it('reads an empty file as an empty string rather than skipping it', async () => {
    const onText = vi.fn();
    render(<Host onText={onText} />);

    fireEvent.drop(textarea(), {
      dataTransfer: { files: [new File([], 'empty.txt', { type: 'text/plain' })] },
    });

    await waitFor(() => expect(onText).toHaveBeenCalledWith(''));
  });

  it('decodes UTF-8 content correctly', async () => {
    const onText = vi.fn();
    render(<Host onText={onText} />);

    fireEvent.drop(textarea(), {
      dataTransfer: { files: [new File(['日本語 😀 café'], 'utf8.txt', { type: 'text/plain' })] },
    });

    await waitFor(() => expect(onText).toHaveBeenCalledWith('日本語 😀 café'));
  });
});
