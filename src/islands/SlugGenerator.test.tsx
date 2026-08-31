import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import SlugGenerator from './SlugGenerator';

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});

describe('<SlugGenerator />', () => {
  it('starts empty with a placeholder in the output', () => {
    render(<SlugGenerator />);

    expect(screen.getByLabelText(/^text/i)).toHaveValue('');
    expect(document.querySelector('.output--empty')).toBeInTheDocument();
  });

  it('generates a slug as the user types', () => {
    render(<SlugGenerator />);
    fireEvent.input(screen.getByLabelText(/^text/i), { target: { value: 'Hello World!' } });

    expect(screen.getByText('hello-world')).toBeInTheDocument();
  });

  it('switches to an underscore separator', () => {
    render(<SlugGenerator />);
    fireEvent.input(screen.getByLabelText(/^text/i), { target: { value: 'Hello World' } });
    fireEvent.click(screen.getByRole('button', { name: /^underscore/i }));

    expect(screen.getByText('hello_world')).toBeInTheDocument();
  });

  it('preserves case when Lowercase is unchecked', () => {
    render(<SlugGenerator />);
    fireEvent.input(screen.getByLabelText(/^text/i), { target: { value: 'Hello World' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /lowercase/i }));

    expect(screen.getByText('Hello-World')).toBeInTheDocument();
  });

  it('shows a visible error, not a blank result, when nothing survives slugifying', () => {
    render(<SlugGenerator />);
    fireEvent.input(screen.getByLabelText(/^text/i), { target: { value: '日本語' } });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(document.querySelector('.output--empty')).toBeInTheDocument();
  });

  it('loads the sample text when "Load example" is pressed', () => {
    render(<SlugGenerator />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    expect((screen.getByLabelText(/^text/i) as HTMLInputElement).value).not.toBe('');
    expect(document.querySelector('.output--empty')).not.toBeInTheDocument();
  });

  it('clears the input when Clear is pressed', () => {
    render(<SlugGenerator />);
    fireEvent.input(screen.getByLabelText(/^text/i), { target: { value: 'Hello World' } });
    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(screen.getByLabelText(/^text/i)).toHaveValue('');
    expect(document.querySelector('.output--empty')).toBeInTheDocument();
  });

  it('truncates to the max length without splitting a word', () => {
    render(<SlugGenerator />);
    fireEvent.input(screen.getByLabelText(/^text/i), { target: { value: 'one two three four five' } });
    fireEvent.input(screen.getByLabelText(/max length/i), { target: { value: '12' } });

    expect(screen.getByText('one-two')).toBeInTheDocument();
  });
});
