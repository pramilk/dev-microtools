import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { PdfPreview } from './PdfPreview';

describe('<PdfPreview />', () => {
  it('shows the PDF in a titled frame fitted to the page width, with an open-in-new-tab link', () => {
    render(<PdfPreview url="blob:abc" heading="Merged preview" frameTitle="Merged PDF preview" />);
    expect(screen.getByText('Merged preview')).toBeInTheDocument();
    expect(screen.getByTitle('Merged PDF preview')).toHaveAttribute('src', 'blob:abc#view=FitH');
    const link = screen.getByRole('link', { name: /open in new tab/i });
    expect(link).toHaveAttribute('href', 'blob:abc');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener');
    expect(screen.getByText(/most phones/i)).toBeInTheDocument();
  });

  it('renders extra controls beside the heading', () => {
    render(<PdfPreview url="blob:abc" heading="Preview" frameTitle="Doc" controls={<button type="button">Original</button>} />);
    expect(screen.getByRole('button', { name: 'Original' })).toBeInTheDocument();
  });
});
