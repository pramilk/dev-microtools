import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import RegexTester from './RegexTester';

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
    fireEvent.click(screen.getByRole('button', { name: /load sample/i }));

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
