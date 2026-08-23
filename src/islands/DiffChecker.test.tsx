import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import DiffChecker from './DiffChecker';

const typeInto = (element: HTMLElement, value: string) => {
  fireEvent.input(element, { target: { value } });
};

describe('<DiffChecker />', () => {
  it('reports identical texts as identical', async () => {
    render(<DiffChecker />);
    typeInto(screen.getByLabelText(/original/i), 'same');
    typeInto(screen.getByLabelText(/compare with/i), 'same');

    expect(await screen.findByText(/texts are identical/i)).toBeInTheDocument();
  });

  it('shows added and removed counts when texts differ', async () => {
    render(<DiffChecker />);
    typeInto(screen.getByLabelText(/original/i), 'a\nb\n');
    typeInto(screen.getByLabelText(/compare with/i), 'a\nc\n');

    // Scoped to the stats row, since the legend below also contains "added".
    const stats = await screen.findByText(/added/, { selector: '.stats__item' });
    expect(stats).toHaveTextContent('+1');
    expect(screen.getByText(/removed/, { selector: '.stats__item' })).toHaveTextContent('1');
  });

  it('treats equivalent JSON as identical in JSON mode', async () => {
    render(<DiffChecker />);
    fireEvent.click(screen.getByRole('button', { name: /^json$/i }));
    typeInto(screen.getByLabelText(/original/i), '{"b":2,"a":1}');
    typeInto(screen.getByLabelText(/compare with/i), '{"a":1,"b":2}');

    expect(await screen.findByText(/equivalent json/i)).toBeInTheDocument();
  });

  it('names which side of a JSON comparison failed to parse', async () => {
    render(<DiffChecker />);
    fireEvent.click(screen.getByRole('button', { name: /^json$/i }));
    typeInto(screen.getByLabelText(/original/i), 'nope');
    typeInto(screen.getByLabelText(/compare with/i), '{"a":1}');

    expect(await screen.findByRole('alert')).toHaveTextContent(/left/i);
  });

  it('detects a real value change in JSON mode', async () => {
    render(<DiffChecker />);
    fireEvent.click(screen.getByRole('button', { name: /^json$/i }));
    typeInto(screen.getByLabelText(/original/i), '{"a":1}');
    typeInto(screen.getByLabelText(/compare with/i), '{"a":2}');

    expect(await screen.findByText(/^differences$/i)).toBeInTheDocument();
  });

  it('can ignore case when comparing text', async () => {
    render(<DiffChecker />);
    typeInto(screen.getByLabelText(/original/i), 'Hello');
    typeInto(screen.getByLabelText(/compare with/i), 'hello');
    await screen.findByText(/^differences$/i);

    fireEvent.click(screen.getByLabelText(/ignore case/i));
    expect(await screen.findByText(/texts are identical/i)).toBeInTheDocument();
  });

  it('clears both panes', async () => {
    render(<DiffChecker />);
    const left = screen.getByLabelText(/original/i) as HTMLTextAreaElement;
    typeInto(left, 'content');
    await screen.findByText(/^differences$/i);

    fireEvent.click(screen.getByRole('button', { name: /clear both/i }));
    expect(left.value).toBe('');
  });

  it('loads a plain-text worked example when in Text mode', async () => {
    render(<DiffChecker />);
    fireEvent.click(screen.getByRole('button', { name: /load sample/i }));

    const left = screen.getByLabelText(/original/i) as HTMLTextAreaElement;
    const right = screen.getByLabelText(/compare with/i) as HTMLTextAreaElement;
    expect(left.value).not.toBe('');
    expect(left.value).not.toContain('{');
    expect(right.value).not.toBe('');
    expect(await screen.findByText(/^differences$/i)).toBeInTheDocument();
  });

  it('loads a JSON worked example when in JSON mode', async () => {
    render(<DiffChecker />);
    fireEvent.click(screen.getByRole('button', { name: /^json$/i }));
    fireEvent.click(screen.getByRole('button', { name: /load sample/i }));

    const left = screen.getByLabelText(/original/i) as HTMLTextAreaElement;
    const right = screen.getByLabelText(/compare with/i) as HTMLTextAreaElement;
    expect(left.value).toContain('{');
    expect(right.value).toContain('{');
    expect(await screen.findByText(/^differences$/i)).toBeInTheDocument();
  });

  it('offers a side-by-side layout for a line-level comparison', async () => {
    render(<DiffChecker />);
    typeInto(screen.getByLabelText(/original/i), 'a\nb\n');
    typeInto(screen.getByLabelText(/compare with/i), 'a\nc\n');
    await screen.findByText(/^differences$/i);

    fireEvent.click(screen.getByRole('button', { name: /side by side/i }));
    expect(screen.getByLabelText(/differences, shown in two aligned columns/i)).toBeInTheDocument();
  });

  it('disables side-by-side for a word-level comparison', async () => {
    render(<DiffChecker />);
    fireEvent.click(screen.getByRole('button', { name: /by word/i }));
    typeInto(screen.getByLabelText(/original/i), 'the quick fox');
    typeInto(screen.getByLabelText(/compare with/i), 'the slow fox');
    await screen.findByText(/^differences$/i);

    expect(screen.getByRole('button', { name: /side by side/i })).toBeDisabled();
  });
});

describe('<DiffChecker /> share link and download', () => {
  it('offers a download button once there are differences', async () => {
    render(<DiffChecker />);
    typeInto(screen.getByLabelText(/original/i), 'a\nb\n');
    typeInto(screen.getByLabelText(/compare with/i), 'a\nc\n');

    expect(await screen.findByRole('button', { name: /download/i })).not.toBeDisabled();
  });

  it('restores both panes from a shared link on load', async () => {
    const { encodeShareState } = await import('../lib/shareLink');
    const encoded = await encodeShareState({
      left: 'shared left',
      right: 'shared right',
      kind: 'text',
      mode: 'line',
      ignoreCase: false,
      ignoreWhitespace: false,
    });
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    window.location.hash = `#s=${encoded.value}`;
    render(<DiffChecker />);

    const left = screen.getByLabelText(/original/i) as HTMLTextAreaElement;
    const right = screen.getByLabelText(/compare with/i) as HTMLTextAreaElement;
    await waitFor(() => {
      expect(left.value).toBe('shared left');
      expect(right.value).toBe('shared right');
    });
    window.location.hash = '';
  });
});
