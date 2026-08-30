import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/preact';
import { ImageJobList, type ImageJobRowProps } from './ImageJobList';

function baseRow(overrides: Partial<ImageJobRowProps> = {}): ImageJobRowProps {
  return {
    key: 'job-1',
    selected: false,
    onSelect: vi.fn(),
    thumbUrl: 'blob:thumb',
    checkerboard: false,
    fileName: 'photo.png',
    displayName: 'photo.jpg',
    hasResult: false,
    busy: true,
    busyLabel: 'Compressing…',
    errorFlag: false,
    onRemove: vi.fn(),
    ...overrides,
  };
}

const rows = () => document.querySelectorAll('.job');

describe('<ImageJobList />', () => {
  it('renders one row per item', () => {
    render(<ImageJobList items={[baseRow({ key: 'a' }), baseRow({ key: 'b', fileName: 'b.png' })]} />);
    expect(rows()).toHaveLength(2);
  });

  it('marks the selected row and calls onSelect when its button is clicked', () => {
    const onSelect = vi.fn();
    render(<ImageJobList items={[baseRow({ selected: true, onSelect })]} />);

    expect(rows()[0]).toHaveClass('job--selected');
    fireEvent.click(screen.getByRole('button', { name: /^photo\.jpg/i }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('shows the busy label only while busy and no result exists yet', () => {
    const { rerender } = render(<ImageJobList items={[baseRow({ busy: true, hasResult: false })]} />);
    expect(screen.getByText('Compressing…')).toBeInTheDocument();

    rerender(<ImageJobList items={[baseRow({ busy: true, hasResult: true, sizeBeforeBytes: 100, sizeAfterBytes: 50 })]} />);
    expect(screen.queryByText('Compressing…')).not.toBeInTheDocument();
  });

  it('shows size and a savings badge once a result exists', () => {
    render(<ImageJobList items={[baseRow({ busy: false, hasResult: true, sizeBeforeBytes: 1024, sizeAfterBytes: 512 })]} />);
    expect(screen.getByText(/1\.00 KB → 512 B/)).toBeInTheDocument();
    expect(screen.getByText(/smaller|larger|no change/i)).toBeInTheDocument();
  });

  it('shows an error flag when errorFlag is set', () => {
    render(<ImageJobList items={[baseRow({ busy: false, errorFlag: true })]} />);
    expect(screen.getByText('Error')).toHaveClass('job__error-flag');
  });

  it('shows a warning icon with its tooltip only when warningTitle is given', () => {
    const { rerender } = render(<ImageJobList items={[baseRow({ busy: false })]} />);
    expect(document.querySelector('.job__warning-flag')).not.toBeInTheDocument();

    rerender(<ImageJobList items={[baseRow({ busy: false, warningTitle: 'Transparency lost' })]} />);
    expect(document.querySelector('.job__warning-flag')).toHaveAttribute('title', 'Transparency lost');
  });

  it('renders a download button only once a result exists and a handler is given', () => {
    const onDownload = vi.fn();
    const { rerender } = render(<ImageJobList items={[baseRow({ busy: false, hasResult: false })]} />);
    expect(screen.queryByRole('button', { name: /^download$/i })).not.toBeInTheDocument();

    rerender(<ImageJobList items={[baseRow({ busy: false, hasResult: true, sizeBeforeBytes: 10, sizeAfterBytes: 5, onDownload, downloadTitle: 'Save it' })]} />);
    const button = screen.getByRole('button', { name: /^download$/i });
    fireEvent.click(button);
    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it('always renders a labeled remove button that calls onRemove', () => {
    const onRemove = vi.fn();
    render(<ImageJobList items={[baseRow({ onRemove, fileName: 'a.png' })]} />);
    fireEvent.click(screen.getByRole('button', { name: /remove a\.png/i }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('renders a caller-supplied thumbnail overlay inside the thumb group', () => {
    render(<ImageJobList items={[baseRow({ thumbOverlay: <button type="button">lock-me</button> })]} />);
    const group = document.querySelector('.job__thumb-group')!;
    expect(within(group as HTMLElement).getByRole('button', { name: 'lock-me' })).toBeInTheDocument();
  });

  it('applies the checkerboard class to the thumbnail when requested', () => {
    render(<ImageJobList items={[baseRow({ checkerboard: true })]} />);
    expect(document.querySelector('.job__thumb')).toHaveClass('job__thumb--checkerboard');
  });
});
