import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { createFakeWorkerClass } from '../../test/fakeWorker';
import { applySentenceCase, type NerClassifier } from '../lib/tools/sentenceCase';
import type { SentenceCaseWorkerRequest, SentenceCaseWorkerResult } from '../workers/sentenceCase.worker';
import CaseConverter from './CaseConverter';

// jsdom has no real Worker, and the real NER classifier depends on a multi-megabyte WASM
// model that has no place in a component test — this fake worker runs the real
// `applySentenceCase` merge logic (so a bug there still fails this test the same way it
// always did) against a no-op classifier, i.e. compromise-only behavior, same as before this
// tool gained a second, transformer-based signal.
const noEntities: NerClassifier = async () => [];
vi.mock('../workers/sentenceCase.worker?worker', () => ({
  default: createFakeWorkerClass((request: SentenceCaseWorkerRequest): Promise<SentenceCaseWorkerResult> =>
    applySentenceCase(request.text, noEntities)
  ),
}));

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});

describe('<CaseConverter />', () => {
  it('starts empty', () => {
    render(<CaseConverter />);

    expect(screen.getByLabelText(/^text/i)).toHaveValue('');
  });

  it('loads the sample text when "Load example" is pressed', () => {
    render(<CaseConverter />);

    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    expect((screen.getByLabelText(/^text/i) as HTMLTextAreaElement).value).toContain('SpaceX');
  });

  it('fills the text area from a file dropped directly onto it', async () => {
    render(<CaseConverter />);
    const file = new File(['dropped file contents'], 'notes.txt', { type: 'text/plain' });

    fireEvent.drop(screen.getByLabelText(/^text/i), { dataTransfer: { files: [file] } });

    await waitFor(() => {
      expect((screen.getByLabelText(/^text/i) as HTMLTextAreaElement).value).toBe('dropped file contents');
    });
  });

  it('converts the text to each case when its button is pressed', () => {
    render(<CaseConverter />);
    const input = screen.getByLabelText(/^text/i) as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: 'hello world' } });

    fireEvent.click(screen.getByRole('button', { name: /^uppercase$/i }));
    expect(input.value).toBe('HELLO WORLD');

    fireEvent.click(screen.getByRole('button', { name: /^camelcase$/i }));
    expect(input.value).toBe('helloWorld');

    fireEvent.click(screen.getByRole('button', { name: /^snake_case$/i }));
    expect(input.value).toBe('hello_world');
  });

  it('always converts from the original text, not the currently displayed cased text', () => {
    render(<CaseConverter />);
    const input = screen.getByLabelText(/^text/i) as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: 'the lord of the rings' } });

    fireEvent.click(screen.getByRole('button', { name: /^pascalcase$/i }));
    expect(input.value).toBe('TheLordOfTheRings');

    fireEvent.click(screen.getByRole('button', { name: /^title case$/i }));
    expect(input.value).toBe('The Lord of the Rings');
  });

  it(
    'applies sentence case via NLP, disabled until there is text',
    async () => {
      render(<CaseConverter />);
      const button = screen.getByRole('button', { name: /sentence case/i });
      expect(button).toBeDisabled();

      const input = screen.getByLabelText(/^text/i) as HTMLTextAreaElement;
      fireEvent.input(input, { target: { value: 'john smith went to paris.' } });
      expect(button).not.toBeDisabled();

      fireEvent.click(button);

      // A generous timeout on both this test and the waitFor below: this awaits a real
      // dynamic import() of compromise (~136KB) plus NLP tagging, not a mock. Under a
      // full-suite run (many test files competing for CPU) that can take longer than
      // Vitest's 5000ms default per-test budget, which fails the whole test regardless of
      // waitFor's own timeout — both need raising, not just one.
      await waitFor(() => expect(input.value).toBe('John Smith went to Paris.'), { timeout: 15000 });
    },
    15000
  );

  it(
    'underlines and warns about words sentence case was not confident were proper nouns',
    async () => {
      render(<CaseConverter />);
      const input = screen.getByLabelText(/^text/i) as HTMLTextAreaElement;
      fireEvent.input(input, { target: { value: 'I saw a Fox in the yard.' } });
      fireEvent.click(screen.getByRole('button', { name: /sentence case/i }));

      await waitFor(() => expect(document.querySelectorAll('.highlight__lowconf')).toHaveLength(1), { timeout: 15000 });
      expect(screen.getByText(/wasn't confident.*proper noun/i)).toBeInTheDocument();

      const hint = document.querySelector('.cc-lowconf-hint');
      expect(hint).toHaveTextContent('fox');
      expect(hint).toHaveAttribute('title', expect.stringContaining('also an ordinary English word'));
    },
    15000
  );

  it(
    "toggles a flagged word's capitalization on click, and back again on a second click",
    async () => {
      render(<CaseConverter />);
      const input = screen.getByLabelText(/^text/i) as HTMLTextAreaElement;
      fireEvent.input(input, { target: { value: 'I saw a Fox in the yard.' } });
      fireEvent.click(screen.getByRole('button', { name: /sentence case/i }));
      await waitFor(() => expect(document.querySelector('.cc-lowconf-hint')).toBeInTheDocument(), { timeout: 15000 });

      fireEvent.click(document.querySelector('.cc-lowconf-hint') as HTMLElement);
      expect(input.value).toBe('I saw a Fox in the yard.');

      fireEvent.click(document.querySelector('.cc-lowconf-hint') as HTMLElement);
      expect(input.value).toBe('I saw a fox in the yard.');
    },
    15000
  );

  it(
    'clears the low-confidence highlight once the user edits the text directly',
    async () => {
      render(<CaseConverter />);
      const input = screen.getByLabelText(/^text/i) as HTMLTextAreaElement;
      fireEvent.input(input, { target: { value: 'I saw a Fox in the yard.' } });
      fireEvent.click(screen.getByRole('button', { name: /sentence case/i }));
      await waitFor(() => expect(document.querySelectorAll('.highlight__lowconf')).toHaveLength(1), { timeout: 15000 });

      fireEvent.input(input, { target: { value: 'I saw a Fox in the yard. Edited.' } });
      expect(document.querySelectorAll('.highlight__lowconf')).toHaveLength(0);
    },
    15000
  );

  it('shows a "Copy text" button, enabled only once there is text', async () => {
    render(<CaseConverter />);
    expect(screen.getByRole('button', { name: /^copy text$/i })).toBeDisabled();

    fireEvent.input(screen.getByLabelText(/^text/i), { target: { value: 'hello world' } });

    const copyButton = screen.getByRole('button', { name: /^copy text$/i });
    expect(copyButton).not.toBeDisabled();

    fireEvent.click(copyButton);
    expect(await screen.findByRole('button', { name: /^copied$/i })).toBeInTheDocument();
  });

  it('clears the input when Clear is pressed', () => {
    render(<CaseConverter />);
    fireEvent.input(screen.getByLabelText(/^text/i), { target: { value: 'hello world' } });
    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(screen.getByLabelText(/^text/i)).toHaveValue('');
  });
});
