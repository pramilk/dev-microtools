import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import MetaTagGenerator from './MetaTagGenerator';

const output = () => document.querySelector<HTMLElement>('.output');
const outputText = () => output()?.textContent ?? '';

describe('<MetaTagGenerator />', () => {
  it('starts empty with a placeholder and no error', () => {
    render(<MetaTagGenerator />);

    expect(document.querySelector('.output--empty')).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('typing a title produces output', () => {
    render(<MetaTagGenerator />);

    fireEvent.input(screen.getByLabelText(/^page title/i), { target: { value: 'My Page' } });

    expect(outputText()).toContain('<title>My Page</title>');
    expect(outputText()).toContain('og:title');
    expect(outputText()).toContain('twitter:title');
    expect(document.querySelector('.output--empty')).toBeNull();
  });

  it('shows a visible error for an invalid canonical URL, once a title is present', () => {
    render(<MetaTagGenerator />);

    fireEvent.input(screen.getByLabelText(/^page title/i), { target: { value: 'My Page' } });
    fireEvent.input(screen.getByLabelText('Canonical URL'), { target: { value: 'not-a-url' } });

    expect(screen.getByRole('alert')).toHaveTextContent(/not a full URL/i);
    expect(document.querySelector('.output--empty')).not.toBeNull();
  });

  it('shows no error for an empty, untouched form', () => {
    render(<MetaTagGenerator />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('rejects an invalid theme color with a visible error', () => {
    render(<MetaTagGenerator />);

    fireEvent.input(screen.getByLabelText(/^page title/i), { target: { value: 'My Page' } });
    fireEvent.input(screen.getByLabelText('Theme color hex value'), { target: { value: 'notacolor' } });

    expect(screen.getByRole('alert')).toHaveTextContent(/hex color/i);
  });

  it('warns when there is no meta description or image', () => {
    render(<MetaTagGenerator />);

    fireEvent.input(screen.getByLabelText(/^page title/i), { target: { value: 'My Page' } });

    expect(screen.getByText(/No meta description/)).toBeInTheDocument();
    expect(screen.getByText(/No image — link previews/)).toBeInTheDocument();
  });

  it('loads a worked example that fills every core field', () => {
    render(<MetaTagGenerator />);

    fireEvent.click(screen.getByRole('button', { name: 'Load example' }));

    expect((screen.getByLabelText(/^page title/i) as HTMLInputElement).value).not.toBe('');
    expect(outputText()).toContain('<title>');
    expect(outputText()).toContain('og:image');
    expect(outputText()).toContain('twitter:site');
  });

  it('clear resets every field back to empty', () => {
    render(<MetaTagGenerator />);

    fireEvent.click(screen.getByRole('button', { name: 'Load example' }));
    expect((screen.getByLabelText(/^page title/i) as HTMLInputElement).value).not.toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect((screen.getByLabelText(/^page title/i) as HTMLInputElement).value).toBe('');
    expect(document.querySelector('.output--empty')).not.toBeNull();
  });

  it('normalizes a Twitter handle typed without a leading @', () => {
    render(<MetaTagGenerator />);

    fireEvent.input(screen.getByLabelText(/^page title/i), { target: { value: 'My Page' } });
    fireEvent.input(screen.getByLabelText('Twitter/X site handle'), { target: { value: 'acme' } });

    expect(outputText()).toContain('twitter:site" content="@acme"');
  });

  it('switches the Twitter card layout when the segmented control is pressed', () => {
    render(<MetaTagGenerator />);
    fireEvent.input(screen.getByLabelText(/^page title/i), { target: { value: 'My Page' } });

    fireEvent.click(screen.getByRole('button', { name: 'Summary' }));

    expect(outputText()).toContain('twitter:card" content="summary"');
  });

  it('offers a copy button once there is output, and a download button', () => {
    render(<MetaTagGenerator />);
    fireEvent.input(screen.getByLabelText(/^page title/i), { target: { value: 'My Page' } });

    expect(screen.getByRole('button', { name: 'Copy' })).toBeEnabled();
    expect(screen.getByRole('button', { name: /download/i })).toBeEnabled();
  });

  it('offers a share-link button', () => {
    render(<MetaTagGenerator />);
    expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument();
  });

  it('falls back to a labelled placeholder when the preview image fails to load', () => {
    render(<MetaTagGenerator />);
    fireEvent.input(screen.getByLabelText('Image URL'), { target: { value: 'https://example.com/broken.png' } });

    const image = document.querySelector('.meta-preview__card-image img') as HTMLImageElement;
    expect(image).not.toBeNull();

    fireEvent.error(image);

    expect(document.querySelector('.meta-preview__card-image img')).toBeNull();
    expect(screen.getByText(/didn't load/)).toBeInTheDocument();
  });

  it('clears the broken-image placeholder once the URL is fixed', () => {
    render(<MetaTagGenerator />);
    fireEvent.input(screen.getByLabelText('Image URL'), { target: { value: 'https://example.com/broken.png' } });
    fireEvent.error(document.querySelector('.meta-preview__card-image img') as HTMLImageElement);
    expect(screen.getByText(/didn't load/)).toBeInTheDocument();

    fireEvent.input(screen.getByLabelText('Image URL'), { target: { value: 'https://example.com/fixed.png' } });

    expect(screen.queryByText(/didn't load/)).toBeNull();
    expect(document.querySelector('.meta-preview__card-image img')).not.toBeNull();
  });
});
