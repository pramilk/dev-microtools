import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/preact';
import TokenCounter from './TokenCounter';

/**
 * The exact tokenizer is left real — its whole point is that the numbers are the real ones,
 * and a mocked vocabulary would make these tests prove nothing. The flag below only exists
 * to drive the download-failure branch, which cannot otherwise be reached in jsdom.
 */
const { downloadFails, stallDownload } = vi.hoisted(() => ({
  downloadFails: { value: false },
  stallDownload: { value: false },
}));

vi.mock('../lib/tools/exactTokenizer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/tools/exactTokenizer')>();
  return {
    ...actual,
    // The real module caches a loaded vocabulary for the lifetime of the process, so once
    // any test in this file has counted exactly, every later test sees it as already
    // loaded. `stallDownload` pins the "still downloading" state so the notice can be
    // asserted regardless of what ran before it.
    isEncodingLoaded: (encoding: Parameters<typeof actual.isEncodingLoaded>[0]) =>
      stallDownload.value ? false : actual.isEncodingLoaded(encoding),
    countExactly: (...args: Parameters<typeof actual.countExactly>) => {
      if (downloadFails.value) {
        return Promise.resolve({
          ok: false as const,
          error: 'Could not download the o200k_base vocabulary needed for an exact count.',
        });
      }
      if (stallDownload.value) return new Promise<never>(() => {});
      return actual.countExactly(...args);
    },
  };
});

const promptBox = () => screen.getByLabelText(/prompt or document/i);
const stats = () => document.querySelector('.stats')?.textContent ?? '';
const tokenCount = () => document.querySelector('.count-card__value')?.textContent ?? '';
const badge = () => document.querySelector('.count-badge')?.textContent ?? '';
const totalCost = () => document.querySelector('.cost-table__total td')?.textContent ?? '';

const type = (text: string) => fireEvent.input(promptBox(), { target: { value: text } });

// Long enough to overflow o4-mini's 200,000-token window.
const HUGE_PROMPT = 'word '.repeat(210_000);

describe('<TokenCounter />', () => {
  it('starts empty, with a zero count and no error', () => {
    render(<TokenCounter />);

    expect(promptBox()).toHaveValue('');
    expect(tokenCount()).toBe('0');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('counts tokens as you type, labelled as an estimate', () => {
    render(<TokenCounter />);
    type('The quick brown fox jumps over the lazy dog.');

    expect(Number(tokenCount())).toBeGreaterThan(5);
    // The exact count may still be arriving; either way it is labelled as an estimate.
    expect(badge()).toMatch(/^Estimate/);
  });

  it('shows character and word statistics alongside the token count', () => {
    render(<TokenCounter />);
    type('one two three');

    expect(stats()).toContain('13 characters');
    expect(stats()).toContain('3 words');
  });

  it('loads the example prompt and prices it', () => {
    render(<TokenCounter />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    expect((promptBox() as HTMLTextAreaElement).value).toContain('senior technical writer');
    expect(Number(tokenCount())).toBeGreaterThan(50);
    expect(totalCost()).not.toBe('$0.00');
  });

  it('clears the prompt and resets the cost settings', () => {
    render(<TokenCounter />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    fireEvent.input(screen.getByLabelText(/number of calls/i), { target: { value: '999' } });

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(promptBox()).toHaveValue('');
    expect(tokenCount()).toBe('0');
    expect(screen.getByLabelText(/number of calls/i)).toHaveValue(1);
  });

  it('recalculates the cost when the number of calls changes', () => {
    render(<TokenCounter />);
    type('Summarise this document in three bullet points.');
    const single = totalCost();

    fireEvent.input(screen.getByLabelText(/number of calls/i), { target: { value: '10000' } });

    expect(totalCost()).not.toBe(single);
  });

  it('treats a blank or negative call count as zero rather than a negative bill', () => {
    render(<TokenCounter />);
    type('Summarise this document.');

    fireEvent.input(screen.getByLabelText(/number of calls/i), { target: { value: '-5' } });

    expect(totalCost()).toBe('$0.00');
  });

  it('prices the same prompt differently on a different model', () => {
    render(<TokenCounter />);
    type('Summarise this document in three bullet points.');
    const onGpt5 = totalCost();

    fireEvent.change(screen.getByLabelText(/^model$/i), { target: { value: 'claude-opus-5' } });

    expect(totalCost()).not.toBe(onGpt5);
  });

  it('warns prominently that a model with no published tokenizer can only be estimated', () => {
    render(<TokenCounter />);
    fireEvent.change(screen.getByLabelText(/^model$/i), { target: { value: 'claude-sonnet-5' } });

    const warning = document.querySelector('.msg--warning');
    expect(warning).not.toBeNull();
    expect(warning).toHaveTextContent(/Anthropic has not published its tokenizer/i);
    expect(warning).toHaveTextContent(/only possible for OpenAI models/i);
    // The claim has to be emphasised, not buried in a hint line.
    expect(warning?.querySelector('strong')).not.toBeNull();
  });

  it('does not offer exact counting as a choice — there is no toggle to find', () => {
    render(<TokenCounter />);
    expect(screen.queryByLabelText(/exact count/i)).not.toBeInTheDocument();
  });

  it('warns when the prompt is longer than the model can accept', () => {
    render(<TokenCounter />);
    fireEvent.change(screen.getByLabelText(/^model$/i), { target: { value: 'o4-mini' } });
    type(HUGE_PROMPT);

    expect(screen.getByText(/longer than o4-mini can accept/i)).toBeInTheDocument();
  });

  it('seeds the custom rate fields from the selected model, then honours them', () => {
    render(<TokenCounter />);
    type('Summarise this document in three bullet points.');
    const atListPrice = totalCost();

    fireEvent.click(screen.getByLabelText(/use my own rates/i));
    expect(screen.getByLabelText(/input price/i)).toHaveValue(2.5); // GPT-5.4's published rate

    fireEvent.input(screen.getByLabelText(/output price/i), { target: { value: '0' } });
    expect(totalCost()).not.toBe(atListPrice);
  });

  it('copies a report of the count and the cost', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<TokenCounter />);
    type('Summarise this document.');
    fireEvent.click(screen.getByRole('button', { name: /copy report/i }));

    expect(await screen.findByRole('button', { name: /copied/i })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Input tokens:'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Cost per call:'));
  });

  it('lists every model in the comparison table', () => {
    render(<TokenCounter />);
    type('Summarise this document.');

    const compare = document.querySelector<HTMLElement>('.cost-table--compare');
    expect(compare).not.toBeNull();
    expect(within(compare!).getByText(/GPT-5 mini/)).toBeInTheDocument();
    expect(within(compare!).getByText(/Claude Opus 5/)).toBeInTheDocument();
    expect(within(compare!).getByText(/Gemini 3\.1 Pro/)).toBeInTheDocument();
  });
});

describe('<TokenCounter /> exact counting', () => {
  it('counts exactly on its own, with nothing to switch on', async () => {
    render(<TokenCounter />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    // 80 is the real o200k_base count for the example prompt.
    expect(await screen.findByText('80', { selector: '.count-card__value' }, { timeout: 5000 })).toBeInTheDocument();
    expect(badge()).toBe('Exact');
    expect(document.querySelectorAll('.tokens__piece')).toHaveLength(80);
  });

  it('falls back to a labelled estimate when the model has no public tokenizer', async () => {
    render(<TokenCounter />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    await screen.findByText('80', { selector: '.count-card__value' }, { timeout: 5000 });

    fireEvent.change(screen.getByLabelText(/^model$/i), { target: { value: 'claude-sonnet-5' } });

    expect(badge()).toBe('Estimate');
    expect(document.querySelector('.tokens')).not.toBeInTheDocument();
  });

  it('says the vocabulary is downloading rather than letting the number change silently', () => {
    stallDownload.value = true;
    try {
      render(<TokenCounter />);
      fireEvent.click(screen.getByRole('button', { name: /load example/i }));

      // Synchronous: the notice must be on screen for the whole download, not after it.
      const notice = document.querySelector('.msg--info');
      expect(notice).not.toBeNull();
      expect(notice).toHaveTextContent(/downloading/i);
      expect(notice).toHaveTextContent(/o200k_base/);
      expect(badge()).toBe('Estimate — downloading…');
      // The estimate carries the number in the meantime rather than showing nothing.
      expect(Number(tokenCount())).toBeGreaterThan(50);
    } finally {
      stallDownload.value = false;
    }
  });
});

describe('<TokenCounter /> when the vocabulary cannot be downloaded', () => {
  it('shows a visible error and keeps the estimate working', async () => {
    downloadFails.value = true;
    try {
      render(<TokenCounter />);
      fireEvent.click(screen.getByRole('button', { name: /load example/i }));

      const alert = await screen.findByRole('alert', {}, { timeout: 5000 });
      expect(alert).toHaveTextContent(/could not download/i);
      // The count is still there — it just falls back to the estimate.
      expect(badge()).toBe('Estimate');
      expect(Number(tokenCount())).toBeGreaterThan(50);
    } finally {
      downloadFails.value = false;
    }
  });
});
