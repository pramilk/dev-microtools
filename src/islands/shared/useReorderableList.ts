import { useLayoutEffect, useRef, useState } from 'preact/hooks';

const hasFiles = (event: DragEvent): boolean => Array.from(event.dataTransfer?.types ?? []).includes('Files');

interface Options<T extends { id: number }> {
  items: readonly T[];
  /** Moves the item with `id` to index `to` (already adjusted for its own removal). */
  onMove: (id: number, to: number) => void;
  /** Files dragged in from the desktop and dropped onto a row rather than the dropzone. */
  onFilesDropped: (files: File[]) => void;
  /** Text put on the drag's data transfer (Firefox won't start a drag without some). */
  dragLabel: (item: T) => string;
  /** Which half of a row decides "drop before" vs "after": top/bottom for a list (the
   *  default), left/right for a grid of cards. */
  axis?: 'vertical' | 'horizontal';
}

/**
 * Drag-to-reorder for an ordered list of rows, plus focus restoration for the ↑/↓ buttons
 * that are its keyboard and touch equivalent — shared by Merge PDF, Image to PDF and Organize PDF.
 *
 * Rows get `rowProps(item)`, the drag handle gets `handleProps(item)`, and the `<ol>` gets
 * `listRef` and `onListDragLeave`. Move buttons carry `data-move="<id>-up|down"`; call
 * `restoreFocusAfterMove` before moving so focus lands back on the same control once the
 * row's DOM node is re-inserted (or its sibling, if that one just became disabled).
 */
export function useReorderableList<T extends { id: number }>({ items, onMove, onFilesDropped, dragLabel, axis = 'vertical' }: Options<T>) {
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: number; after: boolean } | null>(null);
  const dragIdRef = useRef<number | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const pendingFocusRef = useRef<{ id: number; direction: 'up' | 'down' } | null>(null);

  // A layout effect, not a plain effect: Preact runs plain effects after paint, so one still
  // queued from an earlier update (a rebuild finishing just before the click) would consume
  // the request and focus the button *before* its row moves — and moving the row drops it.
  useLayoutEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending || !listRef.current) return;
    pendingFocusRef.current = null;
    const find = (direction: string) => listRef.current?.querySelector<HTMLButtonElement>(`[data-move="${pending.id}-${direction}"]`);
    const button = find(pending.direction);
    (button && !button.disabled ? button : find(pending.direction === 'up' ? 'down' : 'up'))?.focus();
  }, [items]);

  const isAfter = (event: DragEvent): boolean => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return axis === 'horizontal' ? event.clientX > rect.left + rect.width / 2 : event.clientY > rect.top + rect.height / 2;
  };

  const endDrag = () => {
    dragIdRef.current = null;
    setDraggingId(null);
    setDropTarget(null);
  };

  const rowProps = (item: T) => ({
    onDragOver: (event: DragEvent) => {
      if (dragIdRef.current === null) {
        if (hasFiles(event)) event.preventDefault(); // Files from the desktop can be dropped onto the list too.
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      const after = isAfter(event);
      if (dropTarget?.id !== item.id || dropTarget.after !== after) setDropTarget({ id: item.id, after });
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      const dragged = dragIdRef.current;
      if (dragged === null) {
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length > 0) onFilesDropped(files);
        return;
      }
      const from = items.findIndex((candidate) => candidate.id === dragged);
      const targetIndex = items.findIndex((candidate) => candidate.id === item.id);
      let to = isAfter(event) ? targetIndex + 1 : targetIndex;
      if (from < to) to -= 1;
      endDrag();
      onMove(dragged, to);
    },
  });

  const handleProps = (item: T) => ({
    draggable: true,
    onDragStart: (event: DragEvent) => {
      dragIdRef.current = item.id;
      // Deferred a frame: Chromium aborts a drag (firing dragend at once) if the source's
      // DOM changes while dragstart is still being dispatched.
      window.requestAnimationFrame(() => {
        if (dragIdRef.current === item.id) setDraggingId(item.id);
      });
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', dragLabel(item));
        const row = (event.currentTarget as HTMLElement).closest('li');
        if (row) event.dataTransfer.setDragImage(row, 24, 24);
      }
    },
    onDragEnd: endDrag,
  });

  return {
    listRef,
    draggingId,
    dropTarget,
    rowProps,
    handleProps,
    onListDragLeave: (event: DragEvent) => {
      if (event.currentTarget === event.target) setDropTarget(null);
    },
    restoreFocusAfterMove: (id: number, direction: 'up' | 'down') => {
      pendingFocusRef.current = { id, direction };
    },
  };
}
