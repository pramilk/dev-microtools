import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/preact';
import AesEncryptDecrypt from './AesEncryptDecrypt';

const typeInto = (element: HTMLElement, value: string) => {
  fireEvent.input(element, { target: { value } });
};

// PBKDF2 at the real 600,000-iteration default takes a noticeable moment even natively.
const CRYPTO_TIMEOUT = 15000;

/** Drops iterations to the minimum so passphrase tests stay fast. */
const fastPassphrase = (passphrase: string) => {
  typeInto(screen.getByLabelText(/iterations/i), '1000');
  typeInto(screen.getByLabelText(/^passphrase$/i), passphrase);
};

const outputText = () => document.querySelector('pre.output')?.textContent ?? '';

/**
 * The primary Encrypt/Decrypt button, e.g. "Encrypt (AES-256-GCM)" — distinct from the
 * bare "Encrypt"/"Decrypt" direction toggle above it.
 */
const actionButton = () => screen.getByRole('button', { name: /^(en|de)crypt \(aes-/i });

const chooseFile = (file: File) => {
  fireEvent.change(screen.getByLabelText(/choose (a|an encrypted) file/i), { target: { files: [file] } });
};

describe('<AesEncryptDecrypt /> text mode', () => {
  it('shows an empty state and disables Encrypt until text and a passphrase are entered', () => {
    render(<AesEncryptDecrypt />);
    expect(screen.getByText(/ciphertext appears here/i)).toBeInTheDocument();
    expect(actionButton()).toBeDisabled();
    typeInto(screen.getByLabelText(/plain text/i), 'hello');
    expect(actionButton()).toBeDisabled();
    typeInto(screen.getByLabelText(/^passphrase$/i), 'pw');
    expect(actionButton()).not.toBeDisabled();
  });

  it('names the cipher strength on the action button and follows the key size', () => {
    render(<AesEncryptDecrypt />);
    expect(actionButton()).toHaveTextContent('AES-256-GCM');
    fireEvent.click(screen.getByRole('button', { name: /^128-bit$/i }));
    expect(actionButton()).toHaveTextContent('AES-128-GCM');
  });

  it(
    'encrypts, then round-trips the result through Decrypt',
    async () => {
      render(<AesEncryptDecrypt />);
      typeInto(screen.getByLabelText(/plain text/i), 'héllo 🔐');
      fastPassphrase('swordfish');
      fireEvent.click(actionButton());

      await waitFor(() => expect(outputText()).toMatch(/^[A-Za-z0-9+/]+=*$/), { timeout: CRYPTO_TIMEOUT });

      fireEvent.click(screen.getByRole('button', { name: /decrypt result/i }));
      expect((screen.getByLabelText(/^ciphertext/i) as HTMLTextAreaElement).value).toMatch(/^[A-Za-z0-9+/]+=*$/);
      fireEvent.click(actionButton());

      await waitFor(() => expect(outputText()).toBe('héllo 🔐'), { timeout: CRYPTO_TIMEOUT });
    },
    CRYPTO_TIMEOUT
  );

  it(
    'round-trips with the pure-JavaScript engine',
    async () => {
      render(<AesEncryptDecrypt />);
      fireEvent.click(screen.getByRole('button', { name: /pure js/i }));
      typeInto(screen.getByLabelText(/plain text/i), 'no SubtleCrypto here');
      fastPassphrase('swordfish');
      fireEvent.click(actionButton());
      await waitFor(() => expect(outputText()).toMatch(/^[A-Za-z0-9+/]+=*$/), { timeout: CRYPTO_TIMEOUT });

      fireEvent.click(screen.getByRole('button', { name: /decrypt result/i }));
      fireEvent.click(actionButton());
      await waitFor(() => expect(outputText()).toBe('no SubtleCrypto here'), { timeout: CRYPTO_TIMEOUT });
    },
    CRYPTO_TIMEOUT
  );

  it(
    'shows a visible error for the wrong passphrase',
    async () => {
      render(<AesEncryptDecrypt />);
      typeInto(screen.getByLabelText(/plain text/i), 'secret');
      fastPassphrase('right');
      fireEvent.click(actionButton());
      await waitFor(() => expect(outputText()).not.toMatch(/appears here/i), { timeout: CRYPTO_TIMEOUT });

      fireEvent.click(screen.getByRole('button', { name: /decrypt result/i }));
      typeInto(screen.getByLabelText(/^passphrase$/i), 'wrong');
      fireEvent.click(actionButton());

      expect(await screen.findByRole('alert', {}, { timeout: CRYPTO_TIMEOUT })).toHaveTextContent(
        /authentication check did not pass/i
      );
    },
    CRYPTO_TIMEOUT
  );

  it('shows a visible error for malformed ciphertext', async () => {
    render(<AesEncryptDecrypt />);
    fireEvent.click(screen.getByRole('button', { name: /^decrypt$/i }));
    typeInto(screen.getByLabelText(/^ciphertext/i), 'not base64 !!');
    fastPassphrase('pw');
    fireEvent.click(actionButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(/not valid base64/i);
  });

  it('explains an invalid raw key', async () => {
    render(<AesEncryptDecrypt />);
    fireEvent.click(screen.getByRole('button', { name: /raw key/i }));
    typeInto(screen.getByLabelText(/plain text/i), 'hello');
    typeInto(screen.getByLabelText(/^key \(hex\)$/i), 'abcd');
    fireEvent.click(actionButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(/64 hex digits/i);
  });

  it('generates a random key of the selected size and shows it as what you need to decrypt', async () => {
    render(<AesEncryptDecrypt />);
    fireEvent.click(screen.getByRole('button', { name: /raw key/i }));
    fireEvent.click(screen.getByRole('button', { name: /^128-bit$/i }));
    fireEvent.click(screen.getByRole('button', { name: /generate 128-bit key/i }));
    const key = (screen.getByLabelText(/^key \(hex\)$/i) as HTMLInputElement).value;
    expect(key).toMatch(/^[0-9a-f]{32}$/);

    typeInto(screen.getByLabelText(/plain text/i), 'hello');
    fireEvent.click(actionButton());

    const recipe = await screen.findByRole('region', { name: /what you need to decrypt/i });
    expect(recipe).toHaveTextContent(key);
    expect(recipe).toHaveTextContent('AES-128-GCM');
    expect(recipe).not.toHaveTextContent(/salt/i);
  });

  it(
    'tells a passphrase user the passphrase is the key, with the exact settings to reuse',
    async () => {
      render(<AesEncryptDecrypt />);
      typeInto(screen.getByLabelText(/plain text/i), 'hello');
      fastPassphrase('pw');
      fireEvent.click(actionButton());

      const recipe = await screen.findByRole('region', { name: /what you need to decrypt/i }, { timeout: CRYPTO_TIMEOUT });
      const steps = recipe.querySelectorAll('ol > li');
      expect(steps).toHaveLength(3);
      expect(steps[0]).toHaveTextContent(/whole string in the ciphertext box/i);
      expect(steps[1]).toHaveTextContent(/the passphrase.*exactly as you typed it/i);
      expect(steps[2]).toHaveTextContent(/AES-256-GCM, 1,000 iterations, ciphertext as Base64/);
      expect(recipe).not.toHaveTextContent('pw');

      // Salt and IV are shown only in the collapsed breakdown, not as requirements.
      const breakdown = recipe.querySelector('details');
      expect(breakdown).not.toBeNull();
      expect(breakdown).not.toHaveAttribute('open');
      expect(breakdown).toHaveTextContent(/already inside the encrypted output/i);
      expect(breakdown).toHaveTextContent(/salt/i);
    },
    CRYPTO_TIMEOUT
  );

  it('warns that CBC and CTR are not authenticated', () => {
    render(<AesEncryptDecrypt />);
    expect(screen.queryByText(/no integrity check/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^mode$/i), { target: { value: 'AES-CBC' } });
    expect(screen.getByText(/no integrity check/i)).toBeInTheDocument();
  });

  it(
    'loads a decryptable example in Decrypt mode',
    async () => {
      render(<AesEncryptDecrypt />);
      fireEvent.click(screen.getByRole('button', { name: /^decrypt$/i }));
      fireEvent.click(screen.getByRole('button', { name: /load example/i }));
      fireEvent.click(actionButton());

      await waitFor(() => expect(outputText()).toBe('Meet me at the usual place at 10pm.'), {
        timeout: CRYPTO_TIMEOUT,
      });
    },
    CRYPTO_TIMEOUT
  );

  it(
    'copies the ciphertext to the clipboard',
    async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });

      render(<AesEncryptDecrypt />);
      typeInto(screen.getByLabelText(/plain text/i), 'copy me');
      fastPassphrase('pw');
      fireEvent.click(actionButton());
      await waitFor(() => expect(outputText()).not.toMatch(/appears here/i), { timeout: CRYPTO_TIMEOUT });
      const ciphertext = outputText();

      // The output pane's copy button is the first plain "Copy" button once a result exists.
      fireEvent.click(screen.getAllByRole('button', { name: /^copy$/i })[0] as HTMLElement);
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(ciphertext));
    },
    CRYPTO_TIMEOUT
  );

  it(
    'clears the text, the passphrase and the result, and invalidates a stale result on edit',
    async () => {
      render(<AesEncryptDecrypt />);
      typeInto(screen.getByLabelText(/plain text/i), 'hello');
      fastPassphrase('pw');
      fireEvent.click(actionButton());
      await waitFor(() => expect(outputText()).not.toMatch(/appears here/i), { timeout: CRYPTO_TIMEOUT });

      typeInto(screen.getByLabelText(/plain text/i), 'hello!');
      expect(outputText()).toMatch(/appears here/i);

      fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
      expect((screen.getByLabelText(/plain text/i) as HTMLTextAreaElement).value).toBe('');
      expect((screen.getByLabelText(/^passphrase$/i) as HTMLInputElement).value).toBe('');
    },
    CRYPTO_TIMEOUT
  );
});

describe('<AesEncryptDecrypt /> file mode', () => {
  const switchToFile = () => fireEvent.click(screen.getByRole('button', { name: /^file$/i }));

  it('disables the action until a file is chosen', () => {
    render(<AesEncryptDecrypt />);
    switchToFile();
    typeInto(screen.getByLabelText(/^passphrase$/i), 'pw');
    expect(actionButton()).toBeDisabled();
    chooseFile(new File(['data'], 'notes.txt'));
    expect(actionButton()).not.toBeDisabled();
  });

  it(
    'encrypts a file to name.enc, then decrypts it back to the original name and size',
    async () => {
      render(<AesEncryptDecrypt />);
      switchToFile();
      chooseFile(new File([new Uint8Array([0, 1, 2, 250, 255])], 'photo.bin'));
      fastPassphrase('swordfish');
      fireEvent.click(actionButton());

      // 16 salt + 12 IV + 5 data + 16 tag
      expect(
        await screen.findByRole('button', { name: /download photo\.bin\.enc/i }, { timeout: CRYPTO_TIMEOUT })
      ).toBeInTheDocument();
      expect(screen.getByText(/49 B/)).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /decrypt result/i }));
      expect(screen.getByText('photo.bin.enc')).toBeInTheDocument();
      fireEvent.click(actionButton());

      expect(
        await screen.findByRole('button', { name: /download photo\.bin$/i }, { timeout: CRYPTO_TIMEOUT })
      ).toBeInTheDocument();
      expect(screen.getByText(/5 B/)).toBeInTheDocument();
    },
    CRYPTO_TIMEOUT
  );

  it(
    'shows a visible error when a file is decrypted with the wrong passphrase',
    async () => {
      render(<AesEncryptDecrypt />);
      switchToFile();
      fireEvent.click(screen.getByRole('button', { name: /^decrypt$/i }));
      fireEvent.click(screen.getByRole('button', { name: /load example/i }));
      typeInto(screen.getByLabelText(/^passphrase$/i), 'not the passphrase');
      fireEvent.click(actionButton());

      expect(await screen.findByRole('alert', {}, { timeout: CRYPTO_TIMEOUT })).toHaveTextContent(
        /authentication check did not pass/i
      );
    },
    CRYPTO_TIMEOUT
  );

  it(
    'decrypts the sample encrypted file',
    async () => {
      render(<AesEncryptDecrypt />);
      switchToFile();
      fireEvent.click(screen.getByRole('button', { name: /^decrypt$/i }));
      fireEvent.click(screen.getByRole('button', { name: /load example/i }));
      fireEvent.click(actionButton());

      expect(
        await screen.findByRole('button', { name: /download meeting-note\.txt$/i }, { timeout: CRYPTO_TIMEOUT })
      ).toBeInTheDocument();
    },
    CRYPTO_TIMEOUT
  );

  it(
    'keeps a decrypted file hidden until asked, then shows a text file as text',
    async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });
      const plain = 'Meet me at the usual place at 10pm.';

      render(<AesEncryptDecrypt />);
      switchToFile();
      fireEvent.click(screen.getByRole('button', { name: /^decrypt$/i }));
      fireEvent.click(screen.getByRole('button', { name: /load example/i }));
      fireEvent.click(actionButton());
      await screen.findByRole('button', { name: /download meeting-note\.txt$/i }, { timeout: CRYPTO_TIMEOUT });

      // Sensitive by default: nothing is on screen until the user opts in.
      expect(screen.queryByText(plain)).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /show content/i }));
      expect(await screen.findByText(plain)).toBeInTheDocument();
      expect(screen.getByText('meeting-note.txt — text')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /^copy$/i }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(plain));

      // A fresh run hides it again rather than revealing the new result automatically.
      fireEvent.click(actionButton());
      await screen.findByRole('button', { name: /show content/i }, { timeout: CRYPTO_TIMEOUT });
      expect(screen.queryByText(plain)).not.toBeInTheDocument();
    },
    CRYPTO_TIMEOUT
  );

  it(
    'shows a binary result (the encrypted .enc) as Base64',
    async () => {
      render(<AesEncryptDecrypt />);
      switchToFile();
      fireEvent.click(screen.getByRole('button', { name: /raw key/i }));
      fireEvent.click(screen.getByRole('button', { name: /generate 256-bit key/i }));
      chooseFile(new File(['secret notes'], 'notes.txt'));
      fireEvent.click(actionButton());
      await screen.findByRole('button', { name: /download notes\.txt\.enc/i }, { timeout: CRYPTO_TIMEOUT });

      fireEvent.click(screen.getByRole('button', { name: /show content/i }));
      expect(screen.getByText('notes.txt.enc — binary file, shown as Base64')).toBeInTheDocument();
      // 12-byte IV + 12 data bytes + 16-byte tag = 40 bytes -> 56 Base64 characters.
      expect(document.querySelector('pre.output')?.textContent).toMatch(/^[A-Za-z0-9+/]{54}==$/);
    },
    CRYPTO_TIMEOUT
  );

  it(
    'explains instead of rendering a result over the preview limit',
    async () => {
      render(<AesEncryptDecrypt />);
      switchToFile();
      fireEvent.click(screen.getByRole('button', { name: /raw key/i }));
      fireEvent.click(screen.getByRole('button', { name: /generate 256-bit key/i }));
      chooseFile(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.bin'));
      fireEvent.click(actionButton());
      await screen.findByRole('button', { name: /download big\.bin\.enc/i }, { timeout: CRYPTO_TIMEOUT });

      fireEvent.click(screen.getByRole('button', { name: /show content/i }));
      expect(screen.getByText(/too large to show on the page/i)).toBeInTheDocument();
    },
    CRYPTO_TIMEOUT
  );

  it('offers no share of the file itself, only a Clear that removes it', () => {
    render(<AesEncryptDecrypt />);
    switchToFile();
    chooseFile(new File(['data'], 'notes.txt'));
    expect(screen.getByText('notes.txt')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    expect(screen.queryByText('notes.txt')).not.toBeInTheDocument();
  });
});
