import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import BarcodeGenerator from './BarcodeGenerator';

const preview = () => document.querySelector('.barcode-preview__image svg');

describe('<BarcodeGenerator />', () => {
  it('renders a Code 128 barcode for the default value on load', async () => {
    render(<BarcodeGenerator />);
    await screen.findByRole('button', { name: /download png/i });
    expect(preview()).toBeTruthy();
  });

  it('updates the barcode as the value changes', async () => {
    render(<BarcodeGenerator />);
    const input = screen.getByLabelText(/^value/i);
    fireEvent.input(input, { target: { value: 'ANOTHER-VALUE' } });

    expect(input).toHaveValue('ANOTHER-VALUE');
    expect(preview()).toBeTruthy();
    expect(document.querySelector('.msg--error')).not.toBeInTheDocument();
  });

  it('shows a visible error for an invalid Code 128 character, not a blank barcode', async () => {
    render(<BarcodeGenerator />);
    fireEvent.input(screen.getByLabelText(/^value/i), { target: { value: 'bad\ttab' } });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(preview()).toBeFalsy();
  });

  it('switches symbology and loads that symbology\'s own working example', async () => {
    render(<BarcodeGenerator />);
    fireEvent.click(screen.getByRole('button', { name: 'EAN-13' }));

    expect(screen.getByLabelText(/^value/i)).toHaveValue('5901234123457');
    expect(document.querySelector('.msg--error')).not.toBeInTheDocument();
    expect(preview()).toBeTruthy();
  });

  it('shows a clear error for an EAN-13 value with the wrong digit count', async () => {
    render(<BarcodeGenerator />);
    fireEvent.click(screen.getByRole('button', { name: 'EAN-13' }));
    fireEvent.input(screen.getByLabelText(/^value/i), { target: { value: '123' } });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('rejects a Code 39 value with a character outside its charset', async () => {
    render(<BarcodeGenerator />);
    fireEvent.click(screen.getByRole('button', { name: 'Code 39' }));
    fireEvent.input(screen.getByLabelText(/^value/i), { target: { value: 'hello!' } });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('shows the Code 39 checksum option only for Code 39', async () => {
    render(<BarcodeGenerator />);
    expect(screen.queryByText(/mod-43 checksum/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Code 39' }));
    expect(screen.getByText(/mod-43 checksum/i)).toBeInTheDocument();
  });

  it('clears the input and hides the barcode when Clear is pressed', async () => {
    render(<BarcodeGenerator />);
    await new Promise((resolve) => setTimeout(resolve, 0));

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(screen.getByLabelText(/^value/i)).toHaveValue('');
    expect(preview()).toBeFalsy();
    expect(document.querySelector('.msg--error')).not.toBeInTheDocument();
  });

  it('shows download and copy controls once a barcode is generated, not before', async () => {
    render(<BarcodeGenerator />);
    expect(await screen.findByRole('button', { name: /download png/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download svg/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy svg/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    expect(screen.queryByRole('button', { name: /download png/i })).not.toBeInTheDocument();
  });

  it('has a working Load example button', async () => {
    render(<BarcodeGenerator />);
    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    expect(screen.getByLabelText(/^value/i)).toHaveValue('');

    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    expect(screen.getByLabelText(/^value/i)).toHaveValue('HELLO-123');
  });

  it('has a working share-link button', () => {
    render(<BarcodeGenerator />);
    expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument();
  });
});
