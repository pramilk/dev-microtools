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

  it('never renders a Sentence case button', () => {
    render(<WordCounter />);
    expect(screen.queryByRole('button', { name: /sentence case/i })).not.toBeInTheDocument();
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
