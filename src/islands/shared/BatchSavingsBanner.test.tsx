import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { BatchSavingsBanner } from './BatchSavingsBanner';

describe('<BatchSavingsBanner />', () => {
  it('shows total before/after size, count, and a savings badge', () => {
    render(<BatchSavingsBanner totalBeforeBytes={2048} totalAfterBytes={1024} count={2} zipping={false} onDownloadAll={() => {}} downloadAllTitle="Download all 2 images as a .zip" />);

    expect(screen.getByTestId('total-savings')).toHaveTextContent(/2\.00 KB → 1\.00 KB across 2 images/);
    expect(screen.getByText(/smaller|larger|no change/i)).toBeInTheDocument();
  });

  it('uses singular "image" for a count of one', () => {
    render(<BatchSavingsBanner totalBeforeBytes={100} totalAfterBytes={50} count={1} zipping={false} onDownloadAll={() => {}} downloadAllTitle="x" />);
    const banner = screen.getByTestId('total-savings');
    expect(banner).toHaveTextContent(/across 1 image/);
    expect(banner).not.toHaveTextContent(/across 1 images/);
  });

  it('calls onDownloadAll when the button is clicked, and shows the given title', () => {
    const onDownloadAll = vi.fn();
    render(<BatchSavingsBanner totalBeforeBytes={100} totalAfterBytes={50} count={1} zipping={false} onDownloadAll={onDownloadAll} downloadAllTitle="Save the zip" />);

    const button = screen.getByRole('button', { name: /download all \(1\)/i });
    expect(button).toHaveAttribute('title', 'Save the zip');
    fireEvent.click(button);
    expect(onDownloadAll).toHaveBeenCalledTimes(1);
  });

  it('disables the button and shows "Zipping…" while zipping', () => {
    render(<BatchSavingsBanner totalBeforeBytes={100} totalAfterBytes={50} count={1} zipping={true} onDownloadAll={() => {}} downloadAllTitle="x" />);

    const button = screen.getByRole('button', { name: /zipping/i });
    expect(button).toBeDisabled();
  });
});
