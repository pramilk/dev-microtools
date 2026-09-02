import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/preact';
import AsciiTableKeycodeInspector from './AsciiTableKeycodeInspector';

describe('<AsciiTableKeycodeInspector />', () => {
  it('shows the full 128-entry ASCII table by default', () => {
    render(<AsciiTableKeycodeInspector />);
    expect(screen.getByText('128 of 128 characters')).toBeInTheDocument();
    expect(screen.getByText('Latin Capital Letter A')).toBeInTheDocument();
  });

  it('filters the table as the search query changes', () => {
    render(<AsciiTableKeycodeInspector />);
    fireEvent.input(screen.getByLabelText(/^search/i), { target: { value: 'horizontal tab' } });

    expect(screen.getByText('1 of 128 characters')).toBeInTheDocument();
    expect(screen.getByText('Horizontal Tab')).toBeInTheDocument();
    expect(screen.queryByText('Latin Capital Letter A')).not.toBeInTheDocument();
  });

  it('shows a visible empty state, not a blank table, when nothing matches', () => {
    render(<AsciiTableKeycodeInspector />);
    fireEvent.input(screen.getByLabelText(/^search/i), { target: { value: 'no-such-character' } });

    expect(screen.getByText('0 of 128 characters')).toBeInTheDocument();
    expect(screen.getByText(/no character matches/i)).toBeInTheDocument();
  });

  it('applies a preset and filters to that single character', () => {
    render(<AsciiTableKeycodeInspector />);
    fireEvent.click(screen.getByRole('button', { name: 'Escape' }));

    expect(screen.getByLabelText(/^search/i)).toHaveValue('27');
    expect(screen.getByText('1 of 128 characters')).toBeInTheDocument();
    expect(within(document.querySelector('.atk-table-wrap')!).getByText('Escape')).toBeInTheDocument();
  });

  it('clears the search when Clear is pressed', () => {
    render(<AsciiTableKeycodeInspector />);
    fireEvent.input(screen.getByLabelText(/^search/i), { target: { value: 'tab' } });
    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(screen.getByLabelText(/^search/i)).toHaveValue('');
    expect(screen.getByText('128 of 128 characters')).toBeInTheDocument();
  });

  it('copies a row via the shared clipboard flow', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<AsciiTableKeycodeInspector />);
    fireEvent.click(screen.getByTitle("Copy Latin Capital Letter A's details"));

    expect(writeText).toHaveBeenCalledWith('A — dec 65, hex 41, oct 101, bin 01000001 (Latin Capital Letter A)');
  });

  it('shows the initial capture prompt with no key pressed yet', () => {
    render(<AsciiTableKeycodeInspector />);
    expect(screen.getByText('Click here, then press any key')).toBeInTheDocument();
  });

  it('reports key, code, keyCode, and modifiers when a key is pressed in the capture box', () => {
    render(<AsciiTableKeycodeInspector />);
    const box = screen.getByRole('textbox', { name: /key capture area/i });

    fireEvent.keyDown(box, {
      key: 'a',
      code: 'KeyA',
      keyCode: 65,
      which: 65,
      location: 0,
      ctrlKey: true,
    });

    const current = within(document.querySelector('.atk-current')!);
    expect(current.getByText('a')).toBeInTheDocument();
    expect(current.getByText('KeyA')).toBeInTheDocument();
    expect(current.getByText('Ctrl')).toBeInTheDocument();
  });

  it('adds each keypress to a visible history, most recent first', () => {
    render(<AsciiTableKeycodeInspector />);
    const box = screen.getByRole('textbox', { name: /key capture area/i });

    fireEvent.keyDown(box, { key: 'a', code: 'KeyA', keyCode: 65, which: 65 });
    fireEvent.keyDown(box, { key: 'b', code: 'KeyB', keyCode: 66, which: 66 });

    const rows = document.querySelectorAll('.atk-history-wrap .atk-table tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('"b"');
    expect(rows[1]!.textContent).toContain('"a"');
  });

  it('clears the captured key and history when "Clear history" is pressed', () => {
    render(<AsciiTableKeycodeInspector />);
    const box = screen.getByRole('textbox', { name: /key capture area/i });
    fireEvent.keyDown(box, { key: 'a', code: 'KeyA', keyCode: 65, which: 65 });

    fireEvent.click(screen.getByRole('button', { name: /clear history/i }));

    expect(screen.getByText('Click here, then press any key')).toBeInTheDocument();
    expect(document.querySelector('.atk-history-wrap')).not.toBeInTheDocument();
  });

  it('shows no Unicode card for an empty search', () => {
    render(<AsciiTableKeycodeInspector />);
    expect(document.querySelector('.atk-unicode-card')).not.toBeInTheDocument();
  });

  it('shows Unicode details for a non-ASCII character with no name shown', () => {
    render(<AsciiTableKeycodeInspector />);
    fireEvent.click(screen.getByRole('button', { name: '😀' }));

    const card = within(document.querySelector('.atk-unicode-card')!);
    expect(card.getByText('U+1F600 (128512)')).toBeInTheDocument();
    expect(card.getByText('not shown for non-ASCII')).toBeInTheDocument();
    expect(card.getByText('F0 9F 98 80')).toBeInTheDocument();
    expect(card.getByText('D83D DE00')).toBeInTheDocument();
  });

  it('hides the (0-127) ASCII table for a non-ASCII match instead of showing a contradictory "no match"', () => {
    render(<AsciiTableKeycodeInspector />);
    fireEvent.click(screen.getByRole('button', { name: '😀' }));

    expect(screen.queryByText(/of 128 characters/)).not.toBeInTheDocument();
    expect(screen.queryByText(/no character matches/i)).not.toBeInTheDocument();
    expect(document.querySelector('.atk-table-wrap')).not.toBeInTheDocument();
    expect(screen.getByText(/not part of the ascii table/i)).toBeInTheDocument();
  });

  it('identifies scripts other than Latin via the preset chips', () => {
    render(<AsciiTableKeycodeInspector />);
    fireEvent.click(screen.getByRole('button', { name: '中' }));

    const card = within(document.querySelector('.atk-unicode-card')!);
    expect(card.getByText('Han')).toBeInTheDocument();
  });

  it('shows the ASCII name in the Unicode card for an ASCII character', () => {
    render(<AsciiTableKeycodeInspector />);
    fireEvent.click(screen.getByRole('button', { name: 'A' }));

    const card = within(document.querySelector('.atk-unicode-card')!);
    expect(card.getByText('Latin Capital Letter A')).toBeInTheDocument();
    expect(card.queryByText('not shown for non-ASCII')).not.toBeInTheDocument();
  });

  it('shows a category placeholder instead of a raw glyph for a control character', () => {
    render(<AsciiTableKeycodeInspector />);
    fireEvent.click(screen.getByRole('button', { name: 'Tab' }));

    const glyph = document.querySelector('.atk-unicode-card__glyph');
    expect(glyph?.textContent).toBe('(control)');
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
  });

  it('copies the Unicode card details via the shared clipboard flow', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<AsciiTableKeycodeInspector />);
    fireEvent.click(screen.getByRole('button', { name: '😀' }));
    fireEvent.click(screen.getByTitle("Copy this character's Unicode details to clipboard"));

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('code point: U+1F600 (128512)'));
  });
});
