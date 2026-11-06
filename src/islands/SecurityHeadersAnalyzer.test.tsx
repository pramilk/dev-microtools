import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/preact';
import SecurityHeadersAnalyzer from './SecurityHeadersAnalyzer';

afterEach(() => {
  vi.unstubAllGlobals();
});

const input = () => screen.getByLabelText(/response headers/i) as HTMLTextAreaElement;

const GOOD = [
  'HTTP/2 200',
  'strict-transport-security: max-age=63072000; includeSubDomains',
  "content-security-policy: default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
  'x-content-type-options: nosniff',
  'referrer-policy: strict-origin-when-cross-origin',
  'permissions-policy: camera=()',
  'cross-origin-opener-policy: same-origin',
  'cross-origin-resource-policy: same-origin',
].join('\n');

describe('<SecurityHeadersAnalyzer />', () => {
  it('shows only the empty input at first', () => {
    render(<SecurityHeadersAnalyzer />);
    expect(input()).toHaveValue('');
    expect(screen.queryByText(/security headers grade/i)).not.toBeInTheDocument();
  });

  it('grades pasted headers and lists the findings', async () => {
    render(<SecurityHeadersAnalyzer />);
    fireEvent.input(input(), { target: { value: 'HTTP/1.1 200 OK\nServer: Apache/2.4.41\nContent-Type: text/html' } });

    expect(await screen.findByText(/security headers grade: f/i)).toBeInTheDocument();
    expect(screen.getByText('HSTS is not set')).toBeInTheDocument();
    expect(screen.getByText(/server header reveals a version/i)).toBeInTheDocument();
  });

  it('gives hardened headers a top grade', async () => {
    render(<SecurityHeadersAnalyzer />);
    fireEvent.input(input(), { target: { value: GOOD } });

    expect(await screen.findByText(/security headers grade: a\+?$/i)).toBeInTheDocument();
  });

  it('offers recommended header lines and a copy button for them', async () => {
    render(<SecurityHeadersAnalyzer />);
    fireEvent.input(input(), { target: { value: 'Content-Type: text/html' } });

    await screen.findByText(/recommended headers/i);
    expect(screen.getAllByText(/X-Content-Type-Options: nosniff/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /copy recommended/i })).toBeInTheDocument();
  });

  it('shows a visible error for text that is not headers', async () => {
    render(<SecurityHeadersAnalyzer />);
    fireEvent.input(input(), { target: { value: 'just a sentence without any headers' } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/no headers found/i);
  });

  it('fills the example and flags its problems', async () => {
    render(<SecurityHeadersAnalyzer />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    expect(input().value).toContain('x-powered-by: Express');
    expect(await screen.findByText(/security headers grade: f/i)).toBeInTheDocument();
    expect(screen.getByText(/HSTS lifetime is short \(5 minutes\)/)).toBeInTheDocument();
  });

  it('clears the input and results', async () => {
    render(<SecurityHeadersAnalyzer />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    await screen.findByText(/security headers grade/i);

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(input()).toHaveValue('');
    expect(screen.queryByText(/security headers grade/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^clear$/i })).toBeDisabled();
  });

  it('copies a plain-text report', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(<SecurityHeadersAnalyzer />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    await screen.findByText(/security headers grade/i);

    fireEvent.click(screen.getByRole('button', { name: /copy report/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toMatch(/grade F/);
  });

  it('disables Copy report until there is a result', () => {
    render(<SecurityHeadersAnalyzer />);
    expect(screen.getByRole('button', { name: /copy report/i })).toBeDisabled();
  });

  it('offers a share link', () => {
    render(<SecurityHeadersAnalyzer />);
    expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument();
  });

  it('explains how to get the headers, collapsed by default and above the input', () => {
    render(<SecurityHeadersAnalyzer />);
    const help = screen.getByText(/how do i get the response headers/i).closest('details') as HTMLDetailsElement;

    expect(help.open).toBe(false);
    expect(help.compareDocumentPosition(input()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(help).getByText(/curl -I/)).toBeInTheDocument();
    expect(within(help).getByRole('heading', { name: /chrome, edge/i })).toBeInTheDocument();
    expect(within(help).getByRole('heading', { name: /safari/i })).toBeInTheDocument();
  });

  it('notes when a redirect chain was pasted and only the last response graded', async () => {
    render(<SecurityHeadersAnalyzer />);
    fireEvent.input(input(), { target: { value: `HTTP/1.1 301 Moved\nLocation: https://a.example/\n\n${GOOD}` } });

    expect(await screen.findByText(/2 responses/i)).toBeInTheDocument();
  });
});
