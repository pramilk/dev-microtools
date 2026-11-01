import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { useReorderableList } from './useReorderableList';
import { moveItem } from '../../lib/tools/fileBatch';

interface Row {
  id: number;
  name: string;
}

/** The smallest list that wires the hook up the way Merge PDF and Image to PDF do. */
function Harness({ onFilesDropped = vi.fn(), axis }: { onFilesDropped?: (files: File[]) => void; axis?: 'vertical' | 'horizontal' }) {
  const [items, setItems] = useState<Row[]>([
    { id: 1, name: 'one' },
    { id: 2, name: 'two' },
    { id: 3, name: 'three' },
  ]);
  const moveTo = (id: number, to: number, focus?: 'up' | 'down') => {
    if (focus) reorder.restoreFocusAfterMove(id, focus);
    setItems(moveItem(items, items.findIndex((item) => item.id === id), to));
  };
  const reorder = useReorderableList({ items, onMove: (id, to) => moveTo(id, to), onFilesDropped, dragLabel: (item) => item.name, axis });

  return (
    <ol ref={reorder.listRef} onDragLeave={reorder.onListDragLeave}>
      {items.map((item, index) => (
        <li key={item.id} data-testid="row" data-dragging={reorder.draggingId === item.id} {...reorder.rowProps(item)}>
          <span data-testid={`handle-${item.name}`} {...reorder.handleProps(item)}>
            ⠿
          </span>
          {item.name}
          <button type="button" data-move={`${item.id}-up`} disabled={index === 0} onClick={() => moveTo(item.id, index - 1, 'up')}>
            up {item.name}
          </button>
          <button type="button" data-move={`${item.id}-down`} disabled={index === items.length - 1} onClick={() => moveTo(item.id, index + 1, 'down')}>
            down {item.name}
          </button>
        </li>
      ))}
    </ol>
  );
}

const order = () => screen.getAllByTestId('row').map((row) => row.textContent?.replace(/⠿|up.*$/g, '').trim());
const dataTransfer = (files: File[] = []) => ({ setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: '', dropEffect: '', types: files.length ? ['Files'] : ['text/plain'], files });

/** jsdom has no DragEvent, and fireEvent's stand-in drops clientX/clientY — a MouseEvent keeps them. */
function dropAt(transfer: ReturnType<typeof dataTransfer>, clientX: number, clientY: number): MouseEvent {
  const event = new MouseEvent('drop', { bubbles: true, cancelable: true, clientX, clientY });
  Object.defineProperty(event, 'dataTransfer', { value: transfer });
  return event;
}

describe('useReorderableList', () => {
  it('moves a dragged row to where it is dropped', () => {
    render(<Harness />);
    const transfer = dataTransfer();
    fireEvent.dragStart(screen.getByTestId('handle-three'), { dataTransfer: transfer });
    expect(transfer.setData).toHaveBeenCalledWith('text/plain', 'three');
    const [first] = screen.getAllByTestId('row');
    // jsdom has no layout, so every drop lands in the row's upper half: "before" it.
    fireEvent.dragOver(first, { dataTransfer: transfer });
    fireEvent.drop(first, { dataTransfer: transfer });
    expect(order()).toEqual(['three', 'one', 'two']);
  });

  it('decides before/after by the left and right halves on a horizontal (grid) axis', () => {
    render(<Harness axis="horizontal" />);
    const transfer = dataTransfer();
    const [first] = screen.getAllByTestId('row');
    if (!first) throw new Error('no rows');
    first.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.dragStart(screen.getByTestId('handle-three'), { dataTransfer: transfer });
    // Low on the card (which a vertical list would call "after") but in its left half: before.
    fireEvent(first, dropAt(transfer, 20, 90));
    expect(order()).toEqual(['three', 'one', 'two']);
    fireEvent.dragStart(screen.getByTestId('handle-three'), { dataTransfer: transfer });
    const [, second] = screen.getAllByTestId('row');
    if (!second) throw new Error('no rows');
    second.getBoundingClientRect = first.getBoundingClientRect;
    fireEvent(second, dropAt(transfer, 80, 10));
    expect(order()).toEqual(['one', 'three', 'two']);
  });

  it('hands files dropped from the desktop onto a row to onFilesDropped', () => {
    const onFilesDropped = vi.fn();
    render(<Harness onFilesDropped={onFilesDropped} />);
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    const [first] = screen.getAllByTestId('row');
    fireEvent.dragOver(first, { dataTransfer: dataTransfer([file]) });
    fireEvent.drop(first, { dataTransfer: dataTransfer([file]) });
    expect(onFilesDropped).toHaveBeenCalledWith([file]);
    expect(order()).toEqual(['one', 'two', 'three']);
  });

  it('keeps focus on the moved row’s button, or its sibling once that one is disabled', () => {
    render(<Harness />);
    const down = screen.getByRole('button', { name: 'down one' });
    down.focus();
    fireEvent.click(down);
    expect(order()).toEqual(['two', 'one', 'three']);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'down one' }));

    fireEvent.click(screen.getByRole('button', { name: 'down one' }));
    // Now last, so "down" is disabled and focus falls back to "up".
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'up one' }));
  });
});
