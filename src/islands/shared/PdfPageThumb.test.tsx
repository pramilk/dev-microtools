import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
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

  it('turns the page for a pending rotation, swapping its limits on a quarter turn', () => {
    render(<PdfPageThumb pageNumber={1} src="blob:p" failed={false} onVisible={() => {}} rotation={-90} />);
    const image = screen.getByRole('img', { name: 'Page 1' });
    expect(image.style.transform).toBe('rotate(270deg)');
    expect(image).toHaveClass('pdf-thumb__sheet--quarter');
  });

  it('shows a blank sheet for an inserted blank page', () => {
    render(<PdfPageThumb pageNumber={2} src={undefined} failed={false} onVisible={() => {}} blank />);
    expect(screen.getByRole('img', { name: 'Blank page' })).toHaveClass('pdf-thumb__blank');
  });

  it('opens the full-size view from the zoom button without the click reaching the card', () => {
    const onZoom = vi.fn();
    const onCardClick = vi.fn();
    render(
      <div onClick={onCardClick}>
        <PdfPageThumb pageNumber={4} src={undefined} failed={false} onVisible={() => {}} onZoom={onZoom} />
      </div>
    );
    fireEvent.click(screen.getByRole('button', { name: 'View page 4 full size' }));
    expect(onZoom).toHaveBeenCalledTimes(1);
    expect(onCardClick).not.toHaveBeenCalled();
  });

  it('has no zoom button unless asked', () => {
    render(<PdfPageThumb pageNumber={4} src={undefined} failed={false} onVisible={() => {}} />);
    expect(screen.queryByRole('button')).toBeNull();
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
