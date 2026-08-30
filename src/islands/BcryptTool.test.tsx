import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import { createFakeWorkerClass } from '../../test/fakeWorker';
import { handleBcryptRequest } from '../workers/bcrypt.worker';
import BcryptTool from './BcryptTool';

// jsdom has no real Worker; this runs the same request-handling logic the real
// bcrypt.worker.ts uses, synchronously, so the test still exercises real bcryptjs.
vi.mock('../workers/bcrypt.worker?worker', () => ({
  default: createFakeWorkerClass(handleBcryptRequest),
}));

const typeInto = (element: HTMLElement, value: string) => {
  fireEvent.input(element, { target: { value } });
};

const setLowRounds = () => {
  typeInto(screen.getByLabelText(/rounds/i), '4');
};

// Bcrypt hashing is real, non-trivial work even at the lowest round count, and the
// dynamic import of bcryptjs itself adds latency the first time it runs in a test file.
const HASH_TIMEOUT = 10000;

describe('<BcryptTool /> generate mode', () => {
  it('shows no hash before generating', () => {
    render(<BcryptTool />);
    expect(screen.queryByText(/^\$2/)).not.toBeInTheDocument();
  });

  it('disables the generate button until a password is entered', () => {
    render(<BcryptTool />);
    expect(screen.getByRole('button', { name: /generate hash/i })).toBeDisabled();
    typeInto(screen.getByLabelText(/^password$/i), 'hunter2');
    expect(screen.getByRole('button', { name: /generate hash/i })).not.toBeDisabled();
  });

  it(
    'produces a bcrypt hash after clicking Generate hash',
    async () => {
      render(<BcryptTool />);
      setLowRounds();
      typeInto(screen.getByLabelText(/^password$/i), 'hunter2');
      fireEvent.click(screen.getByRole('button', { name: /generate hash/i }));

      const hashEl = await screen.findByText(/^\$2/, {}, { timeout: HASH_TIMEOUT });
      expect(hashEl.textContent).toHaveLength(60);
    },
    HASH_TIMEOUT
  );

  it('rejects a round count above the maximum with a visible error', async () => {
    render(<BcryptTool />);
    typeInto(screen.getByLabelText(/^password$/i), 'hunter2');
    typeInto(screen.getByLabelText(/rounds/i), '20');
    fireEvent.click(screen.getByRole('button', { name: /generate hash/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/14 or lower/i);
  });

  it(
    'clears the password and hash',
    async () => {
      render(<BcryptTool />);
      setLowRounds();
      typeInto(screen.getByLabelText(/^password$/i), 'hunter2');
      fireEvent.click(screen.getByRole('button', { name: /generate hash/i }));
      await screen.findByText(/^\$2/, {}, { timeout: HASH_TIMEOUT });

      fireEvent.click(screen.getByRole('button', { name: /clear/i }));
      expect(screen.queryByText(/^\$2/)).not.toBeInTheDocument();
      expect((screen.getByLabelText(/^password$/i) as HTMLInputElement).value).toBe('');
    },
    HASH_TIMEOUT
  );

  it(
    'copies the generated hash to the clipboard',
    async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });

      render(<BcryptTool />);
      setLowRounds();
      typeInto(screen.getByLabelText(/^password$/i), 'hunter2');
      fireEvent.click(screen.getByRole('button', { name: /generate hash/i }));
      const hashEl = await screen.findByText(/^\$2/, {}, { timeout: HASH_TIMEOUT });
      const hash = hashEl.textContent ?? '';

      fireEvent.click(screen.getByRole('button', { name: /^copy/i }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(hash));
    },
    HASH_TIMEOUT
  );
});

describe('<BcryptTool /> verify mode', () => {
  // The mode toggle and the primary action button have distinct accessible names
  // ("Verify" vs. "Verify hash") specifically so both can be queried unambiguously
  // once verify mode is active and both are on screen at once.
  const switchToVerify = () => fireEvent.click(screen.getByRole('button', { name: /^verify$/i }));

  it('disables the verify button until both fields are filled', () => {
    render(<BcryptTool />);
    switchToVerify();
    expect(screen.getByRole('button', { name: /^verify hash$/i })).toBeDisabled();
    typeInto(screen.getByLabelText(/^password$/i), 'hunter2');
    expect(screen.getByRole('button', { name: /^verify hash$/i })).toBeDisabled();
    typeInto(screen.getByLabelText(/bcrypt hash/i), '$2a$04$abcdefghijklmnopqrstuuvwxyzabcdefghijklmnopqrstuvw');
    expect(screen.getByRole('button', { name: /^verify hash$/i })).not.toBeDisabled();
  });

  it('shows a clear error for a malformed hash instead of a raw crash', async () => {
    render(<BcryptTool />);
    switchToVerify();
    typeInto(screen.getByLabelText(/^password$/i), 'hunter2');
    typeInto(screen.getByLabelText(/bcrypt hash/i), 'not-a-hash');
    fireEvent.click(screen.getByRole('button', { name: /^verify hash$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/doesn't look like a bcrypt hash/i);
  });

  it(
    'reports a match for the correct password against a freshly generated hash',
    async () => {
      render(<BcryptTool />);
      setLowRounds();
      typeInto(screen.getByLabelText(/^password$/i), 'hunter2');
      fireEvent.click(screen.getByRole('button', { name: /generate hash/i }));
      const hashEl = await screen.findByText(/^\$2/, {}, { timeout: HASH_TIMEOUT });
      const hash = hashEl.textContent ?? '';

      switchToVerify();
      typeInto(screen.getByLabelText(/^password$/i), 'hunter2');
      typeInto(screen.getByLabelText(/bcrypt hash/i), hash);
      fireEvent.click(screen.getByRole('button', { name: /^verify hash$/i }));

      expect(await screen.findByText(/^match/i, {}, { timeout: HASH_TIMEOUT })).toBeInTheDocument();
    },
    HASH_TIMEOUT
  );

  it(
    'reports no match for the wrong password against a freshly generated hash',
    async () => {
      render(<BcryptTool />);
      setLowRounds();
      typeInto(screen.getByLabelText(/^password$/i), 'hunter2');
      fireEvent.click(screen.getByRole('button', { name: /generate hash/i }));
      const hashEl = await screen.findByText(/^\$2/, {}, { timeout: HASH_TIMEOUT });
      const hash = hashEl.textContent ?? '';

      switchToVerify();
      typeInto(screen.getByLabelText(/^password$/i), 'wrong password');
      typeInto(screen.getByLabelText(/bcrypt hash/i), hash);
      fireEvent.click(screen.getByRole('button', { name: /^verify hash$/i }));

      expect(await screen.findByText(/does not match/i, {}, { timeout: HASH_TIMEOUT })).toBeInTheDocument();
    },
    HASH_TIMEOUT
  );

  it('clears the verify fields and result', async () => {
    render(<BcryptTool />);
    switchToVerify();
    typeInto(screen.getByLabelText(/^password$/i), 'hunter2');
    typeInto(screen.getByLabelText(/bcrypt hash/i), 'not-a-hash');
    fireEvent.click(screen.getByRole('button', { name: /^verify hash$/i }));
    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect((screen.getByLabelText(/^password$/i) as HTMLInputElement).value).toBe('');
  });
});
