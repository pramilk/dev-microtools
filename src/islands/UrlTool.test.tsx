import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import UrlTool from './UrlTool';

const typeInto = (element: HTMLElement, value: string) => {
  fireEvent.input(element, { target: { value } });
};

describe('<UrlTool />', () => {
  it('encodes reserved characters in component mode', async () => {
    render(<UrlTool />);
    typeInto(screen.getByLabelText(/plain text/i), 'a=1&b=2');

    expect(await screen.findByText('a%3D1%26b%3D2')).toBeInTheDocument();
  });

  it('preserves URL structure in whole-URL mode', async () => {
    render(<UrlTool />);
    fireEvent.click(screen.getByRole('button', { name: /whole url/i }));
    typeInto(screen.getByLabelText(/plain text/i), 'https://x.dev/a b');

    // Both the output pane and the query-builder's rebuilt-URL preview show this
    // same encoded URL once it parses as a valid absolute URL, so more than one match is expected.
    const matches = await screen.findAllByText('https://x.dev/a%20b');
    expect(matches.length).toBeGreaterThan(0);
  });

  it('decodes percent-encoded text', async () => {
    render(<UrlTool />);
    fireEvent.click(screen.getByRole('button', { name: /^decode$/i }));
    typeInto(screen.getByLabelText(/encoded text/i), 'a%3D1');

    expect(await screen.findByText('a=1')).toBeInTheDocument();
  });

  it('explains a malformed escape sequence', async () => {
    render(<UrlTool />);
    fireEvent.click(screen.getByRole('button', { name: /^decode$/i }));
    typeInto(screen.getByLabelText(/encoded text/i), '%zz');

    expect(await screen.findByRole('alert')).toHaveTextContent(/hex digits/i);
  });

  it('breaks a full URL into its parts', async () => {
    render(<UrlTool />);
    typeInto(screen.getByLabelText(/plain text/i), 'https://example.com:8443/a?x=1#frag');

    expect(await screen.findByText('URL breakdown')).toBeInTheDocument();
    expect(screen.getByText('example.com')).toBeInTheDocument();
    expect(screen.getByText('8443')).toBeInTheDocument();
  });

  it('lists query parameters from a full URL as editable rows', async () => {
    render(<UrlTool />);
    typeInto(screen.getByLabelText(/plain text/i), 'https://x.dev/?tag=alpha');

    expect(await screen.findByText('Query parameters')).toBeInTheDocument();
    expect(screen.getByDisplayValue('tag')).toBeInTheDocument();
    expect(screen.getByDisplayValue('alpha')).toBeInTheDocument();
  });

  it('explains the difference between the two scopes', () => {
    render(<UrlTool />);
    expect(screen.getByText(/correct for a single query-string value/i)).toBeInTheDocument();
  });

  it('rebuilds the URL live as a parameter value is edited', async () => {
    render(<UrlTool />);
    typeInto(screen.getByLabelText(/plain text/i), 'https://x.dev/?tag=alpha');
    await screen.findByDisplayValue('alpha');

    typeInto(screen.getByLabelText(/parameter 1 value/i), 'beta');
    expect(await screen.findByText('https://x.dev/?tag=beta')).toBeInTheDocument();
  });

  it('adds a new, empty parameter row', async () => {
    render(<UrlTool />);
    typeInto(screen.getByLabelText(/plain text/i), 'https://x.dev/?tag=alpha');
    await screen.findByDisplayValue('alpha');

    fireEvent.click(screen.getByRole('button', { name: /add parameter/i }));
    expect(screen.getByLabelText(/parameter 2 key/i)).toBeInTheDocument();
  });

  it('removes a parameter and reflects it in the rebuilt URL', async () => {
    render(<UrlTool />);
    typeInto(screen.getByLabelText(/plain text/i), 'https://x.dev/?tag=alpha');
    await screen.findByDisplayValue('alpha');

    fireEvent.click(screen.getByRole('button', { name: /remove parameter 1/i }));
    expect(await screen.findByText('https://x.dev/')).toBeInTheDocument();
  });

  it('loads the rebuilt URL back into the input on request', async () => {
    render(<UrlTool />);
    typeInto(screen.getByLabelText(/plain text/i), 'https://x.dev/?tag=alpha');
    await screen.findByDisplayValue('alpha');
    typeInto(screen.getByLabelText(/parameter 1 value/i), 'beta');
    await screen.findByText('https://x.dev/?tag=beta');

    fireEvent.click(screen.getByRole('button', { name: /use as input/i }));
    const mainInput = screen.getByLabelText(/plain text/i) as HTMLTextAreaElement;
    expect(mainInput.value).toBe('https://x.dev/?tag=beta');
  });
});
