import { type ToolResult, ok, err, messageFrom } from './result';

export const MIN_BCRYPT_ROUNDS = 4;

/**
 * bcryptjs is pure JS and hashes synchronously on the browser's single main thread.
 * Cost grows exponentially with the round count (2^rounds iterations), so bcryptjs's own
 * theoretical ceiling of 31 would visibly freeze the tab for minutes. 14 is already ~4x
 * the common server-side default of 12 and takes a perceptible fraction of a second here —
 * anything higher trades a barely-meaningful security gain for a tab that stops responding.
 */
export const MAX_BCRYPT_ROUNDS = 14;

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$/;

/** bcryptjs's default export is a namespace object; loaded lazily so no other tool pays for it. */
async function loadBcrypt() {
  try {
    return (await import('bcryptjs')).default;
  } catch {
    throw new Error('Could not load the bcrypt implementation. Check your connection and reload the page.');
  }
}

/**
 * Hashes a password with bcrypt at the given cost factor.
 *
 * An empty password is allowed — bcrypt can legitimately hash an empty string, and
 * rejecting it would be an arbitrary UX restriction rather than a real constraint.
 */
export async function hashPassword(password: string, rounds: number): Promise<ToolResult<string>> {
  if (!Number.isInteger(rounds)) return err('Rounds must be a whole number.');
  if (rounds < MIN_BCRYPT_ROUNDS) {
    return err(`Rounds must be at least ${MIN_BCRYPT_ROUNDS} — bcrypt does not support anything lower.`);
  }
  if (rounds > MAX_BCRYPT_ROUNDS) {
    return err(
      `Rounds must be ${MAX_BCRYPT_ROUNDS} or lower. Cost doubles with every round, and bcryptjs hashes ` +
        'synchronously on the page — anything higher would freeze the tab for a very long time.'
    );
  }

  const bcrypt = await loadBcrypt();
  try {
    return ok(await bcrypt.hash(password, rounds));
  } catch (error) {
    return err(messageFrom(error, 'Could not compute the bcrypt hash.'));
  }
}

/**
 * Verifies a password against a bcrypt hash.
 *
 * Rejects anything that doesn't look like a bcrypt hash up front, so the UI can show a
 * specific, actionable message instead of surfacing bcryptjs's own internal error text.
 */
export async function verifyPassword(password: string, hash: string): Promise<ToolResult<boolean>> {
  if (hash === '') return err('Enter a bcrypt hash to verify against.');
  if (!BCRYPT_HASH_PATTERN.test(hash)) {
    return err("That doesn't look like a bcrypt hash — it should start with $2a$, $2b$ or $2y$.");
  }

  const bcrypt = await loadBcrypt();
  try {
    return ok(await bcrypt.compare(password, hash));
  } catch (error) {
    return err(messageFrom(error, 'Could not verify that hash.'));
  }
}
