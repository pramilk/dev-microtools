import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/preact';
import TimezoneConverter from './TimezoneConverter';

const typeInto = (element: HTMLElement, value: string) => {
  fireEvent.input(element, { target: { value } });
};

const results = () => screen.getByRole('list', { name: /converted times/i });

afterEach(() => {
  window.location.hash = '';
});

describe('<TimezoneConverter />', () => {
  it('shows a conversion immediately on load, with no click required', () => {
    render(<TimezoneConverter />);
    expect(within(results()).getAllByRole('listitem').length).toBeGreaterThan(1);
  });

  it('loads the example and converts it across zones, flagging the next-day result', async () => {
    render(<TimezoneConverter />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    const list = within(results());
    expect(await list.findByText('America/New_York')).toBeInTheDocument();
    expect(list.getByText('Asia/Kolkata')).toBeInTheDocument();
    expect(list.getByText(/UTC\+5:30/)).toBeInTheDocument();
    // 09:00 in New York is already past midnight the next day in Sydney.
    expect(list.getByText('+1 day')).toBeInTheDocument();
  });

  it('summarises when no working hour is shared', async () => {
    render(<TimezoneConverter />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    expect(await screen.findByText(/no hour on this day falls inside/i)).toBeInTheDocument();
  });

  it('reports the shared working window when zones overlap', async () => {
    render(<TimezoneConverter />);
    typeInto(screen.getByLabelText(/source time zone/i), 'America/New_York');
    typeInto(screen.getByLabelText(/date and time/i), '2026-01-15T09:00');
    // Leave only London: 9-12 in New York overlaps 14-17 in London.
    for (const zone of ['UTC', 'Asia/Kolkata', 'Asia/Tokyo']) {
      fireEvent.click(screen.getByRole('button', { name: `Remove ${zone}` }));
    }
    expect(await screen.findByText(/everyone is within working hours: 09:00–12:00 America\/New_York time/i)).toBeInTheDocument();
  });

  it('explains a time that daylight saving skips instead of converting it', async () => {
    render(<TimezoneConverter />);
    typeInto(screen.getByLabelText(/source time zone/i), 'America/New_York');
    typeInto(screen.getByLabelText(/date and time/i), '2026-03-08T02:30');
    expect(await screen.findByRole('alert')).toHaveTextContent(/does not exist/i);
    expect(screen.queryByRole('list', { name: /converted times/i })).not.toBeInTheDocument();
  });

  it('notes a time that happens twice', async () => {
    render(<TimezoneConverter />);
    typeInto(screen.getByLabelText(/source time zone/i), 'America/New_York');
    typeInto(screen.getByLabelText(/date and time/i), '2026-11-01T01:30');
    expect(await screen.findByText(/happens twice/i)).toBeInTheDocument();
  });

  it('rejects an unknown source zone with a message', async () => {
    render(<TimezoneConverter />);
    typeInto(screen.getByLabelText(/source time zone/i), 'Nowhere/Land');
    expect(await screen.findByRole('alert')).toHaveTextContent(/not a recognised IANA time zone/i);
  });

  it('adds a zone from the text box and removes it again', async () => {
    render(<TimezoneConverter />);
    typeInto(screen.getByLabelText(/add a time zone/i), 'Europe/Paris');
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    expect(await within(results()).findByText('Europe/Paris')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Europe/Paris' }));
    expect(within(results()).queryByText('Europe/Paris')).not.toBeInTheDocument();
  });

  it('rejects an unknown zone typed into the add box', async () => {
    render(<TimezoneConverter />);
    typeInto(screen.getByLabelText(/add a time zone/i), 'Atlantis/Core');
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/atlantis\/core/i);
  });

  it('adds a zone with a quick-add city chip', async () => {
    render(<TimezoneConverter />);
    fireEvent.click(screen.getByRole('button', { name: /^\+ Dubai$/ }));
    expect(await within(results()).findByText('Asia/Dubai')).toBeInTheDocument();
  });

  it('flags an invalid working-hours range', async () => {
    render(<TimezoneConverter />);
    fireEvent.change(screen.getByLabelText(/working day starts at/i), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText(/working day ends at/i), { target: { value: '10' } });
    expect(await screen.findByRole('alert')).toHaveTextContent(/working hours must be whole hours/i);
  });

  it('clears the date and time, and hides the results', async () => {
    render(<TimezoneConverter />);
    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    expect((screen.getByLabelText(/date and time/i) as HTMLInputElement).value).toBe('');
    expect(screen.queryByRole('list', { name: /converted times/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('offers a copy button per row', () => {
    render(<TimezoneConverter />);
    expect(within(results()).getAllByRole('button', { name: /copy/i }).length).toBeGreaterThan(1);
  });
});

describe('<TimezoneConverter /> share link', () => {
  it('restores the time, zones and working hours from a shared link on load', async () => {
    const { encodeShareState } = await import('../lib/shareLink');
    const encoded = await encodeShareState({
      dateTime: '2026-03-14T09:00',
      sourceZone: 'America/New_York',
      targets: ['Asia/Tokyo'],
      workStart: 8,
      workEnd: 18,
    });
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    window.location.hash = `#s=${encoded.value}`;
    render(<TimezoneConverter />);

    // Tokyo is also a default target, so wait on a value only the shared link can set.
    await waitFor(() =>
      expect((screen.getByLabelText(/working day starts at/i) as HTMLSelectElement).value).toBe('8')
    );
    expect((screen.getByLabelText(/source time zone/i) as HTMLInputElement).value).toBe('America/New_York');
    expect(within(results()).getByText('Asia/Tokyo')).toBeInTheDocument();
    expect(within(results()).queryByText('Europe/London')).not.toBeInTheDocument();
  });
});
