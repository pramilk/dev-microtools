import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { PdfPageViewer } from './PdfPageViewer';

beforeEach(() => {
  let next = 0;
  URL.createObjectURL = vi.fn(() => `blob:large-${(next += 1)}`);
  URL.revokeObjectURL = vi.fn();
});

const props = (overrides: Partial<Parameters<typeof PdfPageViewer>[0]> = {}) => ({
  title: 'Page 2 of 5',
  pageKey: '0:1',
  load: vi.fn(async () => new Blob(['page'])),
  onClose: vi.fn(),
  ...overrides,
});

describe('<PdfPageViewer />', () => {
  it('shows a loading state, then the page drawn large', async () => {
    const options = props();
    render(<PdfPageViewer {...options} />);
    expect(screen.getByRole('status')).toHaveTextContent(/drawing the page/i);
    expect(await screen.findByRole('img', { name: 'Page 2 of 5' })).toHaveAttribute('src', 'blob:large-1');
    expect(options.load).toHaveBeenCalledTimes(1);
  });

  it('loads the new page when the key changes, releasing the old image', async () => {
    const options = props();
    const { rerender } = render(<PdfPageViewer {...options} />);
    await screen.findByRole('img');
    rerender(<PdfPageViewer {...options} pageKey="0:2" title="Page 3 of 5" />);
    expect(await screen.findByRole('img', { name: 'Page 3 of 5' })).toHaveAttribute('src', 'blob:large-2');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:large-1');
  });

  it('explains a page that can’t be drawn', async () => {
    render(<PdfPageViewer {...props({ load: async () => Promise.reject(new Error('bad stream')) })} />);
    expect(await screen.findByText(/couldn’t be drawn \(bad stream\)/)).toBeInTheDocument();
  });

  it('steps with the buttons and arrow keys, and disables what isn’t there', async () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    render(<PdfPageViewer {...props({ onNext })} />);
    await screen.findByRole('img');
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    const dialog = document.querySelector('dialog');
    if (!dialog) throw new Error('no dialog');
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    expect(onNext).toHaveBeenCalledTimes(2);
    expect(onPrevious).not.toHaveBeenCalled();
  });

  it('closes from the button, Esc, and a backdrop click', async () => {
    const options = props();
    render(<PdfPageViewer {...options} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    const dialog = document.querySelector('dialog');
    if (!dialog) throw new Error('no dialog');
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    fireEvent.click(dialog);
    await waitFor(() => expect(options.onClose).toHaveBeenCalledTimes(3));
  });

  it('turns the page with a pending rotation', async () => {
    render(<PdfPageViewer {...props({ rotation: 90 })} />);
    const image = await screen.findByRole('img');
    expect(image).toHaveClass('pdf-viewer__img--quarter');
    expect(image.style.transform).toBe('rotate(90deg)');
  });
});
