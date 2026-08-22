/**
 * Explicit success/failure type used by every tool's logic layer.
 *
 * Tools return this instead of throwing, so the UI is forced to handle the failure
 * case and can never render a raw stack trace or silently do nothing on bad input.
 */
export type ToolResult<T> = { ok: true; value: T } | { ok: false; error: string };

export const ok = <T>(value: T): ToolResult<T> => ({ ok: true, value });

export const err = <T = never>(error: string): ToolResult<T> => ({ ok: false, error });

/**
 * Normalises an unknown thrown value into a human-readable message.
 * Browser APIs throw a mix of Error, DOMException and plain strings.
 */
export function messageFrom(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return fallback;
}
