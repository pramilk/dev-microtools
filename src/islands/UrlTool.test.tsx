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

    expect(await screen.findByText('https://x.dev/a%20b')).toBeInTheDocument();
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

  it('lists query parameters from a full URL', async () => {
    render(<UrlTool />);
    typeInto(screen.getByLabelText(/plain text/i), 'https://x.dev/?tag=alpha');

    expect(await screen.findByText('Query parameters')).toBeInTheDocument();
    expect(screen.getByText('alpha')).toBeInTheDocument();
  });

  it('explains the difference between the two scopes', () => {
    render(<UrlTool />);
    expect(screen.getByText(/correct for a single query-string value/i)).toBeInTheDocument();
  });
});
