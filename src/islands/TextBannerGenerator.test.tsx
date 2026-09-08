import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/preact';
import TextBannerGenerator from './TextBannerGenerator';

const output = () => within(document.querySelector<HTMLElement>('.output')!);

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});

describe('<TextBannerGenerator />', () => {
  it('shows the empty placeholder before any text is entered', () => {
    render(<TextBannerGenerator />);
    expect(document.querySelector('.output--empty')).toBeInTheDocument();
  });

  it('renders a banner as soon as text is typed', () => {
    render(<TextBannerGenerator />);
    fireEvent.input(screen.getByPlaceholderText(/type or paste text here/i), { target: { value: 'HI' } });

    expect(document.querySelector('.output--empty')).not.toBeInTheDocument();
    const text = output().getByText((_, el) => el?.tagName === 'PRE').textContent!;
    expect(text).toContain('█');
  });

  it('loads the sample text on "Load example"', () => {
    render(<TextBannerGenerator />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    expect(screen.getByPlaceholderText(/type or paste text here/i)).toHaveValue('HELLO WORLD');
    expect(document.querySelector('.output--empty')).not.toBeInTheDocument();
  });

  it('clears the input and disables Clear when there is nothing to clear', () => {
    render(<TextBannerGenerator />);
    const clearBtn = screen.getByRole('button', { name: /^clear$/i });
    expect(clearBtn).toBeDisabled();

    fireEvent.input(screen.getByPlaceholderText(/type or paste text here/i), { target: { value: 'HI' } });
    expect(clearBtn).toBeEnabled();

    fireEvent.click(clearBtn);
    expect(screen.getByPlaceholderText(/type or paste text here/i)).toHaveValue('');
    expect(document.querySelector('.output--empty')).toBeInTheDocument();
  });

  it('switches the fill character when a preset is clicked', () => {
    render(<TextBannerGenerator />);
    fireEvent.input(screen.getByPlaceholderText(/type or paste text here/i), { target: { value: 'HI' } });

    fireEvent.click(screen.getByRole('button', { name: 'Hash' }));

    const text = output().getByText((_, el) => el?.tagName === 'PRE').textContent!;
    expect(text).toContain('#');
    expect(text).not.toContain('█');
  });

  it('reveals a custom fill character field and uses it once selected', () => {
    render(<TextBannerGenerator />);
    fireEvent.input(screen.getByPlaceholderText(/type or paste text here/i), { target: { value: 'HI' } });

    fireEvent.click(screen.getByRole('button', { name: /^custom$/i }));
    const customInput = screen.getByLabelText(/^character$/i);
    fireEvent.input(customInput, { target: { value: '+' } });

    const text = output().getByText((_, el) => el?.tagName === 'PRE').textContent!;
    expect(text).toContain('+');
  });

  it('shows a visible error, not a crash, for a blank custom fill character', () => {
    render(<TextBannerGenerator />);
    fireEvent.input(screen.getByPlaceholderText(/type or paste text here/i), { target: { value: 'HI' } });
    fireEvent.click(screen.getByRole('button', { name: /^custom$/i }));

    fireEvent.input(screen.getByLabelText(/^character$/i), { target: { value: '' } });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(document.querySelector('.output--empty')).toBeInTheDocument();
  });

  it('warns about characters the font does not support, without breaking the render', () => {
    render(<TextBannerGenerator />);
    fireEvent.input(screen.getByPlaceholderText(/type or paste text here/i), { target: { value: 'HI~' } });

    expect(screen.getByText(/isn.t in the built-in font/i)).toBeInTheDocument();
    expect(document.querySelector('.output--empty')).not.toBeInTheDocument();
  });

  it('increases the banner size when the Size slider is raised', () => {
    render(<TextBannerGenerator />);
    fireEvent.input(screen.getByPlaceholderText(/type or paste text here/i), { target: { value: 'I' } });
    const before = output().getByText((_, el) => el?.tagName === 'PRE').textContent!.split('\n').length;

    fireEvent.input(screen.getByLabelText(/^size$/i), { target: { value: '3' } });

    const after = output().getByText((_, el) => el?.tagName === 'PRE').textContent!.split('\n').length;
    expect(after).toBe(before * 3);
  });

  it('restores state from a share link', async () => {
    const { buildShareUrl } = await import('../lib/shareLink');
    const shared = await buildShareUrl('https://example.com/text-banner-generator', {
      text: 'HI',
      fillId: 'hash',
      customFillChar: '$',
      scale: 2,
      letterSpacing: 0,
    });
    expect(shared.ok).toBe(true);
    if (!shared.ok) return;
    const hash = shared.value.slice(shared.value.indexOf('#'));
    window.history.replaceState(null, '', hash);

    render(<TextBannerGenerator />);

    await screen.findByDisplayValue('HI');
    expect(screen.getByLabelText(/^size$/i)).toHaveValue('2');
  });
});
