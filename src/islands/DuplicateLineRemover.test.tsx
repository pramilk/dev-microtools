import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import DuplicateLineRemover from './DuplicateLineRemover';

/**
 * A chip and its corresponding in-editor hint <mark> share the exact same `title` text
 * (both built from describeDuplicateOccurrence), so a plain getByTitle is ambiguous —
 * this narrows to the clickable chip specifically.
 */
function getChipByTitle(pattern: RegExp): HTMLElement {
  const matches = screen.getAllByTitle(pattern);
  const chip = matches.find((el) => el.tagName === 'BUTTON');
  if (!chip) throw new Error(`No chip <button> found matching ${pattern}`);
  return chip;
}

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});

describe('<DuplicateLineRemover />', () => {
  it('starts empty with zeroed stats', () => {
    render(<DuplicateLineRemover />);

    expect(screen.getByLabelText(/^text/i)).toHaveValue('');
    const stats = screen.getByTestId('dup-stats');
    expect(stats).toHaveTextContent('0');
  });

  it('updates duplicate stats live as text is typed', () => {
    render(<DuplicateLineRemover />);

    fireEvent.input(screen.getByLabelText(/^text/i), { target: { value: 'apple\nbanana\napple' } });

    const stats = screen.getByTestId('dup-stats');
    expect(stats).toHaveTextContent('3');
    expect(stats).toHaveTextContent('2');
    expect(stats).toHaveTextContent('1');
    expect(document.querySelectorAll('.highlight__match')).toHaveLength(1);
  });

  it('shows a "no duplicates" message when every line is unique', () => {
    render(<DuplicateLineRemover />);
    fireEvent.input(screen.getByLabelText(/^text/i), { target: { value: 'apple\nbanana\ncherry' } });

    expect(screen.getByText(/no duplicate lines found/i)).toBeInTheDocument();
  });

  it('loads the sample text when "Load example" is pressed', () => {
    render(<DuplicateLineRemover />);

    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    expect((screen.getByLabelText(/^text/i) as HTMLTextAreaElement).value).toContain('alice@example.com');
  });

  it('re-detects duplicates when switching granularity from lines to sentences', () => {
    render(<DuplicateLineRemover />);
    fireEvent.input(screen.getByLabelText(/^text/i), { target: { value: 'Cat sat. Dog ran. Cat sat.' } });

    // As one line, the whole string is unique.
    expect(screen.getByText(/no duplicate lines found/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^sentences$/i }));

    expect(screen.getByTestId('dup-stats')).toHaveTextContent('1');
    expect(screen.queryByText(/no duplicate sentences found/i)).not.toBeInTheDocument();
  });

  it('marks a duplicate chip and removes just that occurrence', () => {
    render(<DuplicateLineRemover />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    // Chips don't show a line number by default; it's in the hover title instead,
    // along with which other line(s) this occurrence repeats.
    fireEvent.click(getChipByTitle(/^duplicate — line 4, also at line 1/i));
    fireEvent.click(screen.getByRole('button', { name: /remove marked \(1\)/i }));

    const value = (screen.getByLabelText(/^text/i) as HTMLTextAreaElement).value;
    expect(value.split('\n')).toEqual([
      'alice@example.com',
      'bob@example.com',
      'carol@example.com',
      'dave@example.com',
      'bob@example.com',
    ]);
  });

  it('"Keep first occurrence only" removes every repeat but keeps one of each', () => {
    render(<DuplicateLineRemover />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    fireEvent.click(screen.getByRole('button', { name: /keep first occurrence only/i }));

    const value = (screen.getByLabelText(/^text/i) as HTMLTextAreaElement).value;
    expect(value.split('\n')).toEqual([
      'alice@example.com',
      'bob@example.com',
      'carol@example.com',
      'dave@example.com',
    ]);
  });

  it('"Remove all duplicates" removes every occurrence of a repeated item, including the first', () => {
    render(<DuplicateLineRemover />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    fireEvent.click(screen.getByRole('button', { name: /^remove all duplicates$/i }));

    const value = (screen.getByLabelText(/^text/i) as HTMLTextAreaElement).value;
    expect(value.split('\n')).toEqual(['carol@example.com', 'dave@example.com']);
  });

  it('respects the case-sensitive toggle', () => {
    render(<DuplicateLineRemover />);
    fireEvent.input(screen.getByLabelText(/^text/i), { target: { value: 'Apple\napple' } });

    // Case-insensitive by default, so "Apple" and "apple" already collide.
    expect(screen.queryByText(/no duplicate lines found/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: /case-sensitive/i }));
    expect(screen.getByText(/no duplicate lines found/i)).toBeInTheDocument();
  });

  it('respects the ignore-blank-lines toggle', () => {
    render(<DuplicateLineRemover />);
    fireEvent.input(screen.getByLabelText(/^text/i), { target: { value: 'apple\n\n\nbanana' } });

    // Blank lines ignored by default.
    expect(screen.getByText(/no duplicate lines found/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: /ignore blank lines/i }));
    expect(screen.queryByText(/no duplicate lines found/i)).not.toBeInTheDocument();
  });

  it('shows a "Copy text" button, enabled as soon as there is text', async () => {
    render(<DuplicateLineRemover />);
    expect(screen.getByRole('button', { name: /^copy text$/i })).toBeDisabled();

    fireEvent.input(screen.getByLabelText(/^text/i), { target: { value: 'apple\nbanana' } });

    const copyButton = screen.getByRole('button', { name: /^copy text$/i });
    expect(copyButton).not.toBeDisabled();
    fireEvent.click(copyButton);

    expect(await screen.findByRole('button', { name: /^copied$/i })).toBeInTheDocument();
  });

  it('shows a share-link button', () => {
    render(<DuplicateLineRemover />);
    expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument();
  });

  it('clears the input when Clear is pressed', () => {
    render(<DuplicateLineRemover />);
    fireEvent.input(screen.getByLabelText(/^text/i), { target: { value: 'apple\nbanana\napple' } });
    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(screen.getByLabelText(/^text/i)).toHaveValue('');
  });

  it('loads a different, granularity-appropriate sample for sentences and paragraphs', () => {
    render(<DuplicateLineRemover />);

    fireEvent.click(screen.getByRole('button', { name: /^sentences$/i }));
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    const sentenceValue = (screen.getByLabelText(/^text/i) as HTMLTextAreaElement).value;
    expect(sentenceValue).not.toContain('alice@example.com');
    expect(screen.getByTestId('dup-stats')).toHaveTextContent('1');

    fireEvent.click(screen.getByRole('button', { name: /^paragraphs$/i }));
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    const paragraphValue = (screen.getByLabelText(/^text/i) as HTMLTextAreaElement).value;
    expect(paragraphValue).not.toBe(sentenceValue);
    expect(paragraphValue).toContain('\n\n');
  });

  it('includes the original occurrence in the chip list, not just later duplicates', () => {
    render(<DuplicateLineRemover />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    expect(getChipByTitle(/^original — line 1, also at line 4/i)).toBeInTheDocument();
    expect(getChipByTitle(/^duplicate — line 4, also at line 1/i)).toBeInTheDocument();
  });

  it('shows a custom tooltip (not a native title) on hovering or focusing highlighted text', () => {
    render(<DuplicateLineRemover />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    const hintMark = document.querySelector('.dup-hint')!;
    expect(hintMark).not.toHaveAttribute('title');
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    fireEvent.mouseEnter(hintMark);
    expect(screen.getByRole('tooltip')).toHaveTextContent(/line \d, also at line \d/i);

    fireEvent.mouseLeave(hintMark);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    // Keyboard-focus equivalent, since hover-only content must also be reachable on focus.
    fireEvent.focus(hintMark);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.blur(hintMark);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('dismisses the hover tooltip when the text box scrolls, rather than leaving it in a stale position', () => {
    render(<DuplicateLineRemover />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    const hintMark = document.querySelector('.dup-hint')!;
    fireEvent.mouseEnter(hintMark);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.scroll(screen.getByLabelText(/^text/i));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('splits a duplicate paragraph separated by a single newline (no blank line)', () => {
    render(<DuplicateLineRemover />);
    fireEvent.click(screen.getByRole('button', { name: /^paragraphs$/i }));
    fireEvent.input(screen.getByLabelText(/^text/i), { target: { value: 'Same paragraph text.\nSame paragraph text.' } });

    expect(screen.getByTestId('dup-stats')).toHaveTextContent('1 duplicate');
  });

  it('removes the line the cursor is currently on, whether or not it is a duplicate', () => {
    render(<DuplicateLineRemover />);
    const input = screen.getByLabelText(/^text/i) as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: 'apple\nbanana\ncherry' } });

    input.setSelectionRange(8, 8); // inside "banana"
    fireEvent.select(input);

    fireEvent.click(screen.getByRole('button', { name: /remove current line/i }));
    expect(input.value.split('\n')).toEqual(['apple', 'cherry']);
  });

  it('disables "Remove current line" when the input is empty', () => {
    render(<DuplicateLineRemover />);
    expect(screen.getByRole('button', { name: /remove current line/i })).toBeDisabled();
  });

  describe('View diff', () => {
    it('stays disabled until a removal action actually changes the text', () => {
      render(<DuplicateLineRemover />);
      const viewDiff = screen.getByRole('button', { name: /view diff/i });
      expect(viewDiff).toBeDisabled();

      fireEvent.click(screen.getByRole('button', { name: /load example/i }));
      expect(viewDiff).toBeDisabled(); // loaded, but nothing removed yet

      fireEvent.click(screen.getByRole('button', { name: /keep first occurrence only/i }));
      expect(viewDiff).not.toBeDisabled();
    });

    it('stays disabled after a plain edit, since typing resets the comparison baseline', () => {
      render(<DuplicateLineRemover />);
      fireEvent.input(screen.getByLabelText(/^text/i), { target: { value: 'apple\nbanana\napple' } });

      expect(screen.getByRole('button', { name: /view diff/i })).toBeDisabled();
    });

    it('hands the original and edited text off to Diff Checker via sessionStorage and opens it in a new tab', async () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
      render(<DuplicateLineRemover />);

      fireEvent.click(screen.getByRole('button', { name: /load example/i }));
      const before = (screen.getByLabelText(/^text/i) as HTMLTextAreaElement).value;
      fireEvent.click(screen.getByRole('button', { name: /^remove all duplicates$/i }));
      const after = (screen.getByLabelText(/^text/i) as HTMLTextAreaElement).value;
      fireEvent.click(screen.getByRole('button', { name: /view diff/i }));

      await waitFor(() => expect(openSpy).toHaveBeenCalled());
      expect(openSpy).toHaveBeenCalledWith('/diff-checker/', '_blank');

      // No URL fragment involved — the payload travels via sessionStorage instead, so
      // there's no share-link size cap on how much text this can hand off.
      const handoff = JSON.parse(sessionStorage.getItem('dmt:handoff:diff-checker')!);
      expect(handoff).toMatchObject({ left: before, right: after, kind: 'text', mode: 'line' });

      openSpy.mockRestore();
    });
  });

  describe('Undo / redo', () => {
    it('starts with both disabled', () => {
      render(<DuplicateLineRemover />);
      expect(screen.getByRole('button', { name: /^undo$/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /^redo$/i })).toBeDisabled();
    });

    it('undoes a removal action and redoes it back', () => {
      render(<DuplicateLineRemover />);
      fireEvent.click(screen.getByRole('button', { name: /load example/i }));
      const original = (screen.getByLabelText(/^text/i) as HTMLTextAreaElement).value;

      fireEvent.click(screen.getByRole('button', { name: /^remove all duplicates$/i }));
      const cleaned = (screen.getByLabelText(/^text/i) as HTMLTextAreaElement).value;
      expect(cleaned).not.toBe(original);

      fireEvent.click(screen.getByRole('button', { name: /^undo$/i }));
      expect((screen.getByLabelText(/^text/i) as HTMLTextAreaElement).value).toBe(original);

      fireEvent.click(screen.getByRole('button', { name: /^redo$/i }));
      expect((screen.getByLabelText(/^text/i) as HTMLTextAreaElement).value).toBe(cleaned);
    });

    it('supports multiple undo/redo steps across several removals', () => {
      render(<DuplicateLineRemover />);
      fireEvent.click(screen.getByRole('button', { name: /load example/i }));
      const step0 = (screen.getByLabelText(/^text/i) as HTMLTextAreaElement).value;

      fireEvent.click(screen.getByRole('button', { name: /^keep first occurrence only$/i }));
      const step1 = (screen.getByLabelText(/^text/i) as HTMLTextAreaElement).value;

      const input = screen.getByLabelText(/^text/i) as HTMLTextAreaElement;
      input.setSelectionRange(0, 0);
      fireEvent.select(input);
      fireEvent.click(screen.getByRole('button', { name: /remove current line/i }));
      const step2 = input.value;
      expect([step0, step1, step2].every((v, i, arr) => i === 0 || v !== arr[i - 1])).toBe(true);

      fireEvent.click(screen.getByRole('button', { name: /^undo$/i }));
      expect(input.value).toBe(step1);
      fireEvent.click(screen.getByRole('button', { name: /^undo$/i }));
      expect(input.value).toBe(step0);
      // One more step back: "Load example" is itself a checkpoint, so there's still the
      // empty string from before it was clicked.
      fireEvent.click(screen.getByRole('button', { name: /^undo$/i }));
      expect(input.value).toBe('');
      expect(screen.getByRole('button', { name: /^undo$/i })).toBeDisabled();

      fireEvent.click(screen.getByRole('button', { name: /^redo$/i }));
      expect(input.value).toBe(step0);
      fireEvent.click(screen.getByRole('button', { name: /^redo$/i }));
      expect(input.value).toBe(step1);
      fireEvent.click(screen.getByRole('button', { name: /^redo$/i }));
      expect(input.value).toBe(step2);
      expect(screen.getByRole('button', { name: /^redo$/i })).toBeDisabled();
    });

    it('coalesces a burst of typing into a single undo step', () => {
      render(<DuplicateLineRemover />);
      const input = screen.getByLabelText(/^text/i) as HTMLTextAreaElement;

      fireEvent.input(input, { target: { value: 'a' } });
      fireEvent.input(input, { target: { value: 'ap' } });
      fireEvent.input(input, { target: { value: 'app' } });
      fireEvent.input(input, { target: { value: 'appl' } });
      fireEvent.input(input, { target: { value: 'apple' } });

      fireEvent.click(screen.getByRole('button', { name: /^undo$/i }));
      expect(input.value).toBe('');
      expect(screen.getByRole('button', { name: /^undo$/i })).toBeDisabled();
    });

    it('starts a new undo step after the box loses and regains focus mid-typing', () => {
      render(<DuplicateLineRemover />);
      const input = screen.getByLabelText(/^text/i) as HTMLTextAreaElement;

      fireEvent.input(input, { target: { value: 'apple' } });
      fireEvent.blur(input);
      fireEvent.input(input, { target: { value: 'apple banana' } });

      fireEvent.click(screen.getByRole('button', { name: /^undo$/i }));
      expect(input.value).toBe('apple');
      fireEvent.click(screen.getByRole('button', { name: /^undo$/i }));
      expect(input.value).toBe('');
    });

    it('clears the redo stack once a new change is made after undoing', () => {
      render(<DuplicateLineRemover />);
      fireEvent.click(screen.getByRole('button', { name: /load example/i }));
      fireEvent.click(screen.getByRole('button', { name: /^remove all duplicates$/i }));
      fireEvent.click(screen.getByRole('button', { name: /^undo$/i }));
      expect(screen.getByRole('button', { name: /^redo$/i })).not.toBeDisabled();

      fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
      expect(screen.getByRole('button', { name: /^redo$/i })).toBeDisabled();
    });

    it('undoes via Ctrl+Z even when focus is on a button, not the textarea', () => {
      render(<DuplicateLineRemover />);
      fireEvent.click(screen.getByRole('button', { name: /load example/i }));
      const original = (screen.getByLabelText(/^text/i) as HTMLTextAreaElement).value;

      const removeAllButton = screen.getByRole('button', { name: /^remove all duplicates$/i });
      fireEvent.click(removeAllButton);
      removeAllButton.focus(); // simulates focus staying on the clicked button

      fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
      expect((screen.getByLabelText(/^text/i) as HTMLTextAreaElement).value).toBe(original);
    });
  });

  describe('Spotlight highlight (current line / hovered chip)', () => {
    it('highlights the item the cursor is currently in', () => {
      render(<DuplicateLineRemover />);
      const input = screen.getByLabelText(/^text/i) as HTMLTextAreaElement;
      fireEvent.input(input, { target: { value: 'apple\nbanana\ncherry' } });

      input.setSelectionRange(8, 8); // inside "banana"
      fireEvent.select(input);

      const spotlight = document.querySelector('.dup-highlight__spotlight');
      expect(spotlight).toHaveTextContent('banana');
    });

    it('previews the hovered chip\'s occurrence instead of the cursor position', () => {
      render(<DuplicateLineRemover />);
      fireEvent.click(screen.getByRole('button', { name: /load example/i }));

      const chip = getChipByTitle(/^duplicate — line 4, also at line 1/i);
      fireEvent.mouseEnter(chip);

      const spotlight = document.querySelector('.dup-highlight__spotlight');
      expect(spotlight).toHaveTextContent('alice@example.com');

      fireEvent.mouseLeave(chip);
      // Falls back to the cursor position (start of the box, item 0) once no chip is hovered.
      expect(document.querySelector('.dup-highlight__spotlight')).toHaveTextContent('alice@example.com');
    });
  });
});
