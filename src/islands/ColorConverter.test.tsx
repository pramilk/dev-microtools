import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import ColorConverter from './ColorConverter';

const typeInto = (element: HTMLElement, value: string) => {
  fireEvent.input(element, { target: { value } });
};

describe('<ColorConverter />', () => {
  it('converts the default colour on first render', async () => {
    render(<ColorConverter />);
    expect(await screen.findByText('rgb(60 188 212)')).toBeInTheDocument();
  });

  it('converts a hex value into every notation', async () => {
    render(<ColorConverter />);
    typeInto(screen.getByPlaceholderText('#3cbcd4'), '#ff0000');

    expect(await screen.findByText('rgb(255 0 0)')).toBeInTheDocument();
    expect(await screen.findByText(/^hsl\(0 100% 50%\)$/)).toBeInTheDocument();
    expect(await screen.findByText(/^oklch\(/)).toBeInTheDocument();
  });

  it('accepts rgb() input as well as hex', async () => {
    render(<ColorConverter />);
    typeInto(screen.getByPlaceholderText('#3cbcd4'), 'rgb(255, 0, 0)');

    expect(await screen.findByText('#ff0000')).toBeInTheDocument();
  });

  it('shows an actionable error for unparseable input', async () => {
    render(<ColorConverter />);
    typeInto(screen.getByPlaceholderText('#3cbcd4'), 'banana');

    expect(await screen.findByRole('alert')).toHaveTextContent(/#3cbcd4/);
  });

  it('reports the WCAG verdict against white and black', async () => {
    render(<ColorConverter />);
    typeInto(screen.getByPlaceholderText('#3cbcd4'), '#000000');

    expect(await screen.findByText('21.00:1')).toBeInTheDocument();
  });

  it('grades a low-contrast colour as failing', async () => {
    render(<ColorConverter />);
    typeInto(screen.getByPlaceholderText('#3cbcd4'), '#ffffff');

    expect(await screen.findByText(/fails wcag/i)).toBeInTheDocument();
  });

  it('applies a preset when clicked', async () => {
    render(<ColorConverter />);
    fireEvent.click(screen.getByRole('button', { name: /use #b3261e/i }));

    expect(await screen.findByText('#b3261e')).toBeInTheDocument();
  });
});
