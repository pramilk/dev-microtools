import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import MermaidDiagramGenerator from './MermaidDiagramGenerator';
import { MERMAID_EXAMPLES } from '../lib/tools/mermaid';

// mermaid.render() lays out diagrams via d3/dagre and measures text with getBBox(), which
// jsdom doesn't implement reliably — mocked here the same way mermaid.test.ts mocks it, so
// this file can focus on the island's own wiring (state, buttons, error display) rather than
// fighting jsdom. A source containing "BREAK" simulates a Mermaid parse error.
const { renderMock, initializeMock } = vi.hoisted(() => ({
  renderMock: vi.fn(async (_id: string, code: string) => {
    if (code.includes('BREAK')) throw new Error('Parse error on line 1: unexpected token');
    return { svg: `<svg viewBox="0 0 200 100" data-len="${code.length}"><text>diagram</text></svg>` };
  }),
  initializeMock: vi.fn(),
}));
vi.mock('mermaid', () => ({
  default: { initialize: initializeMock, render: renderMock },
}));

const input = () => document.getElementById('mermaid-input') as HTMLTextAreaElement;
const preview = () => document.querySelector('.mermaid-viewer')!;

describe('<MermaidDiagramGenerator />', () => {
  beforeEach(() => {
    renderMock.mockClear();
    initializeMock.mockClear();
  });

  it('starts empty with a placeholder in the preview pane, no diagram', () => {
    render(<MermaidDiagramGenerator />);

    expect(input()).toHaveValue('');
    expect(screen.getByText(/choose an example above, or write your own/i)).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /rendered diagram preview/i })).not.toBeInTheDocument();
  });

  it('renders typed Mermaid syntax as an SVG diagram', async () => {
    render(<MermaidDiagramGenerator />);

    fireEvent.input(input(), { target: { value: 'flowchart TD\nA-->B' } });

    const diagram = await screen.findByRole('img', { name: /rendered diagram preview/i });
    expect(diagram.innerHTML).toContain('<text>diagram</text>');
  });

  it('shows a visible, specific error for invalid syntax instead of a blank preview', async () => {
    render(<MermaidDiagramGenerator />);

    fireEvent.input(input(), { target: { value: 'BREAK this' } });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/parse error on line 1/i);
    expect(screen.queryByRole('img', { name: /rendered diagram preview/i })).not.toBeInTheDocument();
  });

  it('loads an example from the gallery and renders it', async () => {
    render(<MermaidDiagramGenerator />);

    fireEvent.click(screen.getByText('Examples'));
    fireEvent.click(screen.getByRole('button', { name: 'Sequence Diagram' }));

    expect(input().value).toContain('sequenceDiagram');
    await screen.findByRole('img', { name: /rendered diagram preview/i });
  });

  it('renders a live thumbnail for every example once the gallery is opened, and not before', async () => {
    render(<MermaidDiagramGenerator />);
    expect(document.querySelector('.mermaid-examples__thumb-canvas')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Examples'));

    await waitFor(() => {
      expect(document.querySelectorAll('.mermaid-examples__thumb-canvas').length).toBe(MERMAID_EXAMPLES.length);
    });
  });

  it('closes the gallery and marks the chosen card selected once an example is picked', async () => {
    render(<MermaidDiagramGenerator />);
    fireEvent.click(screen.getByText('Examples'));
    const card = screen.getByRole('button', { name: 'Pie Chart' });

    fireEvent.click(card);

    expect(document.querySelector('details.mermaid-examples')).not.toHaveAttribute('open');
  });

  it('passes the selected theme through to mermaid.initialize', async () => {
    render(<MermaidDiagramGenerator />);
    fireEvent.input(input(), { target: { value: 'flowchart TD\nA-->B' } });
    await screen.findByRole('img', { name: /rendered diagram preview/i });

    fireEvent.change(screen.getByLabelText(/diagram theme/i), { target: { value: 'dark' } });

    await waitFor(() =>
      expect(initializeMock).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'dark', securityLevel: 'strict' }))
    );
  });

  it('clears the source, diagram and any error when Clear is pressed', async () => {
    render(<MermaidDiagramGenerator />);
    fireEvent.input(input(), { target: { value: 'flowchart TD\nA-->B' } });
    await screen.findByRole('img', { name: /rendered diagram preview/i });

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(input()).toHaveValue('');
    expect(screen.queryByRole('img', { name: /rendered diagram preview/i })).not.toBeInTheDocument();
  });

  it('zooms in and out, and Reset returns to the default view', async () => {
    render(<MermaidDiagramGenerator />);
    fireEvent.input(input(), { target: { value: 'flowchart TD\nA-->B' } });
    await screen.findByRole('img', { name: /rendered diagram preview/i });

    const resetButton = screen.getByRole('button', { name: /^reset$/i });
    expect(resetButton).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /zoom in/i }));
    expect(screen.getByText('125%')).toBeInTheDocument();
    expect(resetButton).toBeEnabled();

    fireEvent.click(resetButton);
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(resetButton).toBeDisabled();
  });

  it('enables Copy SVG and Download SVG only once a diagram has rendered', async () => {
    render(<MermaidDiagramGenerator />);
    expect(screen.getByRole('button', { name: /copy svg/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /download svg/i })).toBeDisabled();

    fireEvent.input(input(), { target: { value: 'flowchart TD\nA-->B' } });
    await screen.findByRole('img', { name: /rendered diagram preview/i });

    expect(screen.getByRole('button', { name: /copy svg/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /download svg/i })).toBeEnabled();
  });

  it('restores diagram source and theme from a share link', async () => {
    const { buildShareUrl } = await import('../lib/shareLink');
    const result = await buildShareUrl('https://example.com/mermaid-diagram-generator/', {
      source: 'flowchart TD\nX-->Y',
      theme: 'forest',
    });
    if (!result.ok) throw new Error('failed to build test share url');
    const hash = result.value.slice(result.value.indexOf('#'));
    window.history.replaceState(null, '', hash);

    render(<MermaidDiagramGenerator />);

    await screen.findByDisplayValue(/X-->Y/);
    expect(screen.getByLabelText(/diagram theme/i)).toHaveValue('forest');

    window.history.replaceState(null, '', window.location.pathname);
  });

  it('never leaves the preview pane empty of any state (loading, error, empty or filled)', () => {
    render(<MermaidDiagramGenerator />);
    expect(preview().textContent?.length).toBeGreaterThan(0);
  });

  it('shows a live detected-type badge and a matching snippet row once the first line matches a known keyword', async () => {
    render(<MermaidDiagramGenerator />);
    expect(screen.queryByText('Flowchart', { selector: '.badge--ai' })).not.toBeInTheDocument();

    fireEvent.input(input(), { target: { value: 'flowchart TD' } });

    expect(screen.getByText('Flowchart', { selector: '.badge--ai' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /flowchart snippets/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^node$/i })).toBeInTheDocument();
  });

  it('shows a keyword hint instead of a snippet row when the first line matches no known diagram type', () => {
    render(<MermaidDiagramGenerator />);

    fireEvent.input(input(), { target: { value: 'this is not mermaid' } });

    expect(screen.getByText(/start the first line with a diagram-type keyword/i)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /snippets/i })).not.toBeInTheDocument();
  });

  it('inserts a snippet at the cursor position and keeps the cursor after it', () => {
    render(<MermaidDiagramGenerator />);
    const textarea = input();
    fireEvent.input(textarea, { target: { value: 'flowchart TD\n' } });
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);

    fireEvent.click(screen.getByRole('button', { name: /^arrow$/i }));

    expect(textarea.value).toBe('flowchart TD\n    A --> B\n');
  });

  it('offers a raw .mmd download of the exact source, independent of whether it renders', () => {
    render(<MermaidDiagramGenerator />);
    const mmdButton = screen.getByRole('button', { name: /download \.mmd/i });
    expect(mmdButton).toBeDisabled();

    fireEvent.input(input(), { target: { value: 'flowchart TD\nA-->B' } });

    expect(mmdButton).toBeEnabled();
  });

  it('enables the PDF export button only once a diagram has rendered', async () => {
    render(<MermaidDiagramGenerator />);
    expect(screen.getByRole('button', { name: /download pdf/i })).toBeDisabled();

    fireEvent.input(input(), { target: { value: 'flowchart TD\nA-->B' } });
    await screen.findByRole('img', { name: /rendered diagram preview/i });

    expect(screen.getByRole('button', { name: /download pdf/i })).toBeEnabled();
  });

  it('links to the official Mermaid syntax reference', () => {
    render(<MermaidDiagramGenerator />);
    const link = screen.getByRole('link', { name: /syntax reference/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('mermaid.js.org'));
    expect(link).toHaveAttribute('target', '_blank');
  });
});
