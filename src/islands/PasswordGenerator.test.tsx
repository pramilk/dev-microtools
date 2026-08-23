import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import PasswordGenerator from './PasswordGenerator';

describe('<PasswordGenerator />', () => {
  it('shows a password of the default length on mount', async () => {
    render(<PasswordGenerator />);
    const output = await screen.findByText((_, el) => el?.tagName === 'OUTPUT' && el.textContent!.length === 20);
    expect(output).toBeInTheDocument();
  });

  it('generates a new password when Generate is pressed', async () => {
    render(<PasswordGenerator />);
    const before = (await screen.findByText((_, el) => el?.tagName === 'OUTPUT')).textContent;

    fireEvent.click(screen.getByRole('button', { name: /^generate$/i }));

    const after = (await screen.findByText((_, el) => el?.tagName === 'OUTPUT')).textContent;
    expect(after).not.toBe(before);
  });

  it('shows an error and no password when every character type is disabled', async () => {
    render(<PasswordGenerator />);
    fireEvent.click(screen.getByRole('button', { name: 'A-Z' }));
    fireEvent.click(screen.getByRole('button', { name: 'a-z' }));
    fireEvent.click(screen.getByRole('button', { name: '0-9' }));
    fireEvent.click(screen.getByRole('button', { name: '!@#' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/at least one/i);
    expect(screen.queryByText((_, el) => el?.tagName === 'OUTPUT')).not.toBeInTheDocument();
  });

  it('regenerates to match a new length when the slider changes', async () => {
    render(<PasswordGenerator />);
    fireEvent.input(screen.getByLabelText(/length/i), { target: { value: '40' } });

    const output = await screen.findByText((_, el) => el?.tagName === 'OUTPUT' && el.textContent!.length === 40);
    expect(output).toBeInTheDocument();
  });

  it('shows a strength label once a password exists', async () => {
    render(<PasswordGenerator />);
    expect(await screen.findByText(/strong/i)).toBeInTheDocument();
  });

  it('generates a batch of the requested size', async () => {
    render(<PasswordGenerator />);
    fireEvent.input(screen.getByLabelText(/number of passwords/i), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /generate batch/i }));

    const batchLabel = await screen.findByText('Batch');
    const pane = batchLabel.closest('.field')!.querySelector('pre')!;
    expect(pane.textContent!.trim().split('\n')).toHaveLength(5);
  });

  it('offers a download button once a batch exists', async () => {
    render(<PasswordGenerator />);
    fireEvent.click(screen.getByRole('button', { name: /generate batch/i }));
    expect(await screen.findByRole('button', { name: /download/i })).not.toBeDisabled();
  });
});
