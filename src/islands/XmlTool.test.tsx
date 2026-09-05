import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/preact';
import XmlTool from './XmlTool';

const typeInto = (element: HTMLElement, value: string) => {
  fireEvent.input(element, { target: { value } });
};

const output = () => within(document.querySelector<HTMLElement>('.output')!);

describe('<XmlTool />', () => {
  it('starts empty with a placeholder, defaulting to Format mode', () => {
    render(<XmlTool />);

    expect(screen.getByLabelText(/xml input/i)).toHaveValue('');
    expect(document.querySelector('.output--empty')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^format$/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('formats valid XML as the user types', async () => {
    render(<XmlTool />);
    typeInto(screen.getByLabelText(/xml input/i), '<root><a>1</a></root>');

    expect(await output().findByText(/<root>/)).toBeInTheDocument();
    expect(output().getByText(/<a>1<\/a>/)).toBeInTheDocument();
  });

  it('shows a visible error for malformed XML, not a raw stack trace', async () => {
    render(<XmlTool />);
    typeInto(screen.getByLabelText(/xml input/i), '<root><a>1</a>');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/not well-formed/i);
    expect(alert.textContent).not.toMatch(/at Object|\.js:\d+|stack/i);
    expect(document.querySelector('.output--empty')).toBeInTheDocument();
  });

  it('marks the input as invalid for screen readers when parsing fails', async () => {
    render(<XmlTool />);
    const input = screen.getByLabelText(/xml input/i);
    typeInto(input, '<root><a>');

    await screen.findByRole('alert');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('clears the error once the input becomes well-formed again', async () => {
    render(<XmlTool />);
    const input = screen.getByLabelText(/xml input/i);

    typeInto(input, '<root><a>');
    await screen.findByRole('alert');

    typeInto(input, '<root><a>1</a></root>');
    await output().findByText(/<root>/);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('minifies when the Minify mode is selected', async () => {
    render(<XmlTool />);
    typeInto(screen.getByLabelText(/xml input/i), '<root>\n  <a>1</a>\n</root>');
    fireEvent.click(screen.getByRole('button', { name: /^minify$/i }));

    expect(await output().findByText('<root><a>1</a></root>')).toBeInTheDocument();
  });

  it('reports well-formedness in Validate mode without a stack trace', async () => {
    render(<XmlTool />);
    fireEvent.click(screen.getByRole('button', { name: /^validate$/i }));
    typeInto(screen.getByLabelText(/xml input/i), '<root><a>1</a></root>');

    expect(await output().findByText(/well-formed/i)).toBeInTheDocument();
  });

  it('shows a validation error in Validate mode for malformed XML', async () => {
    render(<XmlTool />);
    fireEvent.click(screen.getByRole('button', { name: /^validate$/i }));
    typeInto(screen.getByLabelText(/xml input/i), '<root><a>1</a>');

    expect(await screen.findByRole('alert')).toHaveTextContent(/not well-formed/i);
  });

  it('converts to JSON using the documented @attr / #text convention', async () => {
    render(<XmlTool />);
    fireEvent.click(screen.getByRole('button', { name: /^to json$/i }));
    typeInto(screen.getByLabelText(/xml input/i), '<a id="1">hello</a>');

    const result = await output().findByText(/"@id": "1"/);
    expect(result.textContent).toContain('"#text": "hello"');
  });

  it('reformats using the selected indent width', async () => {
    render(<XmlTool />);
    typeInto(screen.getByLabelText(/xml input/i), '<root><a>1</a></root>');
    await output().findByText(/<root>/);

    fireEvent.change(screen.getByLabelText(/indentation/i), { target: { value: '4' } });

    expect(await output().findByText(/<a>1<\/a>/)).toBeInTheDocument();
    expect(document.querySelector('.output')?.textContent).toContain('    <a>1</a>');
  });

  it('reformats with a tab when Tab indent is selected', async () => {
    render(<XmlTool />);
    typeInto(screen.getByLabelText(/xml input/i), '<root><a>1</a></root>');
    await output().findByText(/<root>/);

    fireEvent.change(screen.getByLabelText(/indentation/i), { target: { value: 'tab' } });

    expect(document.querySelector('.output')?.textContent).toContain('\t<a>1</a>');
  });

  it('disables the indent control outside Format mode', () => {
    render(<XmlTool />);
    fireEvent.click(screen.getByRole('button', { name: /^minify$/i }));

    expect(screen.getByLabelText(/indentation/i)).toBeDisabled();
  });

  it('loads the sample document on request', async () => {
    render(<XmlTool />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    const input = screen.getByLabelText(/xml input/i) as HTMLTextAreaElement;
    expect(input.value).toContain('<catalog>');
    expect(await output().findByText(/<catalog>/)).toBeInTheDocument();
  });

  it('clears the input when Clear is pressed', async () => {
    render(<XmlTool />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    await output().findByText(/<catalog>/);

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(screen.getByLabelText(/xml input/i)).toHaveValue('');
    expect(document.querySelector('.output--empty')).toBeInTheDocument();
  });

  it('disables the copy button while there is nothing to copy', () => {
    render(<XmlTool />);
    expect(screen.getByRole('button', { name: /^copy$/i })).toBeDisabled();
  });

  it('enables the copy button once formatting succeeds, and copies the output', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<XmlTool />);
    typeInto(screen.getByLabelText(/xml input/i), '<root><a>1</a></root>');
    await output().findByText(/<root>/);

    const copyButton = screen.getByRole('button', { name: /^copy$/i });
    expect(copyButton).not.toBeDisabled();
    fireEvent.click(copyButton);

    await screen.findByRole('button', { name: /^copied$/i });
    expect(writeText).toHaveBeenCalledWith('<root>\n  <a>1</a>\n</root>');
  });

  it('does not offer a download button in Validate mode', async () => {
    render(<XmlTool />);
    fireEvent.click(screen.getByRole('button', { name: /^validate$/i }));
    typeInto(screen.getByLabelText(/xml input/i), '<root><a>1</a></root>');
    await output().findByText(/well-formed/i);

    expect(screen.queryByRole('button', { name: /download/i })).not.toBeInTheDocument();
  });

  it('offers a download button once there is formatted output', async () => {
    render(<XmlTool />);
    expect(screen.getByRole('button', { name: /download/i })).toBeDisabled();

    typeInto(screen.getByLabelText(/xml input/i), '<root><a>1</a></root>');
    await output().findByText(/<root>/);
    expect(screen.getByRole('button', { name: /download/i })).not.toBeDisabled();
  });

  it('fills the input from a file dropped directly onto the textarea', async () => {
    render(<XmlTool />);
    const file = new File(['<root><dropped>true</dropped></root>'], 'data.xml', { type: 'application/xml' });

    fireEvent.drop(screen.getByLabelText(/xml input/i), { dataTransfer: { files: [file] } });

    expect(await output().findByText(/<dropped>true<\/dropped>/)).toBeInTheDocument();
  });

  it('restores input and mode from a shared link on load', async () => {
    const { encodeShareState } = await import('../lib/shareLink');
    const encoded = await encodeShareState({ input: '<root><shared>true</shared></root>', mode: 'minify' });
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    window.location.hash = `#s=${encoded.value}`;
    render(<XmlTool />);

    expect(await output().findByText('<root><shared>true</shared></root>')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^minify$/i })).toHaveAttribute('aria-pressed', 'true');
    window.location.hash = '';
  });
});
