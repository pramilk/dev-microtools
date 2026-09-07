import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import ChmodCalculator from './ChmodCalculator';

describe('<ChmodCalculator />', () => {
  it('shows the octal, symbolic and command output for the default permission', async () => {
    render(<ChmodCalculator />);

    await screen.findByText('rwxr-xr-x');
    expect(screen.getByText('rwxr-xr-x')).toBeInTheDocument();
    expect(screen.getByText('chmod 755 file')).toBeInTheDocument();
  });

  it('recalculates as the permission changes', async () => {
    render(<ChmodCalculator />);
    fireEvent.input(screen.getByLabelText(/^permission/i), { target: { value: '644' } });

    await screen.findByText('rw-r--r--');
    expect(screen.getByText('chmod 644 file')).toBeInTheDocument();
  });

  it('accepts symbolic input directly', async () => {
    render(<ChmodCalculator />);
    fireEvent.input(screen.getByLabelText(/^permission/i), { target: { value: 'rwxrwxrwx' } });

    await screen.findByText('chmod 777 file');
  });

  it('shows a visible error for an invalid permission, not a blank result', async () => {
    render(<ChmodCalculator />);
    fireEvent.input(screen.getByLabelText(/^permission/i), { target: { value: 'not-a-permission' } });

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/^chmod \d/)).not.toBeInTheDocument();
  });

  it('toggling a checkbox updates the permission input', async () => {
    render(<ChmodCalculator />);
    await screen.findByText('rwxr-xr-x');

    fireEvent.click(screen.getByLabelText('Owner write'));

    expect(screen.getByLabelText(/^permission/i)).toHaveValue('555');
  });

  it('toggling the sticky bit updates the octal output', async () => {
    render(<ChmodCalculator />);
    await screen.findByText('rwxr-xr-x');

    fireEvent.click(screen.getByLabelText(/sticky bit/i));

    expect(screen.getByLabelText(/^permission/i)).toHaveValue('1755');
  });

  it('applies a preset when clicked', async () => {
    render(<ChmodCalculator />);
    fireEvent.click(screen.getByRole('button', { name: /^644$/ }));

    expect(screen.getByLabelText(/^permission/i)).toHaveValue('644');
    await screen.findByText('rw-r--r--');
  });

  it('clears the input when Clear is pressed', async () => {
    render(<ChmodCalculator />);
    await screen.findByText('rwxr-xr-x');

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(screen.getByLabelText(/^permission/i)).toHaveValue('');
    expect(screen.queryByText('rwxr-xr-x')).not.toBeInTheDocument();
  });
});
