import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { JsonTree } from './JsonTree';

describe('<JsonTree />', () => {
  it('renders keys and scalar values, expanded by default', () => {
    render(<JsonTree value={{ name: 'Ada', age: 36 }} />);

    expect(screen.getByText('name:')).toBeInTheDocument();
    expect(screen.getByText('"Ada"')).toBeInTheDocument();
    expect(screen.getByText('age:')).toBeInTheDocument();
    expect(screen.getByText('36')).toBeInTheDocument();
  });

  it('summarises a container with its kind and size', () => {
    render(<JsonTree value={{ a: 1, b: 2 }} />);
    expect(screen.getByText('Object(2)')).toBeInTheDocument();
  });

  it('labels array children by index rather than by key', () => {
    render(<JsonTree value={['x', 'y']} />);

    expect(screen.getByText('Array(2)')).toBeInTheDocument();
    expect(screen.getByText('"x"')).toBeInTheDocument();
    expect(screen.queryByText('0:')).not.toBeInTheDocument();
  });

  it('collapses and re-expands a node when its toggle is clicked', () => {
    render(<JsonTree value={{ nested: { secret: 'hidden' } }} />);
    expect(screen.getByText('"hidden"')).toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: /nested/i });
    fireEvent.click(toggle);
    expect(screen.queryByText('"hidden"')).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(screen.getByRole('button', { name: /nested/i }));
    expect(screen.getByText('"hidden"')).toBeInTheDocument();
  });

  it('tracks collapse state per node, not globally', () => {
    render(<JsonTree value={{ first: { a: 1 }, second: { b: 2 } }} />);

    fireEvent.click(screen.getByRole('button', { name: /first/i }));

    expect(screen.queryByText('a:')).not.toBeInTheDocument();
    expect(screen.getByText('b:')).toBeInTheDocument();
  });

  it('distinguishes same-named keys at different depths', () => {
    // Node identity is the path, not the key — collapsing the outer "items" must not
    // also collapse an inner one that happens to share its name.
    render(<JsonTree value={{ items: { items: { leaf: 1 } } }} />);

    const toggles = screen.getAllByRole('button', { name: /items/i });
    fireEvent.click(toggles[1]!);

    expect(screen.queryByText('leaf:')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /items/i })).toHaveLength(2);
  });

  it('marks an empty container as empty instead of rendering a blank gap', () => {
    render(<JsonTree value={{ nothing: [] }} />);

    expect(screen.getByText('Array(0)')).toBeInTheDocument();
    expect(screen.getByText('(empty)')).toBeInTheDocument();
  });

  it('renders null distinctly from the string "null"', () => {
    render(<JsonTree value={{ a: null, b: 'null' }} />);

    expect(screen.getByText('null')).toHaveClass('tree-scalar--null');
    expect(screen.getByText('"null"')).toHaveClass('tree-scalar--string');
  });

  it('renders booleans and numbers with their own scalar classes', () => {
    render(<JsonTree value={{ ok: true, n: 0 }} />);

    expect(screen.getByText('true')).toHaveClass('tree-scalar--boolean');
    expect(screen.getByText('0')).toHaveClass('tree-scalar--number');
  });

  it('renders a bare scalar with no key', () => {
    render(<JsonTree value="just a string" />);
    expect(screen.getByText('"just a string"')).toBeInTheDocument();
  });

  it('escapes a value containing quotes rather than breaking the display', () => {
    render(<JsonTree value={{ quoted: 'he said "hi"' }} />);
    expect(screen.getByText('"he said \\"hi\\""')).toBeInTheDocument();
  });

  it('carries an accessible label, defaulting to a description of the tree', () => {
    const { rerender } = render(<JsonTree value={{}} />);
    expect(screen.getByLabelText('JSON as a collapsible tree')).toBeInTheDocument();

    rerender(<JsonTree value={{}} label="Response body" />);
    expect(screen.getByLabelText('Response body')).toBeInTheDocument();
  });

  it('applies the tall variant only when asked', () => {
    const { rerender } = render(<JsonTree value={{}} />);
    expect(document.querySelector('.tree-view')!.className).not.toContain('output--tall');

    rerender(<JsonTree value={{}} tall />);
    expect(document.querySelector('.tree-view')!.className).toContain('output--tall');
  });

  it('renders a deeply nested structure without blowing up', () => {
    let deep: unknown = 'bottom';
    for (let i = 0; i < 60; i += 1) deep = { level: deep };

    render(<JsonTree value={deep} />);
    expect(screen.getByText('"bottom"')).toBeInTheDocument();
  });
});
