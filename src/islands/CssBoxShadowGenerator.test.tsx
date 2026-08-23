import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import CssBoxShadowGenerator from './CssBoxShadowGenerator';

describe('<CssBoxShadowGenerator />', () => {
  it('shows a default box-shadow declaration on mount', async () => {
    render(<CssBoxShadowGenerator />);
    expect(await screen.findByText(/^box-shadow: /)).toBeInTheDocument();
  });

  it('updates the declaration when blur changes', async () => {
    render(<CssBoxShadowGenerator />);
    fireEvent.input(screen.getByLabelText(/layer 1 blur/i), { target: { value: '30' } });

    const output = await screen.findByText(/^box-shadow: /);
    expect(output.textContent).toContain('30px');
  });

  it('marks the layer inset when the checkbox is toggled', async () => {
    render(<CssBoxShadowGenerator />);
    fireEvent.click(screen.getByRole('checkbox', { name: /inset/i }));

    const output = await screen.findByText(/^box-shadow: /);
    expect(output.textContent).toMatch(/box-shadow: inset/);
  });

  it('adds a layer and joins both in the output with a comma', async () => {
    render(<CssBoxShadowGenerator />);
    await screen.findByText(/^box-shadow: /);

    fireEvent.click(screen.getByRole('button', { name: /add layer/i }));

    const output = await screen.findByText(/^box-shadow: /);
    expect(output.textContent).toContain(',');
    expect(screen.getByText('Layer 2')).toBeInTheDocument();
  });

  it('disables removing the only remaining layer', () => {
    render(<CssBoxShadowGenerator />);
    expect(screen.getByTitle(/at least one shadow layer/i)).toBeDisabled();
  });

  it('shows an error instead of broken CSS for an invalid color', async () => {
    render(<CssBoxShadowGenerator />);
    fireEvent.input(screen.getByLabelText(/layer 1 color value/i), { target: { value: 'not-a-color' } });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('updates the opacity in the color value when the opacity slider moves', async () => {
    render(<CssBoxShadowGenerator />);
    fireEvent.input(screen.getByLabelText(/layer 1 opacity/i), { target: { value: '50' } });

    const colorValue = await screen.findByLabelText(/layer 1 color value/i);
    expect((colorValue as HTMLInputElement).value).toContain('0.5');
  });

  it('keeps the opacity when the color swatch changes', async () => {
    render(<CssBoxShadowGenerator />);
    fireEvent.input(screen.getByLabelText(/layer 1 color swatch/i), { target: { value: '#ff0000' } });

    const colorValue = await screen.findByLabelText(/layer 1 color value/i);
    expect((colorValue as HTMLInputElement).value).toContain('255 0 0');
    expect((colorValue as HTMLInputElement).value).toContain('0.35');
  });

  it('applies a preset from the gallery', async () => {
    render(<CssBoxShadowGenerator />);
    fireEvent.click(screen.getByRole('button', { name: 'Sharp' }));

    const output = await screen.findByText(/^box-shadow: /);
    expect(output.textContent).toContain('4px 4px 0px');
  });
});
