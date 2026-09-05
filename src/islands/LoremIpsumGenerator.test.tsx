import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/preact';
import LoremIpsumGenerator from './LoremIpsumGenerator';

const output = () => within(document.querySelector<HTMLElement>('.output')!);

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});

describe('<LoremIpsumGenerator />', () => {
  it('generates text immediately with sensible defaults, not an empty state', () => {
    render(<LoremIpsumGenerator />);

    expect(document.querySelector('.output--empty')).not.toBeInTheDocument();
    expect(output().getByText(/lorem ipsum dolor sit amet/i)).toBeInTheDocument();
  });

  it('regenerates with the requested word count when switching units', () => {
    render(<LoremIpsumGenerator />);

    fireEvent.change(screen.getByLabelText(/^unit$/i), { target: { value: 'words' } });
    fireEvent.input(screen.getByLabelText(/^count$/i), { target: { value: '10' } });

    const text = output().getByText((_, el) => el?.tagName === 'PRE').textContent!;
    expect(text.trim().split(/\s+/)).toHaveLength(10);
  });

  it('drops the classic opening when "Start with Lorem ipsum…" is unchecked', () => {
    render(<LoremIpsumGenerator />);
    expect(output().getByText(/^Lorem ipsum dolor sit amet/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: /start with/i }));

    const text = output().getByText((_, el) => el?.tagName === 'PRE').textContent!;
    expect(text.startsWith('Lorem ipsum dolor sit amet')).toBe(false);
  });

  it('wraps output in <p> tags when HTML output is checked', () => {
    render(<LoremIpsumGenerator />);
    fireEvent.click(screen.getByRole('checkbox', { name: /html output/i }));

    const text = output().getByText((_, el) => el?.tagName === 'PRE').textContent!;
    expect(text).toContain('<p>');
    expect(text).toContain('</p>');
  });

  it('shows a visible error for an out-of-range count', () => {
    render(<LoremIpsumGenerator />);
    fireEvent.input(screen.getByLabelText(/^count$/i), { target: { value: '0' } });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(document.querySelector('.output--empty')).toBeInTheDocument();
  });

  it('shows a live word and character count of the generated output', () => {
    render(<LoremIpsumGenerator />);

    fireEvent.change(screen.getByLabelText(/^unit$/i), { target: { value: 'words' } });
    fireEvent.input(screen.getByLabelText(/^count$/i), { target: { value: '10' } });

    const text = output().getByText((_, el) => el?.tagName === 'PRE').textContent!;
    expect(screen.getByText(`10 words · ${text.length} characters`)).toBeInTheDocument();
  });

  it('hides the word/character count when the output is empty', () => {
    render(<LoremIpsumGenerator />);
    fireEvent.input(screen.getByLabelText(/^count$/i), { target: { value: '0' } });

    expect(screen.queryByText(/words ·/)).not.toBeInTheDocument();
  });
});
