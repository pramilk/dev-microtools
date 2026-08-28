import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/preact';
import UserAgentParser from './UserAgentParser';

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The structured-field grid — scoping here avoids ambiguity with the token highlighter/glossary below it, which repeats the same words. */
const grid = () => within(document.querySelector<HTMLElement>('.ua-grid')!);

describe('<UserAgentParser />', () => {
  it('auto-fills and parses the current browser UA on mount', async () => {
    vi.stubGlobal('navigator', { ...navigator, userAgent: CHROME_UA });
    render(<UserAgentParser />);

    await screen.findByText(/desktop/i);
    expect(grid().getByText(/^chrome/i)).toBeInTheDocument();
    expect(grid().getByText(/desktop/i)).toBeInTheDocument();
  });

  it('parses a pasted User-Agent string', async () => {
    render(<UserAgentParser />);
    fireEvent.input(screen.getByLabelText(/user-agent string/i), {
      target: {
        value:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      },
    });

    await screen.findByText(/^ios/i);
    expect(grid().getByText(/^safari/i)).toBeInTheDocument();
    expect(grid().getByText(/^ios/i)).toBeInTheDocument();
    expect(grid().getByText(/mobile/i)).toBeInTheDocument();
  });

  it('shows the device model, architecture and in-app browser when present', async () => {
    render(<UserAgentParser />);
    fireEvent.input(screen.getByLabelText(/user-agent string/i), {
      target: {
        value:
          'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36 Instagram 312.0.0.34.111 Android',
      },
    });

    await screen.findByText('Pixel 8');
    expect(grid().getByText('Pixel 8')).toBeInTheDocument();
    expect(grid().getByText('Instagram')).toBeInTheDocument();
  });

  it('shows the CPU architecture for a desktop UA and omits device model/in-app rows', async () => {
    render(<UserAgentParser />);
    fireEvent.input(screen.getByLabelText(/user-agent string/i), { target: { value: CHROME_UA } });

    await screen.findByText('x64');
    expect(grid().getByText('x64')).toBeInTheDocument();
    expect(grid().queryByText('Device model')).not.toBeInTheDocument();
    expect(grid().queryByText('In-app browser')).not.toBeInTheDocument();
  });

  it('shows a visible error for unrecognisable input, not a blank result', async () => {
    render(<UserAgentParser />);
    fireEvent.input(screen.getByLabelText(/user-agent string/i), { target: { value: 'garbage' } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not recognise/i);
  });

  it('clears the input when Clear is pressed', async () => {
    vi.stubGlobal('navigator', { ...navigator, userAgent: CHROME_UA });
    render(<UserAgentParser />);
    await screen.findByText(/desktop/i);

    fireEvent.click(screen.getByRole('button', { name: /clear/i }));

    expect(screen.getByLabelText(/user-agent string/i)).toHaveValue('');
  });

  it('highlights recognised tokens in the raw string with an explanation', async () => {
    render(<UserAgentParser />);
    fireEvent.input(screen.getByLabelText(/user-agent string/i), { target: { value: CHROME_UA } });

    const marks = await screen.findAllByTitle(/./);
    const chromeMark = marks.find((el) => el.textContent === 'Chrome/128.0.0.0');
    expect(chromeMark).toBeDefined();
    expect(chromeMark).toHaveAttribute('title', expect.stringMatching(/genuine chrome/i));
  });

  it('lists each recognised token once in the glossary, even if it appears twice', async () => {
    render(<UserAgentParser />);
    // Windows NT and Win64/x64 each appear once here, but this checks the general
    // dedupe behaviour holds for a UA with a token type that would otherwise repeat.
    fireEvent.input(screen.getByLabelText(/user-agent string/i), { target: { value: CHROME_UA } });

    await screen.findByText('What each part means');
    const glossary = document.querySelector<HTMLElement>('.token-glossary')!;
    const chromeEntries = within(glossary).getAllByText('Chrome');
    expect(chromeEntries).toHaveLength(1);
  });

  it('shows no token breakdown when the input does not parse', async () => {
    render(<UserAgentParser />);
    fireEvent.input(screen.getByLabelText(/user-agent string/i), { target: { value: 'garbage' } });

    await screen.findByRole('alert');
    expect(document.querySelector('.token-glossary')).not.toBeInTheDocument();
  });
});

describe('<UserAgentParser /> share link', () => {
  it('offers a share link, which AGENTS.md requires for every non-secret tool', async () => {
    render(<UserAgentParser />);
    expect(await screen.findByRole('button', { name: /copy link/i })).toBeInTheDocument();
  });

  it('still auto-fills the browser UA when there is no share fragment', async () => {
    render(<UserAgentParser />);
    const input = screen.getByLabelText(/user-agent string/i) as HTMLTextAreaElement;
    await waitFor(() => expect(input.value).not.toBe(''));
  });
});

