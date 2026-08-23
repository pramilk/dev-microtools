import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import JsonFormatter from './JsonFormatter';

const typeInto = (element: HTMLElement, value: string) => {
  fireEvent.input(element, { target: { value } });
};

describe('<JsonFormatter />', () => {
  it('shows the empty state before any input', () => {
    render(<JsonFormatter />);
    expect(screen.getByText(/formatted json appears here/i)).toBeInTheDocument();
  });

  it('formats valid JSON as the user types', async () => {
    render(<JsonFormatter />);
    typeInto(screen.getByLabelText(/json input/i), '{"a":1}');

    expect(await screen.findByText(/"a": 1/)).toBeInTheDocument();
  });

  it('shows a visible error for malformed JSON rather than failing silently', async () => {
    render(<JsonFormatter />);
    typeInto(screen.getByLabelText(/json input/i), '{"a":}');

    const alert = await screen.findByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert.textContent?.length ?? 0).toBeGreaterThan(0);
  });

  it('marks the input as invalid for screen readers when parsing fails', async () => {
    render(<JsonFormatter />);
    const input = screen.getByLabelText(/json input/i);
    typeInto(input, 'not json');

    await screen.findByRole('alert');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('clears the error once the input becomes valid again', async () => {
    render(<JsonFormatter />);
    const input = screen.getByLabelText(/json input/i);

    typeInto(input, '{bad');
    await screen.findByRole('alert');

    typeInto(input, '{"ok":true}');
    await screen.findByText(/"ok": true/);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('minifies when the Minify action is selected', async () => {
    render(<JsonFormatter />);
    typeInto(screen.getByLabelText(/json input/i), '{\n "a": 1\n}');
    fireEvent.click(screen.getByRole('button', { name: /minify/i }));

    expect(await screen.findByText('{"a":1}')).toBeInTheDocument();
  });

  it('sorts keys when the Sort keys action is selected', async () => {
    render(<JsonFormatter />);
    typeInto(screen.getByLabelText(/json input/i), '{"b":1,"a":2}');
    fireEvent.click(screen.getByRole('button', { name: /sort keys/i }));

    const output = await screen.findByText(/"a": 2/);
    expect(output.textContent!.indexOf('"a"')).toBeLessThan(output.textContent!.indexOf('"b"'));
  });

  it('loads a sample document on request', async () => {
    render(<JsonFormatter />);
    fireEvent.click(screen.getByRole('button', { name: /load sample/i }));

    const input = screen.getByLabelText(/json input/i) as HTMLTextAreaElement;
    expect(input.value.length).toBeGreaterThan(0);
    expect(await screen.findByText(/"name": "ada"/)).toBeInTheDocument();
  });

  it('clears the input with the Clear button', async () => {
    render(<JsonFormatter />);
    const input = screen.getByLabelText(/json input/i) as HTMLTextAreaElement;

    typeInto(input, '{"a":1}');
    await screen.findByText(/"a": 1/);

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    expect(input.value).toBe('');
    expect(screen.getByText(/formatted json appears here/i)).toBeInTheDocument();
  });

  it('reports structural statistics for valid input', async () => {
    render(<JsonFormatter />);
    typeInto(screen.getByLabelText(/json input/i), '{"a":{"b":1}}');

    expect(await screen.findByText(/levels deep/i)).toBeInTheDocument();
  });

  it('disables the copy button while there is nothing to copy', () => {
    render(<JsonFormatter />);
    expect(screen.getByRole('button', { name: /^copy$/i })).toBeDisabled();
  });
});

describe('<JsonFormatter /> repair', () => {
  it('is enabled by default', () => {
    render(<JsonFormatter />);
    expect(screen.getByLabelText(/auto-fix/i)).toBeChecked();
  });

  it('formats broken input automatically and says so', async () => {
    render(<JsonFormatter />);
    typeInto(screen.getByLabelText(/json input/i), "{name:'ada',}");

    expect(await screen.findByText(/repaired automatically/i)).toBeInTheDocument();
    expect(await screen.findByText(/"name": "ada"/)).toBeInTheDocument();
  });

  it('still lists every change it made when auto-fixing', async () => {
    render(<JsonFormatter />);
    typeInto(screen.getByLabelText(/json input/i), "{name:'ada',}");

    await screen.findByText(/repaired automatically/i);
    expect(screen.getByText(/added quotes around object keys/i)).toBeInTheDocument();
    expect(screen.getByText(/converted single-quoted strings/i)).toBeInTheDocument();
    expect(screen.getByText(/removed a trailing comma/i)).toBeInTheDocument();
  });

  it('leaves the user input untouched while auto-fixing', async () => {
    render(<JsonFormatter />);
    const input = screen.getByLabelText(/json input/i) as HTMLTextAreaElement;
    typeInto(input, "{name:'ada',}");

    await screen.findByText(/repaired automatically/i);
    expect(input.value).toBe("{name:'ada',}");
  });

  it('suppresses the raw parse error once auto-fix has produced a result', async () => {
    render(<JsonFormatter />);
    typeInto(screen.getByLabelText(/json input/i), "{name:'ada'}");

    await screen.findByText(/repaired automatically/i);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('can write the repaired JSON back into the input', async () => {
    render(<JsonFormatter />);
    const input = screen.getByLabelText(/json input/i) as HTMLTextAreaElement;
    typeInto(input, "{name:'ada',}");

    fireEvent.click(await screen.findByRole('button', { name: /apply to input/i }));

    expect(JSON.parse(input.value)).toEqual({ name: 'ada' });
    expect(screen.queryByText(/repaired automatically/i)).not.toBeInTheDocument();
  });

  it('shows a repair count when the same problem repeats', async () => {
    render(<JsonFormatter />);
    typeInto(screen.getByLabelText(/json input/i), "{'a':'x','b':'y'}");

    expect(await screen.findByText(/×4/)).toBeInTheDocument();
  });

  it('reports when auto-fix cannot salvage the input', async () => {
    render(<JsonFormatter />);
    typeInto(screen.getByLabelText(/json input/i), 'this is just prose');

    expect(await screen.findByText(/could not salvage/i)).toBeInTheDocument();
    // The underlying parse error stays visible in this case.
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('stays quiet when the JSON is already valid', async () => {
    render(<JsonFormatter />);
    typeInto(screen.getByLabelText(/json input/i), '{"a":1}');

    await screen.findByText(/"a": 1/);
    expect(screen.queryByText(/repaired automatically/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/this looks fixable/i)).not.toBeInTheDocument();
  });

  it('repairs the broken sample end to end', async () => {
    render(<JsonFormatter />);
    fireEvent.click(screen.getByRole('button', { name: /load broken sample/i }));

    fireEvent.click(await screen.findByRole('button', { name: /apply to input/i }));

    const input = screen.getByLabelText(/json input/i) as HTMLTextAreaElement;
    expect(JSON.parse(input.value)).toEqual({
      name: 'api-server',
      port: 8080,
      debug: true,
      hosts: ['a.dev', 'b.dev'],
    });
  });
});

describe('<JsonFormatter /> with auto-fix turned off', () => {
  const turnOff = () => fireEvent.click(screen.getByLabelText(/auto-fix/i));

  it('shows the parse error instead of repairing', async () => {
    render(<JsonFormatter />);
    turnOff();
    typeInto(screen.getByLabelText(/json input/i), "{name:'ada'}");

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/repaired automatically/i)).not.toBeInTheDocument();
  });

  it('offers the fix without applying it', async () => {
    render(<JsonFormatter />);
    turnOff();
    const input = screen.getByLabelText(/json input/i) as HTMLTextAreaElement;
    typeInto(input, "{name:'ada'}");

    expect(await screen.findByText(/this looks fixable/i)).toBeInTheDocument();
    expect(input.value).toBe("{name:'ada'}");
    // The output pane stays empty — nothing was silently repaired.
    expect(screen.getByText(/formatted json appears here/i)).toBeInTheDocument();
  });

  it('applies the fix on request', async () => {
    render(<JsonFormatter />);
    turnOff();
    const input = screen.getByLabelText(/json input/i) as HTMLTextAreaElement;
    typeInto(input, "{name:'ada',}");

    fireEvent.click(await screen.findByRole('button', { name: /fix it/i }));
    expect(JSON.parse(input.value)).toEqual({ name: 'ada' });
  });

  it('re-enabling auto-fix repairs the existing input immediately', async () => {
    render(<JsonFormatter />);
    turnOff();
    typeInto(screen.getByLabelText(/json input/i), "{name:'ada'}");
    await screen.findByText(/this looks fixable/i);

    turnOff(); // back on
    expect(await screen.findByText(/repaired automatically/i)).toBeInTheDocument();
    expect(await screen.findByText(/"name": "ada"/)).toBeInTheDocument();
  });
});

describe('<JsonFormatter /> tree view', () => {
  it('disables the Tree button until the input is valid JSON', () => {
    render(<JsonFormatter />);
    expect(screen.getByRole('button', { name: /^tree$/i })).toBeDisabled();
  });

  it('shows the document as a collapsible tree once selected', async () => {
    render(<JsonFormatter />);
    typeInto(screen.getByLabelText(/json input/i), '{"name":"ada","tags":["a","b"]}');
    await screen.findByText(/"name": "ada"/);

    fireEvent.click(screen.getByRole('button', { name: /^tree$/i }));

    expect(screen.getByLabelText(/json as a collapsible tree/i)).toBeInTheDocument();
    expect(screen.getByText('name:')).toBeInTheDocument();
    expect(screen.getByText('"ada"')).toBeInTheDocument();
    expect(screen.getByText('Array(2)')).toBeInTheDocument();
  });

  it('collapses and re-expands a branch', async () => {
    render(<JsonFormatter />);
    typeInto(screen.getByLabelText(/json input/i), '{"tags":["a","b"]}');
    await screen.findByText(/"tags"/);
    fireEvent.click(screen.getByRole('button', { name: /^tree$/i }));

    const branch = screen.getByRole('button', { name: /Array\(2\)/i });
    expect(screen.getByText('"a"')).toBeInTheDocument();

    fireEvent.click(branch);
    expect(screen.queryByText('"a"')).not.toBeInTheDocument();

    fireEvent.click(branch);
    expect(screen.getByText('"a"')).toBeInTheDocument();
  });

  it('falls back to text view when the input stops being valid JSON', async () => {
    render(<JsonFormatter />);
    // Auto-fix off, so tree availability reflects the raw input's validity directly.
    fireEvent.click(screen.getByLabelText(/auto-fix/i));
    typeInto(screen.getByLabelText(/json input/i), '{"a":1}');
    await screen.findByText(/"a": 1/);
    fireEvent.click(screen.getByRole('button', { name: /^tree$/i }));
    expect(screen.getByLabelText(/json as a collapsible tree/i)).toBeInTheDocument();

    typeInto(screen.getByLabelText(/json input/i), 'not json at all');
    expect(screen.queryByLabelText(/json as a collapsible tree/i)).not.toBeInTheDocument();
  });
});

describe('<JsonFormatter /> search', () => {
  it('highlights matches in the text view and reports a count', async () => {
    render(<JsonFormatter />);
    typeInto(screen.getByLabelText(/json input/i), '{"name":"ada","role":"engineer"}');
    await screen.findByText(/"name": "ada"/);

    typeInto(screen.getByLabelText(/search formatted result/i), 'ada');

    expect(await screen.findByText('1 of 1')).toBeInTheDocument();
  });

  it('reports no matches when the query is not found', async () => {
    render(<JsonFormatter />);
    typeInto(screen.getByLabelText(/json input/i), '{"name":"ada"}');
    await screen.findByText(/"name": "ada"/);

    typeInto(screen.getByLabelText(/search formatted result/i), 'zzz');

    expect(await screen.findByText(/no matches/i)).toBeInTheDocument();
  });

  it('clears the search with the clear button', async () => {
    render(<JsonFormatter />);
    typeInto(screen.getByLabelText(/json input/i), '{"name":"ada"}');
    await screen.findByText(/"name": "ada"/);

    const search = screen.getByLabelText(/search formatted result/i) as HTMLInputElement;
    typeInto(search, 'ada');
    await screen.findByText('1 of 1');

    fireEvent.click(screen.getByRole('button', { name: /clear search/i }));
    expect(search.value).toBe('');
    expect(screen.queryByText('1 of 1')).not.toBeInTheDocument();
  });

  it('filters the tree view down to matching branches and reports a match count', async () => {
    render(<JsonFormatter />);
    typeInto(screen.getByLabelText(/json input/i), '{"meta":{"tags":["x","target","y"]},"other":1}');
    await screen.findByText(/"meta"/);
    fireEvent.click(screen.getByRole('button', { name: /^tree$/i }));

    typeInto(screen.getByLabelText(/search formatted result/i), 'target');

    expect(await screen.findByText('1 match')).toBeInTheDocument();
    // The matched substring is wrapped in its own <mark>, splitting the text node.
    expect(screen.getByText('target', { selector: 'mark' })).toBeInTheDocument();
    expect(screen.queryByText('"x"')).not.toBeInTheDocument();
    expect(screen.queryByText(/^other:/)).not.toBeInTheDocument();
  });

  it('shows a "no matches" message in the tree view instead of an empty tree', async () => {
    render(<JsonFormatter />);
    typeInto(screen.getByLabelText(/json input/i), '{"name":"ada"}');
    await screen.findByText(/"name"/);
    fireEvent.click(screen.getByRole('button', { name: /^tree$/i }));

    typeInto(screen.getByLabelText(/search formatted result/i), 'zzz');

    expect(await screen.findByText(/no matches for/i)).toBeInTheDocument();
  });
});

describe('<JsonFormatter /> share link and download', () => {
  it('offers a download button that enables once there is output', async () => {
    render(<JsonFormatter />);
    expect(screen.getByRole('button', { name: /download/i })).toBeDisabled();

    typeInto(screen.getByLabelText(/json input/i), '{"a":1}');
    await screen.findByText(/"a": 1/);
    expect(screen.getByRole('button', { name: /download/i })).not.toBeDisabled();
  });

  it('restores input from a shared link on load', async () => {
    const { encodeShareState } = await import('../lib/shareLink');
    const encoded = await encodeShareState({ input: '{"shared":true}', indent: 2, action: 'format' });
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    window.location.hash = `#s=${encoded.value}`;
    render(<JsonFormatter />);

    expect(await screen.findByText(/"shared": true/)).toBeInTheDocument();
    window.location.hash = '';
  });

  it('restores the tree view and auto-fix setting from a shared link', async () => {
    const { encodeShareState } = await import('../lib/shareLink');
    const encoded = await encodeShareState({
      input: '{"shared":true}',
      indent: 2,
      action: 'format',
      view: 'tree',
      autoFix: false,
    });
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    window.location.hash = `#s=${encoded.value}`;
    render(<JsonFormatter />);

    await screen.findByLabelText(/json as a collapsible tree/i);
    expect(screen.getByRole('button', { name: /^tree$/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText(/auto-fix/i)).not.toBeChecked();
    window.location.hash = '';
  });

  it('fills the input from a file dropped directly onto the textarea', async () => {
    render(<JsonFormatter />);
    const file = new File(['{"dropped":true}'], 'data.json', { type: 'application/json' });

    fireEvent.drop(screen.getByLabelText(/json input/i), { dataTransfer: { files: [file] } });

    expect(await screen.findByText(/"dropped": true/)).toBeInTheDocument();
  });
});
