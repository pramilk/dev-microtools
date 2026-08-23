import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { FileDropzone } from './FileDropzone';

describe('<FileDropzone />', () => {
  it('shows a prompt and a choose-file control when empty', () => {
    render(<FileDropzone file={null} onFileSelected={() => {}} chooseLabel="Choose a file" />);
    expect(screen.getByText(/drag a file here/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Choose a file')).toBeInTheDocument();
  });

  it('reports a chosen file through the input', () => {
    const onFileSelected = vi.fn();
    render(<FileDropzone file={null} onFileSelected={onFileSelected} chooseLabel="Choose a file" />);

    const file = new File(['abc'], 'test.txt', { type: 'text/plain' });
    const input = screen.getByLabelText('Choose a file') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    expect(onFileSelected).toHaveBeenCalledWith(file);
  });

  it('shows the file name and default byte-size description once a file is chosen', () => {
    const file = new File(['abc'], 'test.txt', { type: 'text/plain' });
    render(<FileDropzone file={file} onFileSelected={() => {}} chooseLabel="Choose a file" />);

    expect(screen.getByText('test.txt')).toBeInTheDocument();
    expect(screen.getByText('3 B')).toBeInTheDocument();
  });

  it('uses a custom description when one is supplied', () => {
    const file = new File(['abc'], 'test.txt', { type: 'text/plain' });
    render(
      <FileDropzone
        file={file}
        onFileSelected={() => {}}
        chooseLabel="Choose a file"
        describeFile={(f) => `custom: ${f.type}`}
      />
    );

    expect(screen.getByText('custom: text/plain')).toBeInTheDocument();
  });

  it('reports removal when Remove is clicked', () => {
    const onFileSelected = vi.fn();
    const file = new File(['abc'], 'test.txt', { type: 'text/plain' });
    render(<FileDropzone file={file} onFileSelected={onFileSelected} chooseLabel="Choose a file" />);

    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(onFileSelected).toHaveBeenCalledWith(null);
  });

  it('reports a dropped file', () => {
    const onFileSelected = vi.fn();
    render(<FileDropzone file={null} onFileSelected={onFileSelected} chooseLabel="Choose a file" />);

    const file = new File(['abc'], 'dropped.txt', { type: 'text/plain' });
    fireEvent.drop(screen.getByText(/drag a file here/i).parentElement!, {
      dataTransfer: { files: [file] },
    });

    expect(onFileSelected).toHaveBeenCalledWith(file);
  });
});
