import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { MultiFileDropzone } from './MultiFileDropzone';

const image = (name: string) => new File(['x'], name, { type: 'image/png' });

const zone = () => document.querySelector('.dropzone')!;

function renderZone(overrides: Partial<Parameters<typeof MultiFileDropzone>[0]> = {}) {
  const onFilesSelected = vi.fn();
  render(
    <MultiFileDropzone
      onFilesSelected={onFilesSelected}
      roomRemaining={10}
      maxFiles={10}
      chooseLabel="Choose images to compress"
      {...overrides}
    />
  );
  return { onFilesSelected };
}

describe('<MultiFileDropzone />', () => {
  it('invites a first drop when the batch is untouched', () => {
    renderZone();
    expect(screen.getByText(/drag one or more images here \(up to 10 at once\)/i)).toBeInTheDocument();
  });

  it('says how much room is left once the batch is partly full', () => {
    // A flat "up to 10" would read as wrong to someone who has already added seven.
    renderZone({ roomRemaining: 3 });
    expect(screen.getByText(/drag more images here \(3 more allowed\)/i)).toBeInTheDocument();
  });

  it('explains what to do when the batch is full', () => {
    renderZone({ roomRemaining: 0 });
    expect(screen.getByText(/batch is full \(10 max\) — remove one to add another/i)).toBeInTheDocument();
  });

  it('reports every file chosen through the input at once', () => {
    const { onFilesSelected } = renderZone();
    const input = screen.getByLabelText('Choose images to compress') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [image('a.png'), image('b.png')] } });

    expect(onFilesSelected).toHaveBeenCalledTimes(1);
    expect(onFilesSelected.mock.calls[0]![0].map((file: File) => file.name)).toEqual(['a.png', 'b.png']);
  });

  it('resets the input so the same file can be chosen twice in a row', () => {
    const { onFilesSelected } = renderZone();
    const input = screen.getByLabelText('Choose images to compress') as HTMLInputElement;

    fireEvent.change(input, { target: { files: [image('a.png')] } });
    expect(input.value).toBe('');
    expect(onFilesSelected).toHaveBeenCalledTimes(1);
  });

  it('ignores an empty selection, e.g. a cancelled file dialog', () => {
    const { onFilesSelected } = renderZone();
    fireEvent.change(screen.getByLabelText('Choose images to compress'), { target: { files: [] } });
    expect(onFilesSelected).not.toHaveBeenCalled();
  });

  it('reports dropped files', () => {
    const { onFilesSelected } = renderZone();
    fireEvent.drop(zone(), { dataTransfer: { files: [image('dropped.png')] } });

    expect(onFilesSelected).toHaveBeenCalledTimes(1);
    expect(onFilesSelected.mock.calls[0]![0].map((file: File) => file.name)).toEqual(['dropped.png']);
  });

  it('ignores a drop carrying no files, such as dragged text', () => {
    const { onFilesSelected } = renderZone();
    fireEvent.drop(zone(), { dataTransfer: { files: [] } });
    expect(onFilesSelected).not.toHaveBeenCalled();
  });

  it('highlights while a drag is over it and stops on leave', () => {
    renderZone();
    expect(zone().className).not.toContain('dropzone--active');

    fireEvent.dragOver(zone());
    expect(zone().className).toContain('dropzone--active');

    fireEvent.dragLeave(zone());
    expect(zone().className).not.toContain('dropzone--active');
  });

  it('clears the highlight after a drop', () => {
    renderZone();
    fireEvent.dragOver(zone());
    fireEvent.drop(zone(), { dataTransfer: { files: [image('a.png')] } });
    expect(zone().className).not.toContain('dropzone--active');
  });

  it('passes the accept filter to the file input', () => {
    renderZone({ accept: 'image/*' });
    expect(screen.getByLabelText('Choose images to compress')).toHaveAttribute('accept', 'image/*');
  });
});
