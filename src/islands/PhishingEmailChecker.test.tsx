import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/preact';
import PhishingEmailChecker from './PhishingEmailChecker';

afterEach(() => {
  vi.unstubAllGlobals();
});

const input = () => screen.getByLabelText(/email source/i) as HTMLTextAreaElement;

const PHISHING = [
  'From: "PayPal Support" <service@paypa1-secure.top>',
  'Reply-To: helpdesk@mail-recovery.example',
  'Subject: Urgent: verify your password',
  'Authentication-Results: mx; spf=fail; dkim=none; dmarc=fail',
  'Content-Type: text/html',
  '',
  '<p>Your account will be closed within 24 hours unless you verify your password immediately.</p>',
  '<a href="http://198.51.100.7/login">https://www.paypal.com/verify</a>',
].join('\n');

describe('<PhishingEmailChecker />', () => {
  it('shows nothing but the empty input at first', () => {
    render(<PhishingEmailChecker />);
    expect(input()).toHaveValue('');
    expect(screen.queryByText(/risk score/i)).not.toBeInTheDocument();
  });

  it('analyses a pasted email and shows the verdict and findings', async () => {
    render(<PhishingEmailChecker />);
    fireEvent.input(input(), { target: { value: PHISHING } });

    expect(await screen.findByText(/strong phishing signals/i)).toBeInTheDocument();
    expect(screen.getByText(/SPF failed/)).toBeInTheDocument();
    expect(screen.getByText(/claims to be paypal/i)).toBeInTheDocument();
    expect(screen.getByText(/replies go to a different domain/i)).toBeInTheDocument();
  });

  it('shows links as plain text, never as clickable anchors', async () => {
    render(<PhishingEmailChecker />);
    fireEvent.input(input(), { target: { value: PHISHING } });

    await screen.findByText(/links found/i);
    expect(screen.getByText('http://198.51.100.7/login')).toBeInTheDocument();
    expect(document.querySelectorAll('.pec-result a')).toHaveLength(0);
  });

  it('reports a low-risk result without calling the email safe', async () => {
    render(<PhishingEmailChecker />);
    fireEvent.input(input(), {
      target: { value: 'From: Jane <jane@acme.com>\nSubject: Lunch?\nMessage-ID: <1@acme.com>\n\nFree Thursday?' },
    });

    expect(await screen.findByText(/no strong phishing signals/i)).toBeInTheDocument();
    expect(screen.getByText(/not a guarantee/i)).toBeInTheDocument();
    expect(screen.queryByText(/^safe$/i)).not.toBeInTheDocument();
  });

  it('fills the sample email when Load example is pressed', async () => {
    render(<PhishingEmailChecker />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    expect(input().value).toContain('paypa1-secure.top');
    expect(await screen.findByText(/strong phishing signals/i)).toBeInTheDocument();
  });

  it('clears the input and the results when Clear is pressed', async () => {
    render(<PhishingEmailChecker />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    await screen.findByText(/strong phishing signals/i);

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(input()).toHaveValue('');
    expect(screen.queryByText(/strong phishing signals/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^clear$/i })).toBeDisabled();
  });

  it('copies a plain-text report', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(<PhishingEmailChecker />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    await screen.findByText(/strong phishing signals/i);

    fireEvent.click(screen.getByRole('button', { name: /copy report/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toMatch(/risk score 100\/100/);
  });

  it('disables Copy report until there is something to copy', () => {
    render(<PhishingEmailChecker />);
    expect(screen.getByRole('button', { name: /copy report/i })).toBeDisabled();
  });

  it('offers a share link, which every non-secret tool needs', () => {
    render(<PhishingEmailChecker />);
    expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument();
  });

  it('explains how to get the raw email from Gmail and Outlook', () => {
    render(<PhishingEmailChecker />);
    const help = screen.getByText(/how do i get the raw email/i).closest('details') as HTMLElement;

    expect(help).toBeInTheDocument();
    expect(help).not.toHaveAttribute('open');
    // It sits above the input, which is what the visitor reads first.
    expect(help.compareDocumentPosition(input()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(help).getByRole('heading', { name: /^gmail$/i })).toBeInTheDocument();
    expect(within(help).getByText(/show original/i)).toBeInTheDocument();
    expect(within(help).getByRole('heading', { name: /outlook on the web/i })).toBeInTheDocument();
    expect(within(help).getByText(/view message source/i)).toBeInTheDocument();
    expect(within(help).getByRole('heading', { name: /outlook for windows/i })).toBeInTheDocument();
    expect(within(help).getAllByText(/internet headers/i).length).toBeGreaterThan(0);
  });

  it('notes that only the body was checked when no headers are pasted', async () => {
    render(<PhishingEmailChecker />);
    fireEvent.input(input(), { target: { value: 'Dear customer, verify your password at https://bit.ly/3xyz' } });

    expect(await screen.findByText(/no headers pasted/i)).toBeInTheDocument();
    expect(screen.queryByText(/message details/i)).not.toBeInTheDocument();
  });

  it('does not throw or show a raw error for malformed input', async () => {
    render(<PhishingEmailChecker />);
    fireEvent.input(input(), { target: { value: '\u0000<<<=?=?? ::::' } });

    expect(await screen.findByText(/risk score/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
