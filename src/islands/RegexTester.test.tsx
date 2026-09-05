import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { createFakeWorkerClass } from '../../test/fakeWorker';
import { handleRegexRequest } from '../workers/regex.worker';
import RegexTester from './RegexTester';

// jsdom has no real Worker; this runs the same request-handling logic the real
// regex.worker.ts uses, synchronously, so the test still exercises real regex execution.
vi.mock('../workers/regex.worker?worker', () => ({
  default: createFakeWorkerClass(handleRegexRequest),
}));

const typeInto = (element: HTMLElement, value: string) => {
  fireEvent.input(element, { target: { value } });
};

describe('<RegexTester />', () => {
  it('highlights matches in the test string', async () => {
    render(<RegexTester />);
    typeInto(screen.getByLabelText(/regular expression/i), '\\d+');
    typeInto(screen.getByLabelText(/test string/i), 'a1 b22');

    const marks = await screen.findAllByText(/^\d+$/, { selector: 'mark' });
    expect(marks.map((m) => m.textContent)).toEqual(['1', '22']);
  });

  it('reports the match count', async () => {
    render(<RegexTester />);
    typeInto(screen.getByLabelText(/regular expression/i), '\\d');
    typeInto(screen.getByLabelText(/test string/i), '123');

    expect(await screen.findByText('3 matches')).toBeInTheDocument();
  });

  it('shows an error for an invalid pattern instead of crashing', async () => {
    render(<RegexTester />);
    typeInto(screen.getByLabelText(/regular expression/i), '[unclosed');
    typeInto(screen.getByLabelText(/test string/i), 'abc');

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('refuses a catastrophic-backtracking pattern instead of freezing the tab', async () => {
    render(<RegexTester />);
    typeInto(screen.getByLabelText(/regular expression/i), '(a+)+$');
    typeInto(screen.getByLabelText(/test string/i), 'a'.repeat(40) + '!');

    expect(await screen.findByRole('alert')).toHaveTextContent(/exponentially|freeze/i);
  });

  it('warns when a pattern can match an empty string', async () => {
    render(<RegexTester />);
    typeInto(screen.getByLabelText(/regular expression/i), 'a*');
    typeInto(screen.getByLabelText(/test string/i), 'bbb');

    expect(await screen.findByText(/match an empty string/i)).toBeInTheDocument();
  });

  it('displays named capture groups', async () => {
    render(<RegexTester />);
    typeInto(screen.getByLabelText(/regular expression/i), '(?<year>\\d{4})');
    typeInto(screen.getByLabelText(/test string/i), '2026');

    // "year" now appears both as the pattern-breakdown badge and the match-details label.
    const occurrences = await screen.findAllByText('year');
    expect(occurrences.length).toBeGreaterThan(0);
  });

  it('respects the case-insensitive flag', async () => {
    render(<RegexTester />);
    typeInto(screen.getByLabelText(/regular expression/i), 'abc');
    typeInto(screen.getByLabelText(/test string/i), 'ABC abc');

    expect(await screen.findByText('1 match')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /ignore case/i }));
    expect(await screen.findByText('2 matches')).toBeInTheDocument();
  });

  it('previews a replacement with back-references', async () => {
    render(<RegexTester />);
    typeInto(screen.getByLabelText(/regular expression/i), '(\\w+)@(\\w+)');
    typeInto(screen.getByLabelText(/test string/i), 'user@host');

    fireEvent.click(screen.getByLabelText(/show replace/i));
    typeInto(await screen.findByLabelText(/replacement/i), '$2:$1');

    expect(await screen.findByText('host:user')).toBeInTheDocument();
  });

  it('loads a working sample', async () => {
    render(<RegexTester />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    expect(await screen.findByText('2 matches')).toBeInTheDocument();
  });

  it('loads a common pattern from the presets menu', async () => {
    render(<RegexTester />);
    fireEvent.change(screen.getByLabelText(/load a common pattern/i), { target: { value: 'ipv4' } });

    expect((screen.getByLabelText(/regular expression/i) as HTMLInputElement).value).toMatch(/\\d\{1,3\}/);
    expect(await screen.findByText('2 matches')).toBeInTheDocument();
  });

  it('tints capturing groups in the pattern and pairs the tint with match details', async () => {
    render(<RegexTester />);
    typeInto(screen.getByLabelText(/regular expression/i), '(?<year>\\d{4})-(?<month>\\d{2})');
    typeInto(screen.getByLabelText(/test string/i), '2026-08');

    expect(await screen.findByText('Pattern groups')).toBeInTheDocument();
    const badges = screen.getAllByText('year');
    expect(badges.length).toBeGreaterThan(0);
    expect(screen.getAllByText('month').length).toBeGreaterThan(0);
  });

  it('warns when the pattern uses another regex flavour\'s syntax', async () => {
    render(<RegexTester />);
    typeInto(screen.getByLabelText(/regular expression/i), '(?P<year>\\d{4})');

    expect(await screen.findByText(/Python\/PCRE syntax/i)).toBeInTheDocument();
  });

  it('explains the pattern in plain English when asked', async () => {
    render(<RegexTester />);
    typeInto(screen.getByLabelText(/regular expression/i), '\\d+');

    fireEvent.click(screen.getByLabelText(/explain this pattern/i));
    expect(await screen.findByText(/digit/i)).toBeInTheDocument();
  });

  it('reports an explanation error for an invalid pattern', async () => {
    render(<RegexTester />);
    typeInto(screen.getByLabelText(/regular expression/i), '[unclosed');
    fireEvent.click(screen.getByLabelText(/explain this pattern/i));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('shows a status line confirming the selected flavour, even when nothing needs translating', async () => {
    render(<RegexTester />);
    expect(screen.getByText(/running as javascript/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/regex flavour/i), { target: { value: 'go' } });
    typeInto(screen.getByLabelText(/regular expression/i), '[0-9]+');

    // Honest about doing nothing: an ordinary pattern needs no translation under most
    // flavours, and claiming one happened anyway would be misleading busywork-theatre.
    expect(screen.getByText(/identical to javascript here/i)).toBeInTheDocument();
    expect(screen.queryByText(/running as javascript/i)).not.toBeInTheDocument();
  });

  it('says a pattern was actually translated only once something changed', async () => {
    render(<RegexTester />);
    fireEvent.change(screen.getByLabelText(/regex flavour/i), { target: { value: 'pcre' } });
    typeInto(screen.getByLabelText(/regular expression/i), '(?P<year>\\d{4})');

    expect(await screen.findByText(/translated before running/i)).toBeInTheDocument();
    expect(screen.queryByText(/identical to javascript here/i)).not.toBeInTheDocument();
  });

  it('says a Go-incompatible pattern cannot be translated, in the status line too', async () => {
    render(<RegexTester />);
    fireEvent.change(screen.getByLabelText(/regex flavour/i), { target: { value: 'go' } });
    typeInto(screen.getByLabelText(/regular expression/i), 'foo(?=bar)');

    expect(await screen.findByText(/can't be translated/i)).toBeInTheDocument();
  });

  it('translates PCRE named-group syntax and runs it once the PCRE flavour is selected', async () => {
    render(<RegexTester />);
    fireEvent.change(screen.getByLabelText(/regex flavour/i), { target: { value: 'pcre' } });
    typeInto(screen.getByLabelText(/regular expression/i), '(?P<year>\\d{4})');
    typeInto(screen.getByLabelText(/test string/i), 'Born 1990');

    expect(await screen.findByText('1 match')).toBeInTheDocument();
    expect(screen.getByText('year')).toBeInTheDocument();
    expect(screen.getAllByText('1990').length).toBeGreaterThan(0);
    // Once a flavour is picked, the same syntax is translated rather than flagged.
    expect(screen.queryByText(/Python\/PCRE syntax/i)).not.toBeInTheDocument();
  });

  it('shows an approximation note once a non-JavaScript flavour translates something', async () => {
    render(<RegexTester />);
    fireEvent.change(screen.getByLabelText(/regex flavour/i), { target: { value: 'pcre' } });
    typeInto(screen.getByLabelText(/regular expression/i), '(?P<year>\\d{4})');

    expect(await screen.findByText(/named group/i)).toBeInTheDocument();
  });

  it("rejects a Go-incompatible construct with a clear error naming RE2's constraint", async () => {
    render(<RegexTester />);
    fireEvent.change(screen.getByLabelText(/regex flavour/i), { target: { value: 'go' } });
    typeInto(screen.getByLabelText(/regular expression/i), 'foo(?=bar)');
    typeInto(screen.getByLabelText(/test string/i), 'foobar');

    expect(await screen.findByRole('alert')).toHaveTextContent(/RE2/i);
  });

  it('resets the flavour to JavaScript when Clear is pressed', async () => {
    render(<RegexTester />);
    const flavorSelect = screen.getByLabelText(/regex flavour/i) as HTMLSelectElement;
    fireEvent.change(flavorSelect, { target: { value: 'python' } });
    typeInto(screen.getByLabelText(/regular expression/i), 'abc');

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    await waitFor(() => expect(flavorSelect.value).toBe('javascript'));
  });

  it('tests a list of lines independently and reports pass/fail per line', async () => {
    render(<RegexTester />);
    typeInto(screen.getByLabelText(/regular expression/i), '^\\d+$');

    fireEvent.click(screen.getByLabelText(/test a list of lines/i));
    typeInto(screen.getByLabelText(/one item per line/i), '123\nabc');

    expect(await screen.findByText('1 of 2 match')).toBeInTheDocument();
    expect(screen.getByText('123')).toBeInTheDocument();
    expect(screen.getByText('abc')).toBeInTheDocument();
  });
});

describe('<RegexTester /> copy and clear', () => {
  it('copies every match as one per line', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<RegexTester />);
    typeInto(screen.getByLabelText(/regular expression/i), '\\d+');
    typeInto(screen.getByLabelText(/test string/i), 'a1 b22 c333');
    await screen.findByText('3 matches');

    fireEvent.click(screen.getByRole('button', { name: /copy matches/i }));
    expect(writeText).toHaveBeenCalledWith('1\n22\n333');
  });

  it('copies matches beyond the 100 the list renders', async () => {
    // The list caps at 100 cards; the copy must not inherit that display-only limit.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<RegexTester />);
    typeInto(screen.getByLabelText(/regular expression/i), 'x');
    typeInto(screen.getByLabelText(/test string/i), 'x'.repeat(150));
    await screen.findByText('150 matches');

    fireEvent.click(screen.getByRole('button', { name: /copy matches/i }));
    expect(writeText).toHaveBeenCalledWith(Array(150).fill('x').join('\n'));
  });

  it('offers no match copy control until there is something to copy', () => {
    render(<RegexTester />);
    expect(screen.queryByRole('button', { name: /copy matches/i })).not.toBeInTheDocument();
  });

  it('clears the pattern, flags and every text field', async () => {
    render(<RegexTester />);
    typeInto(screen.getByLabelText(/regular expression/i), 'abc');
    typeInto(screen.getByLabelText(/test string/i), 'ABC abc');
    fireEvent.click(screen.getByRole('button', { name: /ignore case/i }));
    fireEvent.click(screen.getByLabelText(/test a list of lines/i));
    typeInto(await screen.findByLabelText(/one item per line/i), 'abc');
    await screen.findByText('2 matches');

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    await waitFor(() => {
      expect((screen.getByLabelText(/regular expression/i) as HTMLInputElement).value).toBe('');
    });
    expect((screen.getByLabelText(/test string/i) as HTMLTextAreaElement).value).toBe('');
    expect((screen.getByLabelText(/one item per line/i) as HTMLTextAreaElement).value).toBe('');
    // Flags go back to the default the page starts with, not whatever was last toggled.
    expect(screen.getByRole('button', { name: /ignore case/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /global/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText(/matches?$/)).not.toBeInTheDocument();
  });

  it('keeps open panels open when clearing, since those are a layout choice', async () => {
    render(<RegexTester />);
    fireEvent.click(screen.getByLabelText(/show replace/i));
    typeInto(screen.getByLabelText(/regular expression/i), 'abc');
    typeInto(await screen.findByLabelText(/replacement/i), 'X');

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    await waitFor(() => {
      expect((screen.getByLabelText(/replacement/i) as HTMLInputElement).value).toBe('');
    });
    expect(screen.getByLabelText(/replacement/i)).toBeInTheDocument();
  });

  it('disables Clear while there is nothing to clear', async () => {
    render(<RegexTester />);
    expect(screen.getByRole('button', { name: /^clear$/i })).toBeDisabled();

    typeInto(screen.getByLabelText(/regular expression/i), 'a');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^clear$/i })).toBeEnabled();
    });
  });
});

describe('<RegexTester /> share link', () => {
  it('restores a pattern and subject from a shared link on load', async () => {
    const { encodeShareState } = await import('../lib/shareLink');
    const encoded = await encodeShareState({
      pattern: '\\d+',
      flags: 'g',
      subject: 'a1 b22',
      replacement: '',
    });
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    window.location.hash = `#s=${encoded.value}`;
    render(<RegexTester />);

    expect(await screen.findByText('2 matches')).toBeInTheDocument();
    window.location.hash = '';
  });

  it('restores the selected flavour from a shared link', async () => {
    const { encodeShareState } = await import('../lib/shareLink');
    const encoded = await encodeShareState({
      pattern: '(?P<year>\\d{4})',
      flags: 'g',
      flavor: 'pcre',
      subject: 'Born 1990',
      replacement: '',
    });
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    window.location.hash = `#s=${encoded.value}`;
    render(<RegexTester />);

    expect(await screen.findByText('1 match')).toBeInTheDocument();
    expect((screen.getByLabelText(/regex flavour/i) as HTMLSelectElement).value).toBe('pcre');
    window.location.hash = '';
  });
});

describe('<RegexTester /> file drop', () => {
  it('fills the test string from a file dropped directly onto its textarea', async () => {
    render(<RegexTester />);
    const file = new File(['dropped subject'], 'subject.txt', { type: 'text/plain' });

    fireEvent.drop(screen.getByLabelText(/test string/i), { dataTransfer: { files: [file] } });

    await waitFor(() => {
      expect((screen.getByLabelText(/test string/i) as HTMLTextAreaElement).value).toBe('dropped subject');
    });
  });
});
