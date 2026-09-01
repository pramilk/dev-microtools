import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import InvisibleCharInspector from './InvisibleCharInspector';

// Built from code points rather than pasted as raw glyphs — see the comment at the top
// of invisibleChars.test.ts for why.
const cp = (codePoint: number): string => String.fromCodePoint(codePoint);
const ZWSP = cp(0x200b);
const NBSP = cp(0x00a0);
const CYRILLIC_A = cp(0x0430);

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});

describe('<InvisibleCharInspector />', () => {
  it('starts empty with a prompt instead of findings', () => {
    render(<InvisibleCharInspector />);

    expect(screen.getByLabelText(/text to inspect/i)).toHaveValue('');
    expect(screen.getByText(/findings appear here/i)).toBeInTheDocument();
  });

  it('shows a success message for plain text with nothing flagged', () => {
    render(<InvisibleCharInspector />);
    fireEvent.input(screen.getByLabelText(/text to inspect/i), { target: { value: 'hello world' } });

    expect(screen.getByText(/no invisible characters/i)).toBeInTheDocument();
  });

  it('flags a zero-width space and shows it in the category badges', () => {
    render(<InvisibleCharInspector />);
    fireEvent.input(screen.getByLabelText(/text to inspect/i), { target: { value: `a${ZWSP}b` } });

    expect(screen.getByTestId('ic-stats')).toHaveTextContent(/1 flagged character/i);
    expect(screen.getByText('Invisible')).toBeInTheDocument();
  });

  it('strips the zero-width space from the cleaned output by default', () => {
    render(<InvisibleCharInspector />);
    fireEvent.input(screen.getByLabelText(/text to inspect/i), { target: { value: `a${ZWSP}b` } });

    expect(screen.getByText('ab')).toBeInTheDocument();
  });

  it('leaves a homoglyph untouched in the cleaned output until the checkbox is ticked', () => {
    render(<InvisibleCharInspector />);
    const text = `p${CYRILLIC_A}ypal.com`;
    fireEvent.input(screen.getByLabelText(/text to inspect/i), { target: { value: text } });

    expect(screen.getByText(text)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: /homoglyph/i }));
    expect(screen.getByText('paypal.com')).toBeInTheDocument();
  });

  it('normalizes a non-breaking space to a plain space by default', () => {
    render(<InvisibleCharInspector />);
    fireEvent.input(screen.getByLabelText(/text to inspect/i), { target: { value: `a${NBSP}b` } });

    expect(screen.getByText('a b')).toBeInTheDocument();
  });

  it('leaves a category untouched when its checkbox is unticked', () => {
    render(<InvisibleCharInspector />);
    const text = `a${ZWSP}b`;
    fireEvent.input(screen.getByLabelText(/text to inspect/i), { target: { value: text } });
    fireEvent.click(screen.getByRole('checkbox', { name: /^invisible/i }));

    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('disables a category checkbox when nothing in that category was found', () => {
    render(<InvisibleCharInspector />);
    fireEvent.input(screen.getByLabelText(/text to inspect/i), { target: { value: `a${ZWSP}b` } });

    expect(screen.getByRole('checkbox', { name: /^bidi/i })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /^invisible/i })).not.toBeDisabled();
  });

  it('loads the sample text when "Load example" is pressed, with findings detected', () => {
    render(<InvisibleCharInspector />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    expect((screen.getByLabelText(/text to inspect/i) as HTMLTextAreaElement).value).not.toBe('');
    expect(screen.getByTestId('ic-stats')).toHaveTextContent(/flagged character/i);
  });

  it('fills the text area from a file dropped directly onto it', async () => {
    render(<InvisibleCharInspector />);
    const file = new File(['dropped file contents'], 'notes.txt', { type: 'text/plain' });

    fireEvent.drop(screen.getByLabelText(/text to inspect/i), { dataTransfer: { files: [file] } });

    expect(await screen.findByDisplayValue('dropped file contents')).toBeInTheDocument();
  });

  it('clears the input when Clear is pressed', () => {
    render(<InvisibleCharInspector />);
    fireEvent.input(screen.getByLabelText(/text to inspect/i), { target: { value: `a${ZWSP}b` } });
    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(screen.getByLabelText(/text to inspect/i)).toHaveValue('');
    expect(screen.getByText(/findings appear here/i)).toBeInTheDocument();
  });
});
