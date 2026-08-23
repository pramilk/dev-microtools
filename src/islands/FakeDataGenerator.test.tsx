import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/preact';
import FakeDataGenerator from './FakeDataGenerator';

const output = () => within(document.querySelector<HTMLElement>('.output')!);

describe('<FakeDataGenerator />', () => {
  it('generates data immediately with sensible defaults, not an empty state', async () => {
    render(<FakeDataGenerator />);

    const rows = await output().findByText((_, el) => el?.tagName === 'PRE' && el.textContent!.includes('"Email"'));
    const parsed = JSON.parse(rows.textContent!);
    expect(parsed).toHaveLength(10);
  });

  it('reports the seed used, so it can be reproduced', async () => {
    render(<FakeDataGenerator />);
    expect(await screen.findByText(/seed used/i)).toBeInTheDocument();
  });

  it('produces identical output when a seed is pinned', async () => {
    render(<FakeDataGenerator />);
    await screen.findByText(/seed used/i);

    fireEvent.input(screen.getByLabelText(/seed \(optional/i), { target: { value: '12345' } });
    const first = await output().findByText((_, el) => el?.tagName === 'PRE');
    const firstText = first.textContent;

    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));
    fireEvent.input(screen.getByLabelText(/seed \(optional/i), { target: { value: '12345' } });

    const second = await output().findByText((_, el) => el?.tagName === 'PRE');
    expect(second.textContent).toBe(firstText);
  });

  it('switches to CSV output', async () => {
    render(<FakeDataGenerator />);
    await output().findByText((_, el) => el?.tagName === 'PRE');

    fireEvent.change(screen.getByLabelText(/output format/i), { target: { value: 'csv' } });

    const csv = await output().findByText((_, el) => el?.tagName === 'PRE' && el.textContent!.includes(','));
    expect(csv.textContent!.split('\r\n').length).toBeGreaterThan(1);
    expect(() => JSON.parse(csv.textContent!)).toThrow();
  });

  it('adds and removes a field', async () => {
    render(<FakeDataGenerator />);
    await output().findByText((_, el) => el?.tagName === 'PRE');
    const before = screen.getAllByLabelText(/^field type$/i).length;

    fireEvent.click(screen.getByRole('button', { name: /add field/i }));
    expect(screen.getAllByLabelText(/^field type$/i)).toHaveLength(before + 1);

    fireEvent.click(screen.getAllByRole('button', { name: /^remove$/i })[0]!);
    expect(screen.getAllByLabelText(/^field type$/i)).toHaveLength(before);
  });

  it('changing the field type dropdown switches what the field generates and resets its column name', async () => {
    render(<FakeDataGenerator />);
    await output().findByText((_, el) => el?.tagName === 'PRE');
    const typeSelect = screen.getAllByLabelText(/^field type$/i)[0]!;

    fireEvent.change(typeSelect, { target: { value: 'company' } });

    expect((screen.getAllByLabelText(/^column name$/i)[0] as HTMLInputElement).value).toBe('Company');
    const text = (await output().findByText((_, el) => el?.tagName === 'PRE' && el.textContent!.includes('"Company"')))
      .textContent!;
    const rows = JSON.parse(text);
    expect(rows[0]).toHaveProperty('Company');
    expect(rows[0]).not.toHaveProperty('Full name');
  });

  it('renaming the column name does not change what the field generates', async () => {
    render(<FakeDataGenerator />);
    await output().findByText((_, el) => el?.tagName === 'PRE');
    const nameInput = screen.getAllByLabelText(/^column name$/i)[0]!;

    fireEvent.input(nameInput, { target: { value: 'Person' } });

    expect((nameInput as HTMLInputElement).value).toBe('Person');
    const rows = JSON.parse(
      (await output().findByText((_, el) => el?.tagName === 'PRE' && el.textContent!.includes('"Person"'))).textContent!
    );
    // Still a full name (two words) — renaming never touches the field's type.
    expect(rows[0].Person).toMatch(/^\S+ \S+$/);
  });

  it('shows a visible error when the row count is out of range', async () => {
    render(<FakeDataGenerator />);
    await output().findByText((_, el) => el?.tagName === 'PRE');

    fireEvent.input(screen.getByLabelText(/row count/i), { target: { value: '5000' } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/between/i);
    expect(document.querySelector('.output--empty')).toBeInTheDocument();
  });

  it('shows a visible error for duplicate column names', async () => {
    render(<FakeDataGenerator />);
    await output().findByText((_, el) => el?.tagName === 'PRE');

    const labels = screen.getAllByLabelText(/^column name$/i);
    fireEvent.input(labels[1]!, { target: { value: (labels[0] as HTMLInputElement).value } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/unique/i);
  });
});
