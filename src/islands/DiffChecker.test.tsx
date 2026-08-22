import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import DiffChecker from './DiffChecker';

const typeInto = (element: HTMLElement, value: string) => {
  fireEvent.input(element, { target: { value } });
};

describe('<DiffChecker />', () => {
  it('reports identical texts as identical', async () => {
    render(<DiffChecker />);
    typeInto(screen.getByLabelText(/original/i), 'same');
    typeInto(screen.getByLabelText(/changed/i), 'same');

    expect(await screen.findByText(/texts are identical/i)).toBeInTheDocument();
  });

  it('shows added and removed counts when texts differ', async () => {
    render(<DiffChecker />);
    typeInto(screen.getByLabelText(/original/i), 'a\nb\n');
    typeInto(screen.getByLabelText(/changed/i), 'a\nc\n');

    // Scoped to the stats row, since the legend below also contains "added".
    const stats = await screen.findByText(/added/, { selector: '.stats__item' });
    expect(stats).toHaveTextContent('+1');
    expect(screen.getByText(/removed/, { selector: '.stats__item' })).toHaveTextContent('1');
  });

  it('treats equivalent JSON as identical in JSON mode', async () => {
    render(<DiffChecker />);
    fireEvent.click(screen.getByRole('button', { name: /^json$/i }));
    typeInto(screen.getByLabelText(/original/i), '{"b":2,"a":1}');
    typeInto(screen.getByLabelText(/changed/i), '{"a":1,"b":2}');

    expect(await screen.findByText(/equivalent json/i)).toBeInTheDocument();
  });

  it('names which side of a JSON comparison failed to parse', async () => {
    render(<DiffChecker />);
    fireEvent.click(screen.getByRole('button', { name: /^json$/i }));
    typeInto(screen.getByLabelText(/original/i), 'nope');
    typeInto(screen.getByLabelText(/changed/i), '{"a":1}');

    expect(await screen.findByRole('alert')).toHaveTextContent(/left/i);
  });

  it('detects a real value change in JSON mode', async () => {
    render(<DiffChecker />);
    fireEvent.click(screen.getByRole('button', { name: /^json$/i }));
    typeInto(screen.getByLabelText(/original/i), '{"a":1}');
    typeInto(screen.getByLabelText(/changed/i), '{"a":2}');

    expect(await screen.findByText(/^differences$/i)).toBeInTheDocument();
  });

  it('can ignore case when comparing text', async () => {
    render(<DiffChecker />);
    typeInto(screen.getByLabelText(/original/i), 'Hello');
    typeInto(screen.getByLabelText(/changed/i), 'hello');
    await screen.findByText(/^differences$/i);

    fireEvent.click(screen.getByLabelText(/ignore case/i));
    expect(await screen.findByText(/texts are identical/i)).toBeInTheDocument();
  });

  it('clears both panes', async () => {
    render(<DiffChecker />);
    const left = screen.getByLabelText(/original/i) as HTMLTextAreaElement;
    typeInto(left, 'content');
    await screen.findByText(/^differences$/i);

    fireEvent.click(screen.getByRole('button', { name: /clear both/i }));
    expect(left.value).toBe('');
  });
});
