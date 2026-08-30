import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { ResizeFields } from './ResizeFields';

/** A minimal controlled host — the shape a real tool holds this component's state in. */
function Host({ sourceWidth = 400, sourceHeight = 200 }: { sourceWidth?: number; sourceHeight?: number }) {
  const [enabled, setEnabled] = useState(false);
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [lock, setLock] = useState(true);

  return (
    <ResizeFields
      enabled={enabled}
      onToggleEnabled={setEnabled}
      width={width}
      height={height}
      lockAspectRatio={lock}
      sourceWidth={sourceWidth}
      sourceHeight={sourceHeight}
      onChange={(next) => {
        setWidth(next.width);
        setHeight(next.height);
        setLock(next.lockAspectRatio);
      }}
    />
  );
}

describe('<ResizeFields />', () => {
  it('hides the width/height fields until enabled', () => {
    render(<Host />);
    expect(screen.queryByLabelText(/width \(px\)/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: /resize output/i }));
    expect(screen.getByLabelText(/width \(px\)/i)).toBeInTheDocument();
  });

  it('pre-fills width and height from the source size when first enabled', () => {
    render(<Host sourceWidth={400} sourceHeight={200} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /resize output/i }));

    expect((screen.getByLabelText(/width \(px\)/i) as HTMLInputElement).value).toBe('400');
    expect((screen.getByLabelText(/height \(px\)/i) as HTMLInputElement).value).toBe('200');
  });

  it('derives height from width while locked', () => {
    render(<Host sourceWidth={400} sourceHeight={200} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /resize output/i }));

    fireEvent.input(screen.getByLabelText(/width \(px\)/i), { target: { value: '200' } });
    expect((screen.getByLabelText(/height \(px\)/i) as HTMLInputElement).value).toBe('100');
  });

  it('derives width from height while locked', () => {
    render(<Host sourceWidth={400} sourceHeight={200} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /resize output/i }));

    fireEvent.input(screen.getByLabelText(/height \(px\)/i), { target: { value: '50' } });
    expect((screen.getByLabelText(/width \(px\)/i) as HTMLInputElement).value).toBe('100');
  });

  it('leaves the other field untouched once unlocked', () => {
    render(<Host sourceWidth={400} sourceHeight={200} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /resize output/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /lock aspect ratio/i }));

    fireEvent.input(screen.getByLabelText(/width \(px\)/i), { target: { value: '999' } });
    expect((screen.getByLabelText(/height \(px\)/i) as HTMLInputElement).value).toBe('200');
  });

  it('clearing width while locked clears height too', () => {
    render(<Host sourceWidth={400} sourceHeight={200} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /resize output/i }));

    fireEvent.input(screen.getByLabelText(/width \(px\)/i), { target: { value: '' } });
    expect((screen.getByLabelText(/height \(px\)/i) as HTMLInputElement).value).toBe('');
  });

  it('ignores a non-positive width without touching height', () => {
    render(<Host sourceWidth={400} sourceHeight={200} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /resize output/i }));

    // A number input sanitizes truly non-numeric text (like "abc") down to an empty string
    // before the change handler ever sees it — that's the "cleared" case covered separately.
    // "0" is the case that actually exercises the value > 0 guard.
    fireEvent.input(screen.getByLabelText(/width \(px\)/i), { target: { value: '0' } });
    expect((screen.getByLabelText(/height \(px\)/i) as HTMLInputElement).value).toBe('200');
  });

  it('re-locking recomputes height from the current width', () => {
    render(<Host sourceWidth={400} sourceHeight={200} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /resize output/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /lock aspect ratio/i })); // unlock
    fireEvent.input(screen.getByLabelText(/width \(px\)/i), { target: { value: '200' } });
    fireEvent.input(screen.getByLabelText(/height \(px\)/i), { target: { value: '9999' } });

    fireEvent.click(screen.getByRole('checkbox', { name: /lock aspect ratio/i })); // re-lock

    expect((screen.getByLabelText(/height \(px\)/i) as HTMLInputElement).value).toBe('100');
  });

  it('calls onToggleEnabled without pre-filling when fields already hold values', () => {
    const onToggleEnabled = vi.fn();
    render(
      <ResizeFields
        enabled={false}
        onToggleEnabled={onToggleEnabled}
        width="123"
        height="456"
        lockAspectRatio={true}
        sourceWidth={400}
        sourceHeight={200}
        onChange={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('checkbox', { name: /resize output/i }));
    expect(onToggleEnabled).toHaveBeenCalledWith(true);
  });
});
