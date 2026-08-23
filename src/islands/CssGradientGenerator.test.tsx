import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import CssGradientGenerator from './CssGradientGenerator';

describe('<CssGradientGenerator />', () => {
  it('shows a default linear gradient declaration on mount', async () => {
    render(<CssGradientGenerator />);
    expect(await screen.findByText(/^background: linear-gradient\(/)).toBeInTheDocument();
  });

  it('switches to a radial gradient and shows shape/position controls', async () => {
    render(<CssGradientGenerator />);
    fireEvent.click(screen.getByRole('button', { name: 'Radial' }));

    expect(await screen.findByText(/^background: radial-gradient\(/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'circle' })).toBeInTheDocument();
  });

  it('switches to a conic gradient', async () => {
    render(<CssGradientGenerator />);
    fireEvent.click(screen.getByRole('button', { name: 'Conic' }));

    expect(await screen.findByText(/^background: conic-gradient\(/)).toBeInTheDocument();
  });

  it('updates the angle when the slider moves', async () => {
    render(<CssGradientGenerator />);
    fireEvent.input(screen.getByLabelText(/gradient angle/i), { target: { value: '45' } });

    expect(await screen.findByText(/^background: linear-gradient\(45deg,/)).toBeInTheDocument();
  });

  it('adds a stop and reflects it in the output', async () => {
    render(<CssGradientGenerator />);
    await screen.findByText(/^background: linear-gradient\(/);

    fireEvent.click(screen.getByRole('button', { name: /add stop/i }));

    const output = await screen.findByText(/^background: linear-gradient\(/);
    const stopCount = (output.textContent!.match(/%/g) ?? []).length;
    expect(stopCount).toBe(3);
  });

  it('disables removing a stop when only two remain', () => {
    render(<CssGradientGenerator />);
    const removeButtons = screen.getAllByTitle(/at least two stops|remove this stop/i);
    expect(removeButtons.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
  });

  it('shows an error instead of broken CSS when a stop colour is invalid', async () => {
    render(<CssGradientGenerator />);
    const colourInputs = screen.getAllByLabelText(/colour value/i);
    fireEvent.input(colourInputs[0]!, { target: { value: 'not-a-colour' } });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('applies a preset from the gallery, replacing the stops', async () => {
    render(<CssGradientGenerator />);
    await screen.findByText(/^background: linear-gradient\(/);

    fireEvent.click(screen.getByRole('button', { name: 'Ocean' }));

    const output = await screen.findByText(/^background: linear-gradient\(/);
    expect(output.textContent).toContain('#2193b0');
    expect(output.textContent).toContain('#6dd5ed');
  });
});
