import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import CurlCommandBuilder from './CurlCommandBuilder';

const typeInto = (element: HTMLElement, value: string) => {
  fireEvent.input(element, { target: { value } });
};

function fakeResponse({
  status = 200,
  statusText = 'OK',
  headers = {},
  body = '',
}: {
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  body?: string;
}) {
  return {
    status,
    statusText,
    headers: { entries: () => Object.entries(headers) },
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  };
}

describe('<CurlCommandBuilder />', () => {
  it('shows a placeholder until a URL is entered', () => {
    render(<CurlCommandBuilder />);
    expect(screen.getByText('Enter a URL above to build a command.')).toBeInTheDocument();
  });

  it('builds a GET command live as the URL is typed', async () => {
    render(<CurlCommandBuilder />);
    typeInto(screen.getByLabelText(/^url$/i), 'https://example.com/api');

    expect(await screen.findByText(/curl \\/)).toBeInTheDocument();
    expect(screen.getByText(/'https:\/\/example\.com\/api'/)).toBeInTheDocument();
  });

  it('shows a visible error, not a stack trace, for an invalid URL', async () => {
    render(<CurlCommandBuilder />);
    typeInto(screen.getByLabelText(/^url$/i), 'not a url');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/valid, absolute URL/i);
  });

  it('changes method via the select and reflects -X in the output', async () => {
    render(<CurlCommandBuilder />);
    typeInto(screen.getByLabelText(/^url$/i), 'https://example.com');
    fireEvent.change(screen.getByLabelText(/^method$/i), { target: { value: 'POST' } });

    expect(await screen.findByText(/-X POST/)).toBeInTheDocument();
  });

  it('adds a header row and includes it in the command', async () => {
    render(<CurlCommandBuilder />);
    typeInto(screen.getByLabelText(/^url$/i), 'https://example.com');
    fireEvent.click(screen.getByRole('button', { name: /add header/i }));

    typeInto(screen.getByLabelText(/header 1 name/i), 'Accept');
    typeInto(screen.getByLabelText(/header 1 value/i), 'application/json');

    expect(await screen.findByText(/Accept: application\/json/)).toBeInTheDocument();
  });

  it('removes a header row', async () => {
    render(<CurlCommandBuilder />);
    fireEvent.click(screen.getByRole('button', { name: /add header/i }));
    expect(screen.getByLabelText(/header 1 name/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /remove header 1/i }));
    expect(screen.queryByLabelText(/header 1 name/i)).not.toBeInTheDocument();
  });

  it('shows a JSON body textarea, validates it, and adds Content-Type automatically', async () => {
    render(<CurlCommandBuilder />);
    typeInto(screen.getByLabelText(/^url$/i), 'https://example.com');
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));

    typeInto(screen.getByLabelText(/request body/i), '{"a":1}');
    expect(await screen.findByText(/Content-Type: application\/json/)).toBeInTheDocument();

    typeInto(screen.getByLabelText(/request body/i), '{not json');
    expect(await screen.findByRole('alert')).toHaveTextContent(/valid JSON/i);
  });

  it('toggles between multi-line and single-line output', async () => {
    render(<CurlCommandBuilder />);
    typeInto(screen.getByLabelText(/^url$/i), 'https://example.com');
    await screen.findByText(/curl \\/);

    fireEvent.click(screen.getByRole('button', { name: /single line/i }));
    expect(screen.queryByText(/curl \\/)).not.toBeInTheDocument();
    expect(screen.getByText(/^curl 'https:\/\/example\.com'$/)).toBeInTheDocument();
  });

  it('adds enabled option flags to the command', async () => {
    render(<CurlCommandBuilder />);
    typeInto(screen.getByLabelText(/^url$/i), 'https://example.com');
    fireEvent.click(screen.getByRole('button', { name: /single line/i }));
    fireEvent.click(screen.getByLabelText(/skip ssl verification/i));
    fireEvent.click(screen.getByLabelText(/follow redirects/i));

    expect(await screen.findByText(/curl -k -L 'https:\/\/example\.com'/)).toBeInTheDocument();
  });

  it('loads a header/query-string sample for the default GET method, with no body', async () => {
    render(<CurlCommandBuilder />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    expect(await screen.findByText(/Accept: application\/json/)).toBeInTheDocument();
    expect(screen.getByText(/role=engineer/)).toBeInTheDocument();
    expect(screen.queryByText(/-X/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('loads a JSON-body sample when a body-bearing method is selected first', async () => {
    render(<CurlCommandBuilder />);
    fireEvent.change(screen.getByLabelText(/^method$/i), { target: { value: 'POST' } });
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    expect(await screen.findByText(/-X POST/)).toBeInTheDocument();
    expect(screen.getByText(/Authorization: Bearer TOKEN123/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not clobber a method the user already picked when loading the example', async () => {
    render(<CurlCommandBuilder />);
    fireEvent.change(screen.getByLabelText(/^method$/i), { target: { value: 'PUT' } });
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    expect((screen.getByLabelText(/^method$/i) as HTMLSelectElement).value).toBe('PUT');
    expect(await screen.findByText(/-X PUT/)).toBeInTheDocument();
  });

  it('adds an explicit -X GET when GET has a body, so the command does not silently become a POST', async () => {
    render(<CurlCommandBuilder />);
    typeInto(screen.getByLabelText(/^url$/i), 'https://example.com');
    fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
    typeInto(screen.getByLabelText(/request body/i), '{"a":1}');

    expect(await screen.findByText(/-X GET/)).toBeInTheDocument();
  });

  it('clears every field back to empty', async () => {
    render(<CurlCommandBuilder />);
    const urlInput = screen.getByLabelText(/^url$/i) as HTMLInputElement;
    typeInto(urlInput, 'https://example.com');
    await screen.findByText(/curl \\/);

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    expect(urlInput.value).toBe('');
    expect(screen.getByText('Enter a URL above to build a command.')).toBeInTheDocument();
  });

  it('copies the command via its copy button', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<CurlCommandBuilder />);
    typeInto(screen.getByLabelText(/^url$/i), 'https://example.com');
    fireEvent.click(screen.getByRole('button', { name: /single line/i }));
    await screen.findByText(/^curl 'https:\/\/example\.com'$/);

    fireEvent.click(screen.getByRole('button', { name: /^copy$/i }));
    expect(writeText).toHaveBeenCalledWith("curl 'https://example.com'");
  });

  describe('Send request', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('disables Send request until the command is valid', () => {
      render(<CurlCommandBuilder />);
      expect(screen.getByRole('button', { name: /^send request$/i })).toBeDisabled();
    });

    it('sends the request and shows the JSON response as a collapsible tree', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          fakeResponse({ status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, body: '{"ok":true}' })
        )
      );

      render(<CurlCommandBuilder />);
      typeInto(screen.getByLabelText(/^url$/i), 'https://example.com/api');
      fireEvent.click(screen.getByRole('button', { name: /^send request$/i }));

      expect(await screen.findByText(/200 OK/)).toBeInTheDocument();
      expect(screen.getByText('Response headers (1)')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^tree$/i })).toBeInTheDocument();
      expect(screen.getByText('true')).toBeInTheDocument();
    });

    it('shows the response as raw text when the body is not JSON', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse({ body: 'plain text response' })));

      render(<CurlCommandBuilder />);
      typeInto(screen.getByLabelText(/^url$/i), 'https://example.com');
      fireEvent.click(screen.getByRole('button', { name: /^send request$/i }));

      expect(await screen.findByText('plain text response')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^tree$/i })).not.toBeInTheDocument();
    });

    it('lets the JSON response be viewed as raw text too', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse({ body: '{"ok":true}' })));

      render(<CurlCommandBuilder />);
      typeInto(screen.getByLabelText(/^url$/i), 'https://example.com');
      fireEvent.click(screen.getByRole('button', { name: /^send request$/i }));
      await screen.findByRole('button', { name: /^tree$/i });

      // Two "Raw" buttons exist on the page — the body-type selector and this response-view
      // toggle — so pick the last one, which is the one that just appeared with the response.
      const rawButtons = screen.getAllByRole('button', { name: /^raw$/i });
      fireEvent.click(rawButtons[rawButtons.length - 1]!);
      expect(screen.getByText('{"ok":true}')).toBeInTheDocument();
    });

    it('shows a CORS-aware error message when the request fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

      render(<CurlCommandBuilder />);
      typeInto(screen.getByLabelText(/^url$/i), 'https://example.com');
      fireEvent.click(screen.getByRole('button', { name: /^send request$/i }));

      expect(await screen.findByRole('alert')).toHaveTextContent(/CORS/i);
    });

    it('sends the built request method, headers and body to fetch', async () => {
      const fetchMock = vi.fn().mockResolvedValue(fakeResponse({ body: '' }));
      vi.stubGlobal('fetch', fetchMock);

      render(<CurlCommandBuilder />);
      typeInto(screen.getByLabelText(/^url$/i), 'https://example.com');
      fireEvent.change(screen.getByLabelText(/^method$/i), { target: { value: 'POST' } });
      fireEvent.click(screen.getByRole('button', { name: 'JSON' }));
      typeInto(screen.getByLabelText(/request body/i), '{"a":1}');

      fireEvent.click(screen.getByRole('button', { name: /^send request$/i }));
      await screen.findByText(/200 OK/);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://example.com',
        expect.objectContaining({
          method: 'POST',
          body: '{"a":1}',
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        })
      );
    });
  });
});
