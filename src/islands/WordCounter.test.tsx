import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import WordCounter from './WordCounter';

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});

describe('<WordCounter />', () => {
  it('starts empty with zeroed stats', () => {
    render(<WordCounter />);

    expect(screen.getByLabelText(/^text/i)).toHaveValue('');
    const stats = screen.getByTestId('wc-stats');
    expect(stats).toHaveTextContent('0 words');
    expect(stats).toHaveTextContent('0 characters');
  });

  it('updates stats live as text is typed', async () => {
    render(<WordCounter />);

    fireEvent.input(screen.getByLabelText(/^text/i), { target: { value: 'Hello world. Second sentence!' } });

    const stats = await screen.findByTestId('wc-stats');
    expect(stats).toHaveTextContent('4 words');
    expect(stats).toHaveTextContent('2 sentences');
  });

  it('loads the sample text when "Load example" is pressed', () => {
    render(<WordCounter />);

    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    expect((screen.getByLabelText(/^text/i) as HTMLTextAreaElement).value).toContain('quick brown fox');
  });

  it('fills the text area from a file dropped directly onto it', async () => {
    render(<WordCounter />);
    const file = new File(['dropped file contents'], 'notes.txt', { type: 'text/plain' });

    fireEvent.drop(screen.getByLabelText(/^text/i), { dataTransfer: { files: [file] } });

    await waitFor(() => {
      expect((screen.getByLabelText(/^text/i) as HTMLTextAreaElement).value).toBe('dropped file contents');
    });
  });

  it('converts the text to each case when its button is pressed', () => {
    render(<WordCounter />);
    const input = screen.getByLabelText(/^text/i) as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: 'hello world' } });

    fireEvent.click(screen.getByRole('button', { name: /^uppercase$/i }));
    expect(input.value).toBe('HELLO WORLD');

    fireEvent.click(screen.getByRole('button', { name: /^camelcase$/i }));
    expect(input.value).toBe('helloWorld');

    fireEvent.click(screen.getByRole('button', { name: /^snake_case$/i }));
    expect(input.value).toBe('hello_world');
  });

  it('applies sentence case via NLP, disabled until there is text', async () => {
    render(<WordCounter />);
    const button = screen.getByRole('button', { name: /sentence case/i });
    expect(button).toBeDisabled();

    const input = screen.getByLabelText(/^text/i) as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: 'john smith went to paris.' } });
    expect(button).not.toBeDisabled();

    fireEvent.click(button);

    // A generous timeout: this awaits a real dynamic import() of compromise (~136KB) plus
    // NLP tagging, not a mock — under full-suite parallel load (many files competing for
    // CPU) that can comfortably exceed testing-library's ~1000ms default wait.
    await waitFor(() => expect(input.value).toBe('John Smith went to Paris.'), { timeout: 5000 });
  });

  it('underlines and warns about words sentence case was not confident were proper nouns', async () => {
    render(<WordCounter />);
    const input = screen.getByLabelText(/^text/i) as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: 'I saw a Fox in the yard.' } });
    fireEvent.click(screen.getByRole('button', { name: /sentence case/i }));

    await waitFor(() => expect(document.querySelectorAll('.highlight__lowconf')).toHaveLength(1), { timeout: 5000 });
    expect(screen.getByText(/wasn't confident.*proper noun/i)).toBeInTheDocument();

    // The hover reason lives directly on the word itself — a real, hoverable mark stacked
    // on top of the textarea at exactly that word's position, not a list below the box.
    // "Fox" is also an ordinary dictionary word, so it's demoted to lowercase by default
    // and gets the more specific "commonWord" reason rather than the generic one.
    const hint = document.querySelector('.wc-lowconf-hint');
    expect(hint).toHaveTextContent('fox');
    expect(hint).toHaveAttribute('title', expect.stringContaining('also an ordinary English word'));
  });

  it('toggles a flagged word\'s capitalization on click, and back again on a second click', async () => {
    render(<WordCounter />);
    const input = screen.getByLabelText(/^text/i) as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: 'I saw a Fox in the yard.' } });
    fireEvent.click(screen.getByRole('button', { name: /sentence case/i }));
    await waitFor(() => expect(document.querySelector('.wc-lowconf-hint')).toBeInTheDocument(), { timeout: 5000 });

    const hint = document.querySelector('.wc-lowconf-hint') as HTMLElement;
    fireEvent.click(hint);
    expect(input.value).toBe('I saw a Fox in the yard.');
    // The highlight stays put — it's still the same uncertain guess, just toggled — so the
    // word remains clickable to flip back.
    expect(document.querySelector('.wc-lowconf-hint')).toBeInTheDocument();

    fireEvent.click(document.querySelector('.wc-lowconf-hint') as HTMLElement);
    expect(input.value).toBe('I saw a fox in the yard.');
  });

  it('toggles a flagged word via the keyboard (Enter), not just a mouse click', async () => {
    render(<WordCounter />);
    const input = screen.getByLabelText(/^text/i) as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: 'I saw a Fox in the yard.' } });
    fireEvent.click(screen.getByRole('button', { name: /sentence case/i }));
    await waitFor(() => expect(document.querySelector('.wc-lowconf-hint')).toBeInTheDocument(), { timeout: 5000 });

    fireEvent.keyDown(document.querySelector('.wc-lowconf-hint') as HTMLElement, { key: 'Enter' });
    expect(input.value).toBe('I saw a Fox in the yard.');
  });

  it('gives a different hover reason for a flagged word that is not a common dictionary word', async () => {
    render(<WordCounter />);
    const input = screen.getByLabelText(/^text/i) as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: 'I met Pramil yesterday.' } });
    fireEvent.click(screen.getByRole('button', { name: /sentence case/i }));

    await waitFor(() => expect(document.querySelectorAll('.highlight__lowconf')).toHaveLength(1), { timeout: 5000 });
    const hint = document.querySelector('.wc-lowconf-hint');
    expect(hint).toHaveTextContent('Pramil');
    expect(hint).toHaveAttribute('title', expect.stringContaining('not a common English word'));
  });

  it('does not show the low-confidence warning when sentence case has no doubts', async () => {
    render(<WordCounter />);
    const input = screen.getByLabelText(/^text/i) as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: 'the weather is nice today.' } });
    fireEvent.click(screen.getByRole('button', { name: /sentence case/i }));

    await waitFor(() => expect(input.value).toBe('The weather is nice today.'), { timeout: 5000 });
    expect(screen.queryByText(/wasn't confident.*proper noun/i)).not.toBeInTheDocument();
  });

  it('clears the low-confidence highlight once the user edits the text directly', async () => {
    render(<WordCounter />);
    const input = screen.getByLabelText(/^text/i) as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: 'I saw a Fox in the yard.' } });
    fireEvent.click(screen.getByRole('button', { name: /sentence case/i }));
    await waitFor(() => expect(document.querySelectorAll('.highlight__lowconf')).toHaveLength(1), { timeout: 5000 });

    fireEvent.input(input, { target: { value: 'I saw a Fox in the yard. Edited.' } });
    expect(document.querySelectorAll('.highlight__lowconf')).toHaveLength(0);
  });

  it('always converts from the original text, not the currently displayed cased text', () => {
    render(<WordCounter />);
    const input = screen.getByLabelText(/^text/i) as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: 'the lord of the rings' } });

    fireEvent.click(screen.getByRole('button', { name: /^pascalcase$/i }));
    expect(input.value).toBe('TheLordOfTheRings');

    // Switching straight to Title Case should title-case the ORIGINAL text, not the
    // PascalCase result currently on screen.
    fireEvent.click(screen.getByRole('button', { name: /^title case$/i }));
    expect(input.value).toBe('The Lord of the Rings');
  });

  it('adopts a case-converted result as the new base once the user edits it directly', () => {
    render(<WordCounter />);
    const input = screen.getByLabelText(/^text/i) as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: 'hello world' } });
    fireEvent.click(screen.getByRole('button', { name: /^uppercase$/i }));
    expect(input.value).toBe('HELLO WORLD');

    fireEvent.input(input, { target: { value: 'HELLO WORLD AGAIN' } });
    fireEvent.click(screen.getByRole('button', { name: /^lowercase$/i }));
    expect(input.value).toBe('hello world again');
  });

  it('highlights matches and replaces all occurrences via find & replace', async () => {
    render(<WordCounter />);
    fireEvent.input(screen.getByLabelText(/^text/i), { target: { value: 'cat sat on the mat' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /find & replace/i }));

    fireEvent.input(screen.getByLabelText(/^find$/i), { target: { value: 'at' } });
    expect(await screen.findByText('3 matches')).toBeInTheDocument();
    // The highlight overlay lives behind the same textarea the user is editing, not in a
    // second read-only panel — its parent is the editor wrapper, not a standalone box.
    const marks = document.querySelectorAll('.highlight__match');
    expect(marks).toHaveLength(3);
    expect(marks[0]!.closest('.wc-editor')).toContainElement(screen.getByLabelText(/^text/i));

    fireEvent.input(screen.getByLabelText(/replace with/i), { target: { value: 'AT' } });
    fireEvent.click(screen.getByRole('button', { name: /replace all/i }));

    expect((screen.getByLabelText(/^text/i) as HTMLTextAreaElement).value).toBe('cAT sAT on the mAT');
  });

  it('shows a "Copy text" button next to "Copy report", enabled as soon as there is text', async () => {
    render(<WordCounter />);
    expect(screen.getByRole('button', { name: /^copy text$/i })).toBeDisabled();

    fireEvent.input(screen.getByLabelText(/^text/i), { target: { value: 'hello world' } });

    const copyButton = screen.getByRole('button', { name: /^copy text$/i });
    expect(copyButton).not.toBeDisabled();

    fireEvent.click(copyButton);
    expect(await screen.findByRole('button', { name: /^copied$/i })).toBeInTheDocument();
  });

  it('respects the case-sensitive toggle in find & replace', async () => {
    render(<WordCounter />);
    fireEvent.input(screen.getByLabelText(/^text/i), { target: { value: 'Cat cat CAT' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /find & replace/i }));
    fireEvent.input(screen.getByLabelText(/^find$/i), { target: { value: 'cat' } });

    expect(await screen.findByText('3 matches')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: /case-sensitive/i }));
    expect(await screen.findByText('1 match')).toBeInTheDocument();
  });

  it('copies a stats report when "Copy report" is pressed', async () => {
    render(<WordCounter />);
    fireEvent.input(screen.getByLabelText(/^text/i), { target: { value: 'hello world' } });

    fireEvent.click(screen.getByRole('button', { name: /copy report/i }));

    expect(await screen.findByRole('button', { name: /report copied/i })).toBeInTheDocument();
  });

  it('keeps the most-frequent-words list collapsed behind a disclosure by default', () => {
    render(<WordCounter />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    const details = document.querySelector('.wc-top-words-details') as HTMLDetailsElement;
    expect(details).toBeInTheDocument();
    expect(details.open).toBe(false);
    expect(screen.getByText(/most frequent words/i)).toBeInTheDocument();
  });

  it('clears the input, find query and replace query when Clear is pressed', () => {
    render(<WordCounter />);
    fireEvent.input(screen.getByLabelText(/^text/i), { target: { value: 'hello world' } });
    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(screen.getByLabelText(/^text/i)).toHaveValue('');
  });
});
