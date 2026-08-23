import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/preact';
import DataFormatConverter from './DataFormatConverter';

const output = () => within(document.querySelector<HTMLElement>('.output')!);

/** Loads the built-in example for whatever "From" format is currently selected. */
const loadSample = async () => {
  fireEvent.click(screen.getByRole('button', { name: /load example/i }));
  await screen.findByText(/name: Ada/);
};

describe('<DataFormatConverter />', () => {
  it('starts empty with a placeholder, not a pre-loaded sample', () => {
    render(<DataFormatConverter />);

    expect(screen.getByLabelText(/json input/i)).toHaveValue('');
    expect(document.querySelector('.output--empty')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/paste json here/i)).toBeInTheDocument();
  });

  it('converts the loaded JSON sample to YAML', async () => {
    render(<DataFormatConverter />);
    await loadSample();

    expect(output().getByText(/role: Engineer/)).toBeInTheDocument();
  });

  it('re-converts when the "To" format changes', async () => {
    render(<DataFormatConverter />);
    await loadSample();

    fireEvent.change(screen.getByLabelText(/convert to format/i), { target: { value: 'csv' } });

    await screen.findByText(/name,role/);
    expect(output().getByText(/Ada,Engineer/)).toBeInTheDocument();
  });

  it('shows CSV-only options only when CSV is involved', async () => {
    render(<DataFormatConverter />);
    expect(screen.queryByLabelText(/csv delimiter/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/convert to format/i), { target: { value: 'csv' } });
    expect(await screen.findByLabelText(/csv delimiter/i)).toBeInTheDocument();
  });

  it('parses CSV without a header as raw rows when the checkbox is unchecked', async () => {
    render(<DataFormatConverter />);
    fireEvent.change(screen.getByLabelText(/convert from format/i), { target: { value: 'csv' } });
    fireEvent.change(screen.getByLabelText(/convert to format/i), { target: { value: 'json' } });
    fireEvent.input(screen.getByLabelText(/csv input/i), { target: { value: 'Ada,Engineer\nGrace,Admiral' } });
    fireEvent.click(screen.getByLabelText(/first row is a header/i));

    await screen.findByText(/"Ada"/);
    const pane = document.querySelector<HTMLElement>('.output')!;
    // Without a header, rows stay bare arrays — no synthesised object keys like "name".
    expect(pane.textContent).not.toContain('"name"');
    expect(JSON.parse(pane.textContent!)).toEqual([
      ['Ada', 'Engineer'],
      ['Grace', 'Admiral'],
    ]);
  });

  it('swaps From/To and moves the current output into the input', async () => {
    render(<DataFormatConverter />);
    await loadSample();

    fireEvent.click(screen.getByRole('button', { name: /swap/i }));

    expect(screen.getByLabelText(/convert from format/i)).toHaveValue('yaml');
    expect(screen.getByLabelText(/convert to format/i)).toHaveValue('json');
    expect((screen.getByLabelText(/yaml input/i) as HTMLTextAreaElement).value).toContain('name: Ada');
  });

  it('shows a visible error for malformed input, not a blank result', async () => {
    render(<DataFormatConverter />);
    fireEvent.input(screen.getByLabelText(/json input/i), { target: { value: '{not valid' } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid json/i);
    expect(document.querySelector('.output--empty')).toBeInTheDocument();
  });

  it('clears the input when Clear is pressed', async () => {
    render(<DataFormatConverter />);
    await loadSample();

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(screen.getByLabelText(/json input/i)).toHaveValue('');
    expect(document.querySelector('.output--empty')).toBeInTheDocument();
  });

  it('loads the format-appropriate sample when "Load example" is pressed', async () => {
    render(<DataFormatConverter />);
    fireEvent.change(screen.getByLabelText(/convert from format/i), { target: { value: 'csv' } });

    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    expect((screen.getByLabelText(/csv input/i) as HTMLTextAreaElement).value).toContain('name,role');
  });

  it('detects the format of a dropped file and switches "From" to match', async () => {
    render(<DataFormatConverter />);

    const file = new File(['name: Ada\nrole: Engineer\n'], 'data.yaml', { type: 'text/yaml' });
    fireEvent.drop(screen.getByLabelText(/^\w+ input/i), { dataTransfer: { files: [file] } });

    await screen.findByDisplayValue(/name: Ada/);
    expect(screen.getByLabelText(/convert from format/i)).toHaveValue('yaml');
  });

  it('detects the format on paste into an empty box', async () => {
    render(<DataFormatConverter />);

    fireEvent.paste(screen.getByLabelText(/^\w+ input/i), {
      clipboardData: { getData: () => 'name,role\nAda,Engineer\n' },
    });

    expect(screen.getByLabelText(/convert from format/i)).toHaveValue('csv');
  });

  it('does not override "From" when pasting into a box that already has content', async () => {
    render(<DataFormatConverter />);
    await loadSample();

    fireEvent.paste(screen.getByLabelText(/json input/i), {
      clipboardData: { getData: () => 'name,role\nAda,Engineer\n' },
    });

    expect(screen.getByLabelText(/convert from format/i)).toHaveValue('json');
  });
});
