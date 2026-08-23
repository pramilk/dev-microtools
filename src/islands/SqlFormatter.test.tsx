import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/preact';
import SqlFormatter from './SqlFormatter';

const output = () => within(document.querySelector<HTMLElement>('.output')!);

describe('<SqlFormatter />', () => {
  it('starts empty with a placeholder', () => {
    render(<SqlFormatter />);

    expect(screen.getByLabelText(/sql input/i)).toHaveValue('');
    expect(document.querySelector('.output--empty')).toBeInTheDocument();
  });

  it('formats typed SQL with uppercase keywords by default', async () => {
    render(<SqlFormatter />);

    fireEvent.input(screen.getByLabelText(/sql input/i), { target: { value: 'select a from t where a=1' } });

    expect(await output().findByText(/SELECT/)).toBeInTheDocument();
    expect(output().getByText(/WHERE/)).toBeInTheDocument();
  });

  it('re-formats when the keyword case option changes', async () => {
    render(<SqlFormatter />);
    fireEvent.input(screen.getByLabelText(/sql input/i), { target: { value: 'select a from t' } });
    await output().findByText(/SELECT/);

    fireEvent.change(screen.getByLabelText(/keyword case/i), { target: { value: 'lower' } });

    await screen.findByText(/select/, { selector: '.output' });
    expect(document.querySelector('.output')!.textContent).not.toContain('SELECT');
  });

  it('loads the example query', async () => {
    render(<SqlFormatter />);

    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    expect((screen.getByLabelText(/sql input/i) as HTMLTextAreaElement).value).toContain('orders');
    expect(await output().findByText(/SELECT/)).toBeInTheDocument();
  });

  it('loads a dialect-appropriate example, since plain LIMIT is not valid in every dialect', async () => {
    render(<SqlFormatter />);
    fireEvent.change(screen.getByLabelText(/sql dialect/i), { target: { value: 'transactsql' } });

    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    const value = (screen.getByLabelText(/sql input/i) as HTMLTextAreaElement).value;
    expect(value).toContain('top 20');
    expect(value).not.toContain('limit');
    expect(await output().findByText(/TOP 20/)).toBeInTheDocument();
  });

  it('shows a visible, human-readable error for malformed SQL, not a raw parser dump', async () => {
    render(<SqlFormatter />);

    fireEvent.input(screen.getByLabelText(/sql input/i), { target: { value: 'select * from t where (a=1' } });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not format this sql/i);
    expect(alert.textContent!.length).toBeLessThan(200);
    expect(document.querySelector('.output--empty')).toBeInTheDocument();
  });

  it('clears the input when Clear is pressed', async () => {
    render(<SqlFormatter />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    await output().findByText(/SELECT/);

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(screen.getByLabelText(/sql input/i)).toHaveValue('');
    expect(document.querySelector('.output--empty')).toBeInTheDocument();
  });
});
