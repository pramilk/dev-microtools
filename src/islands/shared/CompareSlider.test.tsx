import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { CompareSlider } from './CompareSlider';

const stage = () => document.querySelector('.compare__stage') as HTMLElement;
const divider = () => document.querySelector('.compare__divider') as HTMLElement;
const range = () => screen.getByRole('slider') as HTMLInputElement;

/** jsdom gives every element a zero-size rect, so the stage's geometry is stubbed. */
function stubStageRect(left = 0, width = 200) {
  vi.spyOn(stage(), 'getBoundingClientRect').mockReturnValue({
    left,
    width,
    top: 0,
    height: 100,
    right: left + width,
    bottom: 100,
    x: left,
    y: 0,
    toJSON: () => ({}),
  });
}

const props = { beforeUrl: 'blob:before', afterUrl: 'blob:after' };

/**
 * The current zoom level, read from the zoom-in button's tooltip.
 *
 * The stage's own inline `style` is not usable for this: jsdom's CSS parser evaluates
 * and rewrites `calc()`, so the `* zoom` factor is folded away before it can be read
 * back. The tooltip states the same number, and it is what the user actually sees.
 */
const zoomPercent = () => screen.getByRole('button', { name: 'Zoom in' }).getAttribute('title');

describe('<CompareSlider />', () => {
  it('shows both images with their labels', () => {
    render(<CompareSlider {...props} />);

    expect(screen.getByAltText('Original')).toHaveAttribute('src', 'blob:before');
    expect(screen.getByAltText('Compressed')).toHaveAttribute('src', 'blob:after');
  });

  it('uses custom labels when given', () => {
    render(<CompareSlider {...props} beforeLabel="Source" afterLabel="Optimised" />);

    expect(screen.getByAltText('Source')).toBeInTheDocument();
    expect(screen.getByAltText('Optimised')).toBeInTheDocument();
  });

  it('starts split down the middle', () => {
    render(<CompareSlider {...props} />);

    expect(range().value).toBe('50');
    expect(divider().style.left).toBe('50%');
  });

  it('exposes a labelled range input so the comparison is keyboard operable', () => {
    render(<CompareSlider {...props} beforeLabel="Original" afterLabel="Compressed" />);

    const slider = range();
    expect(slider).toHaveAccessibleName('Slide to compare the original and compressed image');
    // Visually hidden rather than removed — the drag gesture is the visible affordance.
    expect(slider.className).toContain('sr-only');
  });

  it('moves the split when the range input changes', () => {
    render(<CompareSlider {...props} />);
    fireEvent.input(range(), { target: { value: '80' } });

    expect(divider().style.left).toBe('80%');
  });

  it('moves the split to where the pointer went down on the image', () => {
    render(<CompareSlider {...props} />);
    stubStageRect(0, 200);

    fireEvent.pointerDown(stage(), { clientX: 50, pointerId: 1 });
    expect(divider().style.left).toBe('25%');
  });

  it('follows a drag only while the primary button is held', () => {
    render(<CompareSlider {...props} />);
    stubStageRect(0, 200);

    fireEvent.pointerMove(stage(), { clientX: 150, buttons: 0 });
    expect(divider().style.left).toBe('50%');

    fireEvent.pointerMove(stage(), { clientX: 150, buttons: 1 });
    expect(divider().style.left).toBe('75%');
  });

  it('clamps a drag past either edge instead of going out of range', () => {
    render(<CompareSlider {...props} />);
    stubStageRect(0, 200);

    fireEvent.pointerDown(stage(), { clientX: -500, pointerId: 1 });
    expect(divider().style.left).toBe('0%');

    fireEvent.pointerDown(stage(), { clientX: 5000, pointerId: 1 });
    expect(divider().style.left).toBe('100%');
  });

  it('accounts for the stage not starting at the viewport edge', () => {
    render(<CompareSlider {...props} />);
    stubStageRect(100, 200);

    fireEvent.pointerDown(stage(), { clientX: 150, pointerId: 1 });
    expect(divider().style.left).toBe('25%');
  });

  it('ignores a pointer event on a zero-width stage rather than dividing by zero', () => {
    render(<CompareSlider {...props} />);
    stubStageRect(0, 0);

    fireEvent.pointerDown(stage(), { clientX: 10, pointerId: 1 });
    expect(divider().style.left).toBe('50%');
  });

  it('sizes the stage to the image aspect ratio when dimensions are known', () => {
    render(<CompareSlider {...props} width={800} height={400} />);
    expect(stage().style.aspectRatio).toBe('800/400');
  });

  it('falls back to a fixed height when dimensions are unknown, e.g. vector content', () => {
    render(<CompareSlider {...props} />);

    expect(stage().style.aspectRatio).toBe('');
    expect(stage().style.height).not.toBe('');
    expect(stage().style.width).toBe('100%');
  });

  it('zooms in and out within bounds, disabling each button at its limit', () => {
    render(<CompareSlider {...props} width={800} height={400} />);
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' });
    const zoomOut = screen.getByRole('button', { name: 'Zoom out' });

    // Starts at 100%, with room to zoom out further down to 33%.
    expect(zoomPercent()).toContain('(100%)');
    expect(zoomOut).toBeEnabled();

    fireEvent.click(zoomIn);
    expect(zoomPercent()).toContain('(150%)');

    for (let i = 0; i < 10; i += 1) fireEvent.click(zoomIn);
    expect(zoomPercent()).toContain('(400%)');
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();

    fireEvent.click(zoomOut);
    expect(zoomPercent()).toContain('(350%)');

    for (let i = 0; i < 10; i += 1) fireEvent.click(zoomOut);
    expect(zoomPercent()).toContain('(33%)');
    expect(zoomOut).toBeDisabled();
  });

  it('starts at a given initial zoom instead of always fitting the box at 100%', () => {
    render(<CompareSlider {...props} width={800} height={400} initialZoom={2} />);
    expect(zoomPercent()).toContain('(200%)');
  });

  it('clamps an out-of-range initial zoom to the same bounds as the zoom buttons', () => {
    const { rerender } = render(<CompareSlider {...props} width={800} height={400} initialZoom={10} />);
    expect(zoomPercent()).toContain('(400%)');

    rerender(<CompareSlider {...props} width={800} height={400} initialZoom={0.01} />);
    expect(zoomPercent()).toContain('(33%)');
  });

  it('re-applies the initial zoom when it changes even though beforeUrl did not, e.g. Image Upscaler switching multipliers', () => {
    const { rerender } = render(<CompareSlider {...props} width={800} height={400} initialZoom={1} />);
    expect(zoomPercent()).toContain('(100%)');

    rerender(<CompareSlider {...props} width={800} height={400} initialZoom={4} />);
    expect(zoomPercent()).toContain('(400%)');
  });

  it('resets the zoom when a new pair of images is compared', () => {
    // Carrying a 4x zoom over to whatever the user compares next would be a surprise.
    const { rerender } = render(<CompareSlider {...props} width={800} height={400} />);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(zoomPercent()).toContain('(150%)');

    rerender(<CompareSlider beforeUrl="blob:before2" afterUrl="blob:after2" width={800} height={400} />);
    expect(zoomPercent()).toContain('(100%)');
  });

  it('keeps the zoom level when only the result changes, e.g. a quality/setting tweak re-exporting the same file', () => {
    // Every caller re-derives `afterUrl` from the same source on every settings change
    // (quality, format, crop, blur radius, …), producing a fresh blob URL each time even
    // though it's still the same comparison — this used to wipe out the user's zoom on
    // every such tweak, which is the bug this test guards against.
    const { rerender } = render(<CompareSlider {...props} width={800} height={400} />);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(zoomPercent()).toContain('(150%)');

    rerender(<CompareSlider {...props} afterUrl="blob:after2" width={800} height={400} />);
    expect(zoomPercent()).toContain('(150%)');
  });

  it('zooms on Ctrl+scroll but leaves a plain scroll alone to pan', () => {
    render(<CompareSlider {...props} width={800} height={400} />);
    const scroller = document.querySelector('.compare__scroll')!;

    fireEvent.wheel(scroller, { deltaY: -100, ctrlKey: false });
    expect(zoomPercent()).toContain('(100%)');

    fireEvent.wheel(scroller, { deltaY: -100, ctrlKey: true });
    expect(zoomPercent()).toContain('(110%)');
  });

  it('clamps Ctrl+scroll zoom-out at 33%', () => {
    render(<CompareSlider {...props} width={800} height={400} />);
    const scroller = document.querySelector('.compare__scroll')!;

    for (let i = 0; i < 10; i += 1) fireEvent.wheel(scroller, { deltaY: 100, ctrlKey: true });
    expect(zoomPercent()).toContain('(33%)');
  });

  it('drags the image to pan once zoomed in, instead of moving the split', () => {
    render(<CompareSlider {...props} width={800} height={400} />);
    stubStageRect(0, 200);
    const scroller = document.querySelector('.compare__scroll') as HTMLElement;
    // jsdom never actually lays out content, so scrollWidth/clientWidth stay 0/0 unless
    // stubbed — this simulates the zoomed content actually overflowing the visible box.
    Object.defineProperty(scroller, 'scrollWidth', { value: 400, configurable: true });
    Object.defineProperty(scroller, 'clientWidth', { value: 200, configurable: true });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));

    scroller.scrollLeft = 10;
    scroller.scrollTop = 5;

    fireEvent.pointerDown(stage(), { clientX: 100, clientY: 50, pointerId: 1 });
    expect(divider().style.left).toBe('50%');
    expect(stage().className).toContain('compare__stage--panning');

    fireEvent.pointerMove(stage(), { clientX: 70, clientY: 40, buttons: 1 });
    expect(divider().style.left).toBe('50%');
    expect(scroller.scrollLeft).toBe(40);
    expect(scroller.scrollTop).toBe(15);

    fireEvent.pointerUp(stage());
    expect(stage().className).not.toContain('compare__stage--panning');
  });

  it('still moves the split by dragging the round handle, even while zoomed in', () => {
    render(<CompareSlider {...props} width={800} height={400} />);
    stubStageRect(0, 200);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));

    const handle = document.querySelector('.compare__handle') as HTMLElement;
    fireEvent.pointerDown(handle, { clientX: 150, pointerId: 1 });
    expect(divider().style.left).toBe('75%');
    expect(stage().className).not.toContain('compare__stage--panning');

    fireEvent.pointerMove(handle, { clientX: 20, buttons: 1 });
    expect(divider().style.left).toBe('10%');
  });

  it('does not pan when zoomed in but the content still fits with no overflow to scroll', () => {
    render(<CompareSlider {...props} width={800} height={400} />);
    stubStageRect(0, 200);
    // scrollWidth/clientWidth are left at jsdom's default (both 0, i.e. no overflow) —
    // simulating a zoomed image that still fits a generous viewport with no scrollbar.
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));

    fireEvent.pointerDown(stage(), { clientX: 150, pointerId: 1 });
    expect(divider().style.left).toBe('75%');
    expect(stage().className).not.toContain('compare__stage--panning');
    expect(stage().className).not.toContain('compare__stage--zoomed');
  });

  it('drags anywhere on the image to move the split while not zoomed in', () => {
    render(<CompareSlider {...props} width={800} height={400} />);
    stubStageRect(0, 200);

    fireEvent.pointerDown(stage(), { clientX: 150, pointerId: 1 });
    expect(divider().style.left).toBe('75%');
    expect(stage().className).not.toContain('compare__stage--panning');
  });

  it('shows the checkerboard only when the content may be transparent', () => {
    const { rerender } = render(<CompareSlider {...props} />);
    expect(stage().className).not.toContain('checkerboard');

    rerender(<CompareSlider {...props} transparent />);
    expect(stage().className).toContain('checkerboard');
  });

  it('leaves the before image at the browser default rendering unless asked for pixelated', () => {
    render(<CompareSlider {...props} />);
    expect(screen.getByAltText('Original')).not.toHaveAttribute('style');
  });

  it('forces the before image to render pixelated when asked, for an honest naive-stretch baseline', () => {
    render(<CompareSlider {...props} beforeImageRendering="pixelated" />);
    expect(screen.getByAltText('Original')).toHaveStyle('image-rendering: pixelated');
    // The after image (the real result) is never affected by this — only the "before"
    // naive-stretch baseline should look deliberately unsmoothed.
    expect(screen.getByAltText('Compressed')).not.toHaveAttribute('style');
  });

  it('keeps the on-image captions out of the accessibility tree', () => {
    // They duplicate the images' own alt text; announcing both would be noise.
    render(<CompareSlider {...props} />);
    for (const caption of document.querySelectorAll('.compare__label')) {
      expect(caption).toHaveAttribute('aria-hidden', 'true');
    }
  });
});
