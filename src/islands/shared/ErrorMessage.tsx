interface Props {
  /** Null or empty renders nothing, so callers can pass state directly. */
  message: string | null;
  /** When set, shows a "Retry" link next to the message — for errors caused by a failed network request. */
  onRetry?: () => void;
}

/**
 * The single error presentation used by every tool.
 *
 * Rendered in a live region so the message is announced when it appears — an error
 * that is only visible is not an error the whole audience can see.
 */
export function ErrorMessage({ message, onRetry }: Props) {
  if (!message) return null;

  return (
    <p class="msg msg--error" role="alert">
      <span class="msg__icon" aria-hidden="true">
        !
      </span>
      <span>{message}</span>
      {onRetry && (
        <button type="button" class="msg__retry" onClick={onRetry}>
          Retry
        </button>
      )}
    </p>
  );
}
