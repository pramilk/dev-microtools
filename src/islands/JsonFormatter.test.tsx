import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import JsonFormatter from './JsonFormatter';

const typeInto = (element: HTMLElement, value: string) => {
  fireEvent.input(element, { target: { value } });
};

describe('<JsonFormatter />', () => {
  it('shows the empty state before any input', () => {
    render(<JsonFormatter />);
    expect(screen.getByText(/formatted json appears here/i)).toBeInTheDocument();
  });

  it('formats valid JSON as the user types', async () => {
    render(<JsonFormatter />);
    typeInto(screen.getByLabelText(/json input/i), '{"a":1}');

    expect(await screen.findByText(/"a": 1/)).toBeInTheDocument();
  });

  it('shows a visible error for malformed JSON rather than failing silently', async () => {
    render(<JsonFormatter />);
    typeInto(screen.getByLabelText(/json input/i), '{"a":}');

    const alert = await screen.findByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert.textContent?.length ?? 0).toBeGreaterThan(0);
  });

  it('marks the input as invalid for screen readers when parsing fails', async () => {
    render(<JsonFormatter />);
    const input = screen.getByLabelText(/json input/i);
    typeInto(input, 'not json');

    await screen.findByRole('alert');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('clears the error once the input becomes valid again', async () => {
    render(<JsonFormatter />);
    const input = screen.getByLabelText(/json input/i);

    typeInto(input, '{bad');
    await screen.findByRole('alert');

    typeInto(input, '{"ok":true}');
    await screen.findByText(/"ok": true/);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('minifies when the Minify action is selected', async () => {
    render(<JsonFormatter />);
    typeInto(screen.getByLabelText(/json input/i), '{\n "a": 1\n}');
    fireEvent.click(screen.getByRole('button', { name: /minify/i }));

    expect(await screen.findByText('{"a":1}')).toBeInTheDocument();
  });

  it('sorts keys when the Sort keys action is selected', async () => {
    render(<JsonFormatter />);
    typeInto(screen.getByLabelText(/json input/i), '{"b":1,"a":2}');
    fireEvent.click(screen.getByRole('button', { name: /sort keys/i }));

    const output = await screen.findByText(/"a": 2/);
    expect(output.textContent!.indexOf('"a"')).toBeLessThan(output.textContent!.indexOf('"b"'));
  });

  it('loads a sample document on request', async () => {
    render(<JsonFormatter />);
    fireEvent.click(screen.getByRole('button', { name: /load sample/i }));

    const input = screen.getByLabelText(/json input/i) as HTMLTextAreaElement;
    expect(input.value.length).toBeGreaterThan(0);
    expect(await screen.findByText(/"name": "ada"/)).toBeInTheDocument();
  });

  it('clears the input with the Clear button', async () => {
    render(<JsonFormatter />);
    const input = screen.getByLabelText(/json input/i) as HTMLTextAreaElement;

    typeInto(input, '{"a":1}');
    await screen.findByText(/"a": 1/);

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    expect(input.value).toBe('');
    expect(screen.getByText(/formatted json appears here/i)).toBeInTheDocument();
  });

  it('reports structural statistics for valid input', async () => {
    render(<JsonFormatter />);
    typeInto(screen.getByLabelText(/json input/i), '{"a":{"b":1}}');

    expect(await screen.findByText(/levels deep/i)).toBeInTheDocument();
  });

  it('disables the copy button while there is nothing to copy', () => {
    render(<JsonFormatter />);
    expect(screen.getByRole('button', { name: /copy/i })).toBeDisabled();
  });
});
