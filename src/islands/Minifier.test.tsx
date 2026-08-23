import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/preact';
import Minifier from './Minifier';

const output = () => within(document.querySelector<HTMLElement>('.output')!);

describe('<Minifier />', () => {
  it('starts empty with a placeholder, defaulting to JavaScript', () => {
    render(<Minifier />);

    expect(screen.getByLabelText(/javascript input/i)).toHaveValue('');
    expect(document.querySelector('.output--empty')).toBeInTheDocument();
    expect(screen.getByLabelText(/language to minify/i)).toHaveValue('js');
  });

  it('minifies typed JavaScript', async () => {
    render(<Minifier />);

    fireEvent.input(screen.getByLabelText(/javascript input/i), {
      target: { value: 'function add(a, b) {\n  return a + b;\n}' },
    });

    const result = await output().findByText(/function add/);
    expect(result.textContent).not.toContain('\n');
  });

  it('minifies typed CSS after switching language', async () => {
    render(<Minifier />);

    fireEvent.change(screen.getByLabelText(/language to minify/i), { target: { value: 'css' } });
    fireEvent.input(screen.getByLabelText(/css input/i), { target: { value: '.a {\n  color: red;\n}' } });

    expect(await output().findByText('.a{color:red}')).toBeInTheDocument();
  });

  it('minifies typed HTML after switching language', async () => {
    render(<Minifier />);

    fireEvent.change(screen.getByLabelText(/language to minify/i), { target: { value: 'html' } });
    fireEvent.input(screen.getByLabelText(/html input/i), { target: { value: '<div>\n  Hi\n</div>' } });

    expect(await output().findByText('<div> Hi </div>')).toBeInTheDocument();
  });

  it('loads the language-appropriate sample when "Load example" is pressed', async () => {
    render(<Minifier />);
    fireEvent.change(screen.getByLabelText(/language to minify/i), { target: { value: 'css' } });

    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    expect((screen.getByLabelText(/css input/i) as HTMLTextAreaElement).value).toContain('.card');
  });

  it('shows a visible error for malformed JavaScript, not a silent failure', async () => {
    render(<Minifier />);

    fireEvent.input(screen.getByLabelText(/javascript input/i), { target: { value: 'function broken( { return; }' } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not minify this javascript/i);
    expect(document.querySelector('.output--empty')).toBeInTheDocument();
  });

  it('shows a size-reduction summary once minification succeeds', async () => {
    render(<Minifier />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    expect(await screen.findByTestId('minify-stats')).toHaveTextContent(/smaller|larger|no change/i);
  });

  it('clears the input when Clear is pressed', async () => {
    render(<Minifier />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    await output().findByText(/function greet/);

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(screen.getByLabelText(/javascript input/i)).toHaveValue('');
    expect(document.querySelector('.output--empty')).toBeInTheDocument();
  });
});
