import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { createFakeWorkerClass } from '../../test/fakeWorker';
import { handleSvgOptimizeRequest } from '../workers/svgOptimize.worker';
import SvgOptimizer from './SvgOptimizer';

// jsdom has no real Worker; this runs the same request-handling logic the real
// svgOptimize.worker.ts uses, synchronously, so the test still exercises real SVGO.
vi.mock('../workers/svgOptimize.worker?worker', () => ({
  default: createFakeWorkerClass(handleSvgOptimizeRequest),
}));

const SVG_WITH_CRUFT =
  '<!-- Generator: Some Tool -->\n' +
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">\n' +
  '  <circle cx="5.000000" cy="5.000000" r="4" fill="#f00" />\n' +
  '</svg>\n';

describe('<SvgOptimizer />', () => {
  it('starts empty with no stats or preview shown', () => {
    render(<SvgOptimizer />);
    expect(screen.queryByTestId('svg-optimize-stats')).not.toBeInTheDocument();
    expect(screen.queryByAltText('Optimized')).not.toBeInTheDocument();
  });

  it('accepts a dropped .svg file anywhere on its input pane, not just precisely on the textarea', async () => {
    render(<SvgOptimizer />);
    const pane = screen.getByLabelText(/svg markup/i).closest('.field') as HTMLElement;
    const file = new File([SVG_WITH_CRUFT], 'dropped.svg', { type: 'image/svg+xml' });

    fireEvent.drop(pane, { dataTransfer: { files: [file] } });

    await waitFor(() => expect(screen.getByLabelText(/svg markup/i)).toHaveValue(SVG_WITH_CRUFT));
  });

  it('optimizes pasted SVG markup and shows before/after size stats', async () => {
    render(<SvgOptimizer />);
    fireEvent.input(screen.getByLabelText(/svg markup/i), { target: { value: SVG_WITH_CRUFT } });

    await waitFor(() => expect(screen.getByTestId('svg-optimize-stats')).toBeInTheDocument());
    expect(screen.getByTestId('svg-optimize-stats')).toHaveTextContent(/smaller/i);
    expect(screen.getByText(/<svg/)).toBeInTheDocument();
  });

  it('renders a safe <img>-based before/after comparison of the input and optimized output', async () => {
    render(<SvgOptimizer />);
    fireEvent.input(screen.getByLabelText(/svg markup/i), { target: { value: SVG_WITH_CRUFT } });

    const before = await screen.findByAltText('Original');
    const after = screen.getByAltText('Optimized');
    expect(before.tagName).toBe('IMG');
    expect(after.tagName).toBe('IMG');
    expect(before).toHaveAttribute('src', expect.stringContaining('data:image/svg+xml;base64,'));
    expect(after).toHaveAttribute('src', expect.stringContaining('data:image/svg+xml;base64,'));
  });

  it('shows a visible error for markup with no <svg> root, not a blank output', async () => {
    render(<SvgOptimizer />);
    fireEvent.input(screen.getByLabelText(/svg markup/i), { target: { value: '<div>nope</div>' } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/doesn't look like svg/i);
  });

  it('loads the bundled example and produces optimized output', async () => {
    render(<SvgOptimizer />);
    fireEvent.click(screen.getByRole('button', { name: /^load example$/i }));

    await waitFor(() => expect(screen.getByTestId('svg-optimize-stats')).toBeInTheDocument());
  });

  it('clears input, output, and stats when Clear is pressed', async () => {
    render(<SvgOptimizer />);
    fireEvent.click(screen.getByRole('button', { name: /^load example$/i }));
    await waitFor(() => expect(screen.getByTestId('svg-optimize-stats')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(screen.getByLabelText(/svg markup/i)).toHaveValue('');
    expect(screen.queryByTestId('svg-optimize-stats')).not.toBeInTheDocument();
  });

  it('offers a working copy-link and download once output exists', async () => {
    render(<SvgOptimizer />);
    fireEvent.click(screen.getByRole('button', { name: /^load example$/i }));
    await waitFor(() => expect(screen.getByTestId('svg-optimize-stats')).toBeInTheDocument());

    expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^download$/i })).not.toBeDisabled();
  });

  it('lowering precision rounds numbers more aggressively', async () => {
    const svg = '<svg viewBox="0 0 10 10"><circle cx="5.123456" cy="5.123456" r="4.98"/></svg>';
    render(<SvgOptimizer />);
    fireEvent.input(screen.getByLabelText(/svg markup/i), { target: { value: svg } });
    await waitFor(() => expect(screen.getByTestId('svg-optimize-stats')).toBeInTheDocument());
    const atDefaultPrecision = screen.getByText(/<svg/).textContent;

    fireEvent.input(screen.getByLabelText(/numeric precision/i), { target: { value: '1' } });

    await waitFor(() => expect(screen.getByText(/<svg/).textContent).not.toBe(atDefaultPrecision));
    expect(screen.getByText(/<svg/).textContent).toContain('5.1');
  });

  it('keeps <desc> content only when "Keep <desc>" is checked', async () => {
    const svg = '<svg viewBox="0 0 10 10"><desc></desc><rect width="10" height="10"/></svg>';
    render(<SvgOptimizer />);
    fireEvent.input(screen.getByLabelText(/svg markup/i), { target: { value: svg } });
    await waitFor(() => expect(screen.getByTestId('svg-optimize-stats')).toBeInTheDocument());
    expect(screen.getByText(/<svg/).textContent).not.toContain('<desc');

    fireEvent.click(screen.getByRole('checkbox', { name: /keep <desc>/i }));

    await waitFor(() => expect(screen.getByText(/<svg/).textContent).toContain('<desc'));
  });

  it('prefixes ids only when "Prefix IDs" is checked', async () => {
    const svg =
      '<svg viewBox="0 0 10 10"><defs><linearGradient id="grad"><stop offset="0" stop-color="#fff"/></linearGradient></defs><rect width="10" height="10" fill="url(#grad)"/></svg>';
    render(<SvgOptimizer />);
    fireEvent.input(screen.getByLabelText(/svg markup/i), { target: { value: svg } });
    await waitFor(() => expect(screen.getByTestId('svg-optimize-stats')).toBeInTheDocument());
    const withoutPrefix = screen.getByText(/<svg/).textContent ?? '';

    fireEvent.click(screen.getByRole('checkbox', { name: /prefix ids/i }));

    await waitFor(() => expect(screen.getByText(/<svg/).textContent).not.toBe(withoutPrefix));
    expect(screen.getByText(/<svg/).textContent).toContain('prefix__');
  });

  it('resets precision and the checkboxes when Load example is pressed', async () => {
    render(<SvgOptimizer />);
    // Toggles only render once there's output to preview, next to the sliders they sit beside.
    fireEvent.input(screen.getByLabelText(/svg markup/i), { target: { value: SVG_WITH_CRUFT } });
    await waitFor(() => expect(screen.getByTestId('svg-optimize-stats')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('checkbox', { name: /keep <desc>/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /prefix ids/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /multipass/i }));

    fireEvent.click(screen.getByRole('button', { name: /^load example$/i }));

    await waitFor(() => expect(screen.getByRole('checkbox', { name: /multipass/i })).toBeChecked());
    expect(screen.getByRole('checkbox', { name: /keep <desc>/i })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /prefix ids/i })).not.toBeChecked();
  });

  it('lowering transform precision rounds a decomposed transform matrix more aggressively', async () => {
    const svg =
      '<svg viewBox="0 0 10 10"><defs><rect id="r" width="2" height="2"/></defs>' +
      '<use href="#r" transform="matrix(0.83907153,0.54401671,-0.54401671,0.83907153,1.23456789,2.3456789)"/></svg>';
    render(<SvgOptimizer />);
    fireEvent.input(screen.getByLabelText(/svg markup/i), { target: { value: svg } });
    await waitFor(() => expect(screen.getByTestId('svg-optimize-stats')).toBeInTheDocument());
    const atDefault = screen.getByText(/<svg/).textContent ?? '';

    fireEvent.input(screen.getByLabelText(/transform precision/i), { target: { value: '1' } });

    await waitFor(() => expect(screen.getByText(/<svg/).textContent).not.toBe(atDefault));
  });

  it('still produces valid optimized output with multipass turned off', async () => {
    const svg = '<svg viewBox="0 0 10 10"><g><g><g><rect width="10" height="10"/></g></g></g></svg>';
    render(<SvgOptimizer />);
    fireEvent.input(screen.getByLabelText(/svg markup/i), { target: { value: svg } });
    await waitFor(() => expect(screen.getByTestId('svg-optimize-stats')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('checkbox', { name: /multipass/i }));

    await waitFor(() => expect(screen.getByText(/<svg/).textContent).toMatch(/<svg[\s>]/));
    expect(screen.getByTestId('svg-optimize-stats')).toHaveTextContent(/smaller|larger|no change/i);
  });
});
