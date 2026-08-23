import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import UrlParser from './UrlParser';

const typeInto = (element: HTMLElement, value: string) => {
  fireEvent.input(element, { target: { value } });
};

describe('<UrlParser />', () => {
  it('shows nothing until a URL is typed', () => {
    render(<UrlParser />);
    expect(screen.queryByText('URL breakdown')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('parses a full URL live and shows the breakdown', async () => {
    render(<UrlParser />);
    typeInto(screen.getByLabelText(/^url$/i), 'https://example.com:8443/a/b?x=1#frag');

    expect(await screen.findByText('URL breakdown')).toBeInTheDocument();
    expect(screen.getByText('example.com')).toBeInTheDocument();
    expect(screen.getByText('8443')).toBeInTheDocument();
    expect(screen.getByText('/a/b')).toBeInTheDocument();
  });

  it('shows a visible error, not a stack trace, for an invalid URL', async () => {
    render(<UrlParser />);
    typeInto(screen.getByLabelText(/^url$/i), 'example.com/foo');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/scheme/i);
    expect(screen.queryByText('URL breakdown')).not.toBeInTheDocument();
  });

  it('clears the error once the URL becomes valid', async () => {
    render(<UrlParser />);
    const input = screen.getByLabelText(/^url$/i);
    typeInto(input, 'example.com/foo');
    await screen.findByRole('alert');

    typeInto(input, 'https://example.com/foo');
    expect(await screen.findByText('URL breakdown')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('lists query parameters from the URL as editable rows', async () => {
    render(<UrlParser />);
    typeInto(screen.getByLabelText(/^url$/i), 'https://x.dev/?tag=alpha');

    expect(await screen.findByText('Query parameters')).toBeInTheDocument();
    expect(screen.getByDisplayValue('tag')).toBeInTheDocument();
    expect(screen.getByDisplayValue('alpha')).toBeInTheDocument();
  });

  it('preserves duplicate keys as separate rows in original order', async () => {
    render(<UrlParser />);
    typeInto(screen.getByLabelText(/^url$/i), 'https://x.dev/?a=1&b=2&a=3');
    await screen.findByText('Query parameters');

    expect(screen.getByLabelText(/parameter 1 key/i)).toHaveValue('a');
    expect(screen.getByLabelText(/parameter 1 value/i)).toHaveValue('1');
    expect(screen.getByLabelText(/parameter 2 key/i)).toHaveValue('b');
    expect(screen.getByLabelText(/parameter 3 key/i)).toHaveValue('a');
    expect(screen.getByLabelText(/parameter 3 value/i)).toHaveValue('3');
  });

  it('rebuilds the result URL live as a parameter value is edited', async () => {
    render(<UrlParser />);
    typeInto(screen.getByLabelText(/^url$/i), 'https://x.dev/?tag=alpha');
    await screen.findByDisplayValue('alpha');

    typeInto(screen.getByLabelText(/parameter 1 value/i), 'beta');
    expect(await screen.findByText('https://x.dev/?tag=beta')).toBeInTheDocument();
  });

  it('rebuilds the result URL live as a parameter key is edited', async () => {
    render(<UrlParser />);
    typeInto(screen.getByLabelText(/^url$/i), 'https://x.dev/?tag=alpha');
    await screen.findByDisplayValue('alpha');

    typeInto(screen.getByLabelText(/parameter 1 key/i), 'label');
    expect(await screen.findByText('https://x.dev/?label=alpha')).toBeInTheDocument();
  });

  it('adds a new, empty parameter row', async () => {
    render(<UrlParser />);
    typeInto(screen.getByLabelText(/^url$/i), 'https://x.dev/?tag=alpha');
    await screen.findByDisplayValue('alpha');

    fireEvent.click(screen.getByRole('button', { name: /add parameter/i }));
    expect(screen.getByLabelText(/parameter 2 key/i)).toBeInTheDocument();
  });

  it('removes a parameter and reflects it in the rebuilt URL', async () => {
    render(<UrlParser />);
    typeInto(screen.getByLabelText(/^url$/i), 'https://x.dev/?tag=alpha');
    await screen.findByDisplayValue('alpha');

    fireEvent.click(screen.getByRole('button', { name: /remove parameter 1/i }));
    expect(await screen.findByText('https://x.dev/')).toBeInTheDocument();
  });

  it('shows the base URL with no query string once every parameter is removed', async () => {
    render(<UrlParser />);
    typeInto(screen.getByLabelText(/^url$/i), 'https://x.dev/path?x=1&y=2');
    await screen.findByDisplayValue('1');

    fireEvent.click(screen.getByRole('button', { name: /remove parameter 1/i }));
    fireEvent.click(screen.getByRole('button', { name: /remove parameter 1/i }));
    expect(await screen.findByText('https://x.dev/path')).toBeInTheDocument();
  });

  it('copies the result URL via its copy button', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<UrlParser />);
    typeInto(screen.getByLabelText(/^url$/i), 'https://x.dev/?tag=alpha');
    await screen.findByDisplayValue('alpha');

    fireEvent.click(screen.getByRole('button', { name: /^copy$/i }));
    expect(writeText).toHaveBeenCalledWith('https://x.dev/?tag=alpha');
  });

  it('copies the whole breakdown as text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<UrlParser />);
    typeInto(screen.getByLabelText(/^url$/i), 'https://example.com/path?x=1');
    await screen.findByText('URL breakdown');

    fireEvent.click(screen.getByRole('button', { name: /copy breakdown/i }));
    expect(writeText).toHaveBeenCalled();
    const copiedText = writeText.mock.calls[0][0] as string;
    expect(copiedText).toContain('Host: example.com');
  });

  it('loads a sample URL that parses successfully', async () => {
    render(<UrlParser />);
    const input = screen.getByLabelText(/^url$/i) as HTMLInputElement;

    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    expect(input.value).not.toBe('');
    expect(await screen.findByText('URL breakdown')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('clears the input and hides the breakdown', async () => {
    render(<UrlParser />);
    const input = screen.getByLabelText(/^url$/i) as HTMLInputElement;
    typeInto(input, 'https://example.com/path');
    await screen.findByText('URL breakdown');

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    expect(input.value).toBe('');
    expect(screen.queryByText('URL breakdown')).not.toBeInTheDocument();
  });
});
