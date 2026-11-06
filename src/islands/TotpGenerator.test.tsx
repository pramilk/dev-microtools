import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/preact';
import TotpGenerator from './TotpGenerator';

// Only the clock is faked, so timers, promises and SubtleCrypto behave normally.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  // T = 59s → HOTP counter 1 for the RFC secret → 287082 (RFC 4226 appendix D).
  vi.setSystemTime(59_000);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const secretInput = () => screen.getByLabelText(/secret \(base32\)/i) as HTMLInputElement;
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('<TotpGenerator />', () => {
  it('shows a hint and no code until there is a secret', () => {
    render(<TotpGenerator />);
    expect(screen.getByText(/enter a secret, paste an otpauth/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/current one-time code/i)).not.toBeInTheDocument();
  });

  it('computes the RFC test-vector code for a typed secret', async () => {
    render(<TotpGenerator />);
    fireEvent.input(secretInput(), { target: { value: RFC_SECRET } });

    const code = await screen.findByLabelText(/current one-time code/i);
    await waitFor(() => expect(code).toHaveTextContent('287 082'));
  });

  it('accepts a spaced, lower-case secret', async () => {
    render(<TotpGenerator />);
    fireEvent.input(secretInput(), { target: { value: 'gezd gnbv gy3t qojq gezd gnbv gy3t qojq' } });

    await waitFor(() => expect(screen.getByLabelText(/current one-time code/i)).toHaveTextContent('287 082'));
  });

  it('shows the previous and next codes', async () => {
    render(<TotpGenerator />);
    fireEvent.input(secretInput(), { target: { value: RFC_SECRET } });

    await waitFor(() => expect(screen.getByLabelText(/current one-time code/i)).toHaveTextContent('287 082'));
    // Counter 0 and counter 2 from RFC 4226 appendix D.
    expect(screen.getByText('755 224')).toBeInTheDocument();
    expect(screen.getByText('359 152')).toBeInTheDocument();
  });

  it('shows a visible error for an invalid secret, never a code', async () => {
    render(<TotpGenerator />);
    fireEvent.input(secretInput(), { target: { value: 'not base32!' } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/not valid in a base32 secret/i);
    expect(screen.queryByLabelText(/current one-time code/i)).not.toBeInTheDocument();
  });

  it('warns when the secret is shorter than 128 bits but still shows a code', async () => {
    render(<TotpGenerator />);
    fireEvent.input(secretInput(), { target: { value: 'JBSWY3DP' } });

    expect(await screen.findByText(/only 40 bits/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/current one-time code/i)).toBeInTheDocument();
  });

  it('changes the code length with the Digits setting', async () => {
    render(<TotpGenerator />);
    fireEvent.input(secretInput(), { target: { value: RFC_SECRET } });
    await waitFor(() => expect(screen.getByLabelText(/current one-time code/i)).toHaveTextContent('287 082'));

    fireEvent.change(screen.getByLabelText(/^digits$/i), { target: { value: '8' } });

    // 94287082 is the published RFC 6238 vector for SHA-1 at T=59, 8 digits.
    await waitFor(() => expect(screen.getByLabelText(/current one-time code/i)).toHaveTextContent('9428 7082'));
  });

  it('rejects an out-of-range period with an error', async () => {
    render(<TotpGenerator />);
    fireEvent.input(secretInput(), { target: { value: RFC_SECRET } });
    fireEvent.input(screen.getByLabelText(/period/i), { target: { value: '2' } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/between 5 and 300/i);
    expect(screen.queryByLabelText(/current one-time code/i)).not.toBeInTheDocument();
  });

  it('validates a correct code and rejects a wrong one', async () => {
    render(<TotpGenerator />);
    fireEvent.input(secretInput(), { target: { value: RFC_SECRET } });
    await waitFor(() => expect(screen.getByLabelText(/current one-time code/i)).toHaveTextContent('287 082'));

    fireEvent.input(screen.getByLabelText(/code to check/i), { target: { value: '287082' } });
    expect(await screen.findByText(/valid: this is the current code/i)).toBeInTheDocument();

    fireEvent.input(screen.getByLabelText(/code to check/i), { target: { value: '000000' } });
    expect(await screen.findByText(/not valid: it does not match/i)).toBeInTheDocument();
  });

  it('recognises the previous code as valid', async () => {
    render(<TotpGenerator />);
    fireEvent.input(secretInput(), { target: { value: RFC_SECRET } });
    await waitFor(() => expect(screen.getByLabelText(/current one-time code/i)).toHaveTextContent('287 082'));

    fireEvent.input(screen.getByLabelText(/code to check/i), { target: { value: '755224' } });
    expect(await screen.findByText(/previous code/i)).toBeInTheDocument();
  });

  it('explains a malformed code to check', async () => {
    render(<TotpGenerator />);
    fireEvent.input(secretInput(), { target: { value: RFC_SECRET } });
    await waitFor(() => expect(screen.getByLabelText(/current one-time code/i)).toHaveTextContent('287 082'));

    fireEvent.input(screen.getByLabelText(/code to check/i), { target: { value: '12ab' } });
    expect(await screen.findByRole('alert')).toHaveTextContent(/digits only/i);
  });

  it('generates a random secret and shows a code for it', async () => {
    render(<TotpGenerator />);
    fireEvent.click(screen.getByRole('button', { name: /generate secret/i }));

    await waitFor(() => expect(secretInput().value).toMatch(/^([A-Z2-7]{4} )+[A-Z2-7]{1,4}$/));
    expect(await screen.findByLabelText(/current one-time code/i)).toBeInTheDocument();
  });

  it('fills every field from a pasted otpauth link', async () => {
    render(<TotpGenerator />);
    fireEvent.input(secretInput(), {
      target: { value: `otpauth://totp/GitHub:octocat?secret=${RFC_SECRET}&issuer=GitHub&digits=8&period=60&algorithm=SHA256` },
    });

    await waitFor(() => expect(secretInput().value).toBe(RFC_SECRET));
    expect((screen.getByLabelText(/^digits$/i) as HTMLSelectElement).value).toBe('8');
    expect((screen.getByLabelText(/algorithm/i) as HTMLSelectElement).value).toBe('SHA-256');
    expect((screen.getByLabelText(/period/i) as HTMLInputElement).value).toBe('60');
    expect((screen.getByLabelText(/issuer/i) as HTMLInputElement).value).toBe('GitHub');
    expect((screen.getByLabelText(/account name/i) as HTMLInputElement).value).toBe('octocat');
  });

  it('explains a bad otpauth link', async () => {
    render(<TotpGenerator />);
    fireEvent.input(secretInput(), { target: { value: 'otpauth://hotp/x?secret=JBSWY3DP&counter=1' } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/HOTP/);
  });

  it('builds an otpauth link and a QR code for the enrolment card', async () => {
    render(<TotpGenerator />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    expect(await screen.findByText(/^otpauth:\/\/totp\/Example:alice%40example\.com\?secret=GEZDGNBV/)).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('.totp-qr svg')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /copy otpauth link/i })).toBeInTheDocument();
  });

  it('fills the example secret and shows its code', async () => {
    render(<TotpGenerator />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    expect(secretInput().value).toBe(RFC_SECRET);
    await waitFor(() => expect(screen.getByLabelText(/current one-time code/i)).toHaveTextContent('287 082'));
  });

  it('clears everything when Clear is pressed', async () => {
    render(<TotpGenerator />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    await screen.findByLabelText(/current one-time code/i);

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(secretInput()).toHaveValue('');
    expect(screen.queryByLabelText(/current one-time code/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^clear$/i })).toBeDisabled();
  });

  it('copies the current code', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(<TotpGenerator />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    await waitFor(() => expect(screen.getByLabelText(/current one-time code/i)).toHaveTextContent('287 082'));

    fireEvent.click(screen.getByRole('button', { name: /copy code/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('287082'));
  });

  it('has no share link, because the input is a secret', () => {
    render(<TotpGenerator />);
    expect(screen.queryByRole('button', { name: /copy link/i })).not.toBeInTheDocument();
  });

  it('has a collapsed help section explaining where to find the secret', () => {
    render(<TotpGenerator />);
    const help = screen.getByText(/where do i find the secret key/i).closest('details') as HTMLDetailsElement;
    expect(help.open).toBe(false);
    expect(within(help).getByText(/can.t scan it/i)).toBeInTheDocument();
  });
});
