import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import SecurityTxtGenerator from './SecurityTxtGenerator';

const outputText = () => document.querySelector<HTMLElement>('.output')?.textContent ?? '';

describe('<SecurityTxtGenerator />', () => {
  it('starts empty with a placeholder and no error', () => {
    render(<SecurityTxtGenerator />);

    expect(document.querySelector('.output--empty')).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('filling contact and expires produces output', () => {
    render(<SecurityTxtGenerator />);

    fireEvent.input(screen.getByLabelText('Contact 1'), { target: { value: 'security@example.com' } });
    fireEvent.input(screen.getByLabelText('Expires'), { target: { value: '2099-01-01' } });

    expect(outputText()).toContain('Contact: mailto:security@example.com');
    expect(outputText()).toContain('Expires: 2099-01-01T00:00:00Z');
    expect(document.querySelector('.output--empty')).toBeNull();
  });

  it('shows a visible error for an unrecognizable contact, once expires is set', () => {
    render(<SecurityTxtGenerator />);

    fireEvent.input(screen.getByLabelText('Expires'), { target: { value: '2099-01-01' } });
    fireEvent.input(screen.getByLabelText('Contact 1'), { target: { value: 'not a contact' } });

    expect(screen.getByRole('alert')).toHaveTextContent(/isn't a recognizable/i);
  });

  it('shows no error for an untouched form', () => {
    render(<SecurityTxtGenerator />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('adds and removes contact rows', () => {
    render(<SecurityTxtGenerator />);

    fireEvent.click(screen.getByRole('button', { name: '+ Add contact' }));
    expect(screen.getAllByLabelText(/^Contact \d/)).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Remove contact 2' }));
    expect(screen.getAllByLabelText(/^Contact \d/)).toHaveLength(1);
  });

  it('warns when there is no canonical URL', () => {
    render(<SecurityTxtGenerator />);
    fireEvent.input(screen.getByLabelText('Contact 1'), { target: { value: 'security@example.com' } });
    fireEvent.input(screen.getByLabelText('Expires'), { target: { value: '2099-01-01' } });

    expect(screen.getByText(/No Canonical URL/)).toBeInTheDocument();
  });

  it('loads a worked example that fills contacts, expires and optional fields', () => {
    render(<SecurityTxtGenerator />);

    fireEvent.click(screen.getByRole('button', { name: 'Load example' }));

    expect((screen.getByLabelText('Contact 1') as HTMLInputElement).value).not.toBe('');
    expect(outputText()).toContain('Contact: mailto:security@example.com');
    expect(outputText()).toContain('Canonical:');
  });

  it('clear resets every field back to empty', () => {
    render(<SecurityTxtGenerator />);
    fireEvent.click(screen.getByRole('button', { name: 'Load example' }));
    expect((screen.getByLabelText('Contact 1') as HTMLInputElement).value).not.toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect((screen.getByLabelText('Contact 1') as HTMLInputElement).value).toBe('');
    expect(document.querySelector('.output--empty')).not.toBeNull();
  });

  it('offers copy, download and share-link controls once there is output', () => {
    render(<SecurityTxtGenerator />);
    fireEvent.input(screen.getByLabelText('Contact 1'), { target: { value: 'security@example.com' } });
    fireEvent.input(screen.getByLabelText('Expires'), { target: { value: '2099-01-01' } });

    expect(screen.getByRole('button', { name: 'Copy' })).toBeEnabled();
    expect(screen.getByRole('button', { name: /download/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument();
  });
});
