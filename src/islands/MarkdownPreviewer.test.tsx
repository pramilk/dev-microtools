import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/preact';
import MarkdownPreviewer from './MarkdownPreviewer';
import { MAX_INPUT_LENGTH } from '../lib/tools/markdownPreview';

const input = () => document.getElementById('markdown-input') as HTMLTextAreaElement;
const iframe = () => document.querySelector<HTMLIFrameElement>('.md-preview-frame');
const sourcePane = () => within(document.querySelector<HTMLElement>('.output')!);

describe('<MarkdownPreviewer />', () => {
  it('starts empty with a placeholder in both panes', () => {
    render(<MarkdownPreviewer />);

    expect(input()).toHaveValue('');
    expect(document.querySelector('.output--empty')).toBeInTheDocument();
    expect(iframe()).not.toBeInTheDocument();
  });

  it('renders typed Markdown as a live HTML preview by default', async () => {
    render(<MarkdownPreviewer />);

    fireEvent.input(input(), { target: { value: '# Hello\n\nSome **bold** text.' } });

    await screen.findByTitle(/rendered markdown preview/i);
    const frame = iframe()!;
    expect(frame.getAttribute('srcdoc')).toContain('<h1>Hello</h1>');
    expect(frame.getAttribute('srcdoc')).toContain('<strong>bold</strong>');
  });

  it('shows the generated HTML as text in the Source view', async () => {
    render(<MarkdownPreviewer />);
    fireEvent.input(input(), { target: { value: '# Hello' } });
    await screen.findByTitle(/rendered markdown preview/i);

    fireEvent.click(screen.getByRole('button', { name: /^source$/i }));

    expect(await sourcePane().findByText(/<h1>Hello<\/h1>/)).toBeInTheDocument();
  });

  it('loads the Markdown example', async () => {
    render(<MarkdownPreviewer />);

    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    expect(input().value).toContain('Release Notes');
    await screen.findByTitle(/rendered markdown preview/i);
    expect(iframe()!.getAttribute('srcdoc')).toContain('Release Notes');
  });

  it('converts a single newline to a line break only when "Line breaks" is checked', async () => {
    render(<MarkdownPreviewer />);
    fireEvent.input(input(), { target: { value: 'line one\nline two' } });
    await screen.findByTitle(/rendered markdown preview/i);
    expect(iframe()!.getAttribute('srcdoc')).not.toContain('<br');

    fireEvent.click(screen.getByRole('checkbox', { name: /line breaks/i }));

    await waitFor(() => expect(iframe()!.getAttribute('srcdoc')).toContain('<br'));
  });

  it('converts HTML to Markdown when the direction is switched', async () => {
    render(<MarkdownPreviewer />);

    fireEvent.click(screen.getByRole('button', { name: /html → markdown/i }));
    fireEvent.input(input(), { target: { value: '<h1>Hello</h1><p>Some <strong>bold</strong> text.</p>' } });

    fireEvent.click(screen.getByRole('button', { name: /^source$/i }));
    const output = await screen.findByText(/# Hello/, { selector: '.output' });
    expect(output).toBeInTheDocument();
    expect(output.textContent).toContain('**bold**');
  });

  it('also renders a live preview for HTML → Markdown, by rendering the resulting Markdown back to HTML', async () => {
    render(<MarkdownPreviewer />);
    fireEvent.click(screen.getByRole('button', { name: /html → markdown/i }));

    fireEvent.input(input(), { target: { value: '<h1>Hello</h1><p>Some <strong>bold</strong> text.</p>' } });

    await waitFor(() => {
      const frame = iframe();
      expect(frame).toBeInTheDocument();
      expect(frame!.getAttribute('srcdoc')).toContain('<h1>Hello</h1>');
      expect(frame!.getAttribute('srcdoc')).toContain('<strong>bold</strong>');
    });
  });

  it('loads the HTML example once the direction is switched', () => {
    render(<MarkdownPreviewer />);
    fireEvent.click(screen.getByRole('button', { name: /html → markdown/i }));

    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    expect(input().value).toContain('<h1>Release Notes</h1>');
  });

  it('swap moves the current output into the input and flips direction', async () => {
    render(<MarkdownPreviewer />);
    fireEvent.input(input(), { target: { value: '# Hello' } });
    await screen.findByTitle(/rendered markdown preview/i);

    fireEvent.click(screen.getByRole('button', { name: /swap/i }));

    expect(input().value).toContain('<h1>Hello</h1>');
    expect(screen.getByRole('button', { name: /html → markdown/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows a visible error for input past the size limit, not a silent failure', async () => {
    render(<MarkdownPreviewer />);

    fireEvent.input(input(), { target: { value: '#'.repeat(MAX_INPUT_LENGTH + 1) } });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/too large/i);
    expect(iframe()).not.toBeInTheDocument();
  });

  it('clears the input when Clear is pressed', async () => {
    render(<MarkdownPreviewer />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    await screen.findByTitle(/rendered markdown preview/i);

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(input()).toHaveValue('');
    expect(document.querySelector('.output--empty')).toBeInTheDocument();
  });
});
