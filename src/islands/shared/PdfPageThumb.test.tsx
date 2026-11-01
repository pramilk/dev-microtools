import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { PdfPageThumb } from './PdfPageThumb';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('<PdfPageThumb />', () => {
  it('shows the page number until the image is ready, then the image', () => {
    const { rerender, container } = render(<PdfPageThumb pageNumber={3} src={undefined} failed={false} onVisible={() => {}} />);
    expect(container.querySelector('.pdf-thumb__placeholder')).toHaveTextContent('3');
    expect(screen.queryByRole('img')).toBeNull();

    rerender(<PdfPageThumb pageNumber={3} src="blob:page-3" failed={false} onVisible={() => {}} />);
    expect(screen.getByRole('img', { name: 'Page 3' })).toHaveAttribute('src', 'blob:page-3');
  });

  it('shows a marked placeholder for a page that couldn’t be drawn', () => {
    const { container } = render(<PdfPageThumb pageNumber={2} src={undefined} failed onVisible={() => {}} />);
    const placeholder = container.querySelector('.pdf-thumb__placeholder');
    expect(placeholder).toHaveTextContent('?');
    expect(placeholder).toHaveAttribute('title', expect.stringMatching(/couldn’t be drawn/));
  });

  it('renders its children and the muted state', () => {
    const { container } = render(
      <PdfPageThumb pageNumber={1} src={undefined} failed={false} onVisible={() => {}} muted>
        <span>File 2</span>
      </PdfPageThumb>
    );
    expect(screen.getByText('File 2')).toBeInTheDocument();
    expect(container.firstElementChild?.className).toContain('pdf-thumb--muted');
  });

  it('asks to be drawn straight away when IntersectionObserver isn’t available', () => {
    const onVisible = vi.fn();
    render(<PdfPageThumb pageNumber={1} src={undefined} failed={false} onVisible={onVisible} />);
    expect(onVisible).toHaveBeenCalledTimes(1);
  });

  it('asks to be drawn only once it nears the viewport, and only once', () => {
    let callback: (entries: { isIntersecting: boolean }[]) => void = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: typeof callback) {
          callback = cb;
        }
        observe() {}
        disconnect = disconnect;
      }
    );
    const onVisible = vi.fn();
    render(<PdfPageThumb pageNumber={1} src={undefined} failed={false} onVisible={onVisible} />);
    expect(onVisible).not.toHaveBeenCalled();
    callback([{ isIntersecting: false }]);
    expect(onVisible).not.toHaveBeenCalled();
    callback([{ isIntersecting: true }]);
    expect(onVisible).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalled();
  });
});
