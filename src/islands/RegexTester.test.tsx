import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
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

    expect(await screen.findByText('year')).toBeInTheDocument();
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
