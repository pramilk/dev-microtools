import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/preact';
import CidrCalculator from './CidrCalculator';

const grid = () => within(document.querySelector<HTMLElement>('.cidr-grid')!);

describe('<CidrCalculator />', () => {
  it('shows subnet details for the default address on load', async () => {
    render(<CidrCalculator />);

    await screen.findByText('192.168.1.0/24');
    expect(grid().getByText('192.168.1.255')).toBeInTheDocument();
    expect(grid().getByText('255.255.255.0')).toBeInTheDocument();
    expect(grid().getByText('254')).toBeInTheDocument();
  });

  it('recalculates as the address changes', async () => {
    render(<CidrCalculator />);
    fireEvent.input(screen.getByLabelText(/^address/i), { target: { value: '10.0.0.0/8' } });

    await screen.findByText('10.0.0.0/8');
    expect(grid().getByText('10.255.255.255')).toBeInTheDocument();
  });

  it('shows a visible error for an invalid address, not a blank result', async () => {
    render(<CidrCalculator />);
    fireEvent.input(screen.getByLabelText(/^address/i), { target: { value: '999.1.1.1/24' } });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(document.querySelector('.cidr-grid')).not.toBeInTheDocument();
  });

  it('applies a preset when clicked', async () => {
    render(<CidrCalculator />);
    fireEvent.click(screen.getByRole('button', { name: /single host/i }));

    expect(screen.getByLabelText(/^address/i)).toHaveValue('127.0.0.1/32');
    await screen.findByText('127.0.0.1/32');
  });

  it('clears the input when Clear is pressed', async () => {
    render(<CidrCalculator />);
    await screen.findByText('192.168.1.0/24');

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(screen.getByLabelText(/^address/i)).toHaveValue('');
    expect(document.querySelector('.cidr-grid')).not.toBeInTheDocument();
  });

  it('shows the binary breakdown split at the network/host boundary', async () => {
    render(<CidrCalculator />);
    await screen.findByText('192.168.1.0/24');

    expect(document.querySelector('.binary__network')?.textContent).toBe('11000000.10101000.00000001');
    expect(document.querySelector('.binary__host')?.textContent).toBe('.00000000');
  });
});
