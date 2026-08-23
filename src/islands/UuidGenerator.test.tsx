import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import UuidGenerator from './UuidGenerator';

const UUID_SHAPE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

describe('<UuidGenerator />', () => {
  it('generates an initial batch on mount so the tool is immediately useful', async () => {
    render(<UuidGenerator />);
    const output = await screen.findByText(UUID_SHAPE);
    expect(output.textContent!.trim().split('\n')).toHaveLength(5);
  });

  it('generates a new batch when Generate is pressed', async () => {
    render(<UuidGenerator />);
    const before = (await screen.findByText(UUID_SHAPE)).textContent;

    fireEvent.click(screen.getByRole('button', { name: /generate/i }));

    const after = (await screen.findByText(UUID_SHAPE)).textContent;
    expect(after).not.toBe(before);
  });

  it('generates v7 UUIDs when that version is selected', async () => {
    render(<UuidGenerator />);
    fireEvent.click(screen.getByRole('button', { name: /v7/i }));
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));

    const output = await screen.findByText(UUID_SHAPE);
    for (const uuid of output.textContent!.trim().split('\n')) {
      expect(uuid[14]).toBe('7');
    }
  });

  it('honours the requested count', async () => {
    render(<UuidGenerator />);
    fireEvent.input(screen.getByLabelText(/number of uuids/i), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));

    const output = await screen.findByText(UUID_SHAPE);
    expect(output.textContent!.trim().split('\n')).toHaveLength(3);
  });

  it('shows an error when the count exceeds the cap', async () => {
    render(<UuidGenerator />);
    fireEvent.input(screen.getByLabelText(/number of uuids/i), { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: /generate/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/1000/);
  });

  it('confirms a valid UUID pasted into the inspect field', async () => {
    render(<UuidGenerator />);
    fireEvent.input(screen.getByLabelText(/inspect an existing uuid/i), {
      target: { value: '019284f1-8c40-7a3e-b9d2-1f4c8a2e5b71' },
    });

    expect(await screen.findByText(/valid uuid, version 7/i)).toBeInTheDocument();
  });

  it('rejects an invalid UUID in the inspect field', async () => {
    render(<UuidGenerator />);
    fireEvent.input(screen.getByLabelText(/inspect an existing uuid/i), {
      target: { value: 'nope' },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(/8-4-4-4-12/);
  });

  it('reformats the batch as a JSON array when that format is selected', async () => {
    render(<UuidGenerator />);
    await screen.findByText(UUID_SHAPE);

    fireEvent.change(screen.getByLabelText(/output format/i), { target: { value: 'json' } });

    const output = await screen.findByText(/^\[/);
    const parsed = JSON.parse(output.textContent!);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(5);
  });
});
