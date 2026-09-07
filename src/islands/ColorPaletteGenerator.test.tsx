import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import ColorPaletteGenerator from './ColorPaletteGenerator';

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});

describe('<ColorPaletteGenerator />', () => {
  it('shows a full shade scale and every harmony set for the default colour', () => {
    render(<ColorPaletteGenerator />);

    expect(document.querySelectorAll('.shade-row .swatch')).toHaveLength(11);
    // 5 harmony rows: 2 + 3 + 3 + 3 + 4 = 15 swatches
    expect(document.querySelectorAll('.harmony-row .swatch')).toHaveLength(15);
    expect(screen.getByText('Base', { exact: true })).toBeInTheDocument();
  });

  it('recalculates as the base colour changes', () => {
    render(<ColorPaletteGenerator />);
    fireEvent.input(screen.getByLabelText(/^base color/i), { target: { value: '#ff0000' } });

    expect(document.querySelectorAll('.shade-row .swatch')).toHaveLength(11);
  });

  it('shows a visible error for an invalid colour, not a blank result', () => {
    render(<ColorPaletteGenerator />);
    fireEvent.input(screen.getByLabelText(/^base color/i), { target: { value: 'not a colour' } });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(document.querySelectorAll('.swatch')).toHaveLength(0);
  });

  it('applies a preset colour when clicked', () => {
    render(<ColorPaletteGenerator />);
    fireEvent.click(screen.getByRole('button', { name: /use #b3261e/i }));

    expect(screen.getByLabelText(/^base color/i)).toHaveValue('#b3261e');
  });

  it('copies a swatch hex value to the clipboard when clicked', async () => {
    render(<ColorPaletteGenerator />);
    const firstSwatch = document.querySelector('.shade-row .swatch') as HTMLButtonElement;

    fireEvent.click(firstSwatch);

    expect(navigator.clipboard.writeText).toHaveBeenCalled();
    await screen.findByText('Copied');
  });

  it('switches export format and updates the generated code', () => {
    render(<ColorPaletteGenerator />);

    expect(screen.getByText(/:root \{/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Tailwind' }));
    expect(screen.getByText(/brand: \{/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
    expect(screen.getByText(/"500":/)).toBeInTheDocument();
  });

  it('reflects a custom palette name in the exported code', () => {
    render(<ColorPaletteGenerator />);
    fireEvent.input(screen.getByLabelText(/^export$/i), { target: { value: 'Ocean Blue' } });

    expect(screen.getByText(/--color-ocean-blue-50:/)).toBeInTheDocument();
  });
});
