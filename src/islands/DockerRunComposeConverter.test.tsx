import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/preact';
import DockerRunComposeConverter from './DockerRunComposeConverter';

function stubClipboard(writeText: ((text: string) => Promise<void>) | null) {
  Object.assign(navigator, { clipboard: writeText === null ? undefined : { writeText } });
}

afterEach(() => stubClipboard(null));

const output = () => within(document.querySelector<HTMLElement>('.output')!);

const runInput = () => screen.getByLabelText(/docker run command/i) as HTMLTextAreaElement;

describe('<DockerRunComposeConverter />', () => {
  it('starts empty with a placeholder, not a pre-loaded sample', () => {
    render(<DockerRunComposeConverter />);
    expect(runInput()).toHaveValue('');
    expect(document.querySelector('.output--empty')).toBeInTheDocument();
  });

  it('loads the docker run example and converts it to compose YAML', async () => {
    render(<DockerRunComposeConverter />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    expect(runInput().value).toContain('docker run -d --name web');
    await screen.findByText(/image: nginx:alpine/);
    expect(output().getByText(/container_name: web/)).toBeInTheDocument();
    expect(output().getByText(/NODE_ENV: production/)).toBeInTheDocument();
  });

  it('converts a typed docker run command live', async () => {
    render(<DockerRunComposeConverter />);
    fireEvent.input(runInput(), { target: { value: 'docker run --name api -p 3000:3000 node:20' } });

    await screen.findByText(/image: node:20/);
    expect(output().getByText(/container_name: api/)).toBeInTheDocument();
  });

  it('shows a visible error for a command that is not docker run, not a stack trace', async () => {
    render(<DockerRunComposeConverter />);
    fireEvent.input(runInput(), { target: { value: 'ls -la /tmp' } });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/docker run/i);
    expect(document.querySelector('.output--empty')).toBeInTheDocument();
  });

  it('shows a non-blocking warning for an unrecognized flag instead of silently dropping it', async () => {
    render(<DockerRunComposeConverter />);
    fireEvent.input(runInput(), { target: { value: 'docker run --privileged nginx' } });

    await screen.findByText(/image: nginx/);
    expect(await screen.findByText(/--privileged/)).toBeInTheDocument();
  });

  it('switches to compose -> docker run and converts the example', async () => {
    render(<DockerRunComposeConverter />);
    fireEvent.click(screen.getByRole('button', { name: /compose → docker run/i }));
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));

    const composeInput = screen.getByLabelText(/compose yaml/i) as HTMLTextAreaElement;
    expect(composeInput.value).toContain('image: nginx:alpine');

    await screen.findByText(/nginx:alpine/);
    expect(output().getByText(/nginx:alpine/)).toBeInTheDocument();
    expect(output().getByText(/--name 'web'/)).toBeInTheDocument();
  });

  it('shows a visible error for malformed compose YAML', async () => {
    render(<DockerRunComposeConverter />);
    fireEvent.click(screen.getByRole('button', { name: /compose → docker run/i }));
    fireEvent.input(screen.getByLabelText(/compose yaml/i), { target: { value: 'not compose yaml at all' } });

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/services/i);
  });

  it('shows the service picker only when the compose file has more than one service', async () => {
    render(<DockerRunComposeConverter />);
    fireEvent.click(screen.getByRole('button', { name: /compose → docker run/i }));

    fireEvent.input(screen.getByLabelText(/compose yaml/i), {
      target: { value: 'services:\n  web:\n    image: nginx\n' },
    });
    await screen.findByText(/--name 'web'/);
    expect(screen.queryByLabelText(/compose service to convert/i)).not.toBeInTheDocument();

    fireEvent.input(screen.getByLabelText(/compose yaml/i), {
      target: { value: 'services:\n  web:\n    image: nginx\n  db:\n    image: postgres\n' },
    });

    const picker = await screen.findByLabelText(/compose service to convert/i);
    expect(within(picker).getByRole('option', { name: 'web' })).toBeInTheDocument();
    expect(within(picker).getByRole('option', { name: 'db' })).toBeInTheDocument();

    await screen.findByText(/postgres|nginx/);
  });

  it('converts the non-default service once picked', async () => {
    render(<DockerRunComposeConverter />);
    fireEvent.click(screen.getByRole('button', { name: /compose → docker run/i }));
    fireEvent.input(screen.getByLabelText(/compose yaml/i), {
      target: { value: 'services:\n  web:\n    image: nginx\n  db:\n    image: postgres\n' },
    });

    const picker = await screen.findByLabelText(/compose service to convert/i);
    fireEvent.change(picker, { target: { value: 'db' } });

    await waitFor(() => expect(output().getByText(/postgres/)).toBeInTheDocument());
  });

  it('shows a warning when a compose field cannot be represented in docker run', async () => {
    render(<DockerRunComposeConverter />);
    fireEvent.click(screen.getByRole('button', { name: /compose → docker run/i }));
    fireEvent.input(screen.getByLabelText(/compose yaml/i), {
      target: { value: 'services:\n  web:\n    image: nginx\n    depends_on:\n      - db\n' },
    });

    await screen.findByText(/--name 'web'/);
    expect(await screen.findByText(/depends_on/)).toBeInTheDocument();
  });

  it('toggles multi-line vs single-line docker run output', async () => {
    render(<DockerRunComposeConverter />);
    fireEvent.click(screen.getByRole('button', { name: /compose → docker run/i }));
    fireEvent.input(screen.getByLabelText(/compose yaml/i), {
      target: { value: 'services:\n  web:\n    image: nginx\n    ports:\n      - "80:80"\n' },
    });
    await screen.findByText(/80:80/);
    expect(output().getByText(/docker run \\/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^single line$/i }));
    await waitFor(() => expect(output().queryByText(/docker run \\/)).not.toBeInTheDocument());
  });

  it('swaps output into input and flips direction', async () => {
    render(<DockerRunComposeConverter />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    await screen.findByText(/image: nginx:alpine/);

    fireEvent.click(screen.getByRole('button', { name: /swap/i }));

    expect(screen.getByLabelText(/compose yaml/i)).toBeInTheDocument();
    expect((screen.getByLabelText(/compose yaml/i) as HTMLTextAreaElement).value).toContain('image: nginx:alpine');
  });

  it('clears the input and resets to the empty state', async () => {
    render(<DockerRunComposeConverter />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    await screen.findByText(/image: nginx:alpine/);

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    expect(runInput()).toHaveValue('');
    expect(document.querySelector('.output--empty')).toBeInTheDocument();
  });

  it('copies the generated output to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    render(<DockerRunComposeConverter />);
    fireEvent.click(screen.getByRole('button', { name: /load example/i }));
    await screen.findByText(/image: nginx:alpine/);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: /copied/i })).toBeInTheDocument());
  });

  it('lets the user override the derived compose service name', async () => {
    render(<DockerRunComposeConverter />);
    fireEvent.input(runInput(), { target: { value: 'docker run nginx:alpine' } });
    await screen.findByText(/image: nginx:alpine/);
    expect(document.querySelector('.output')!.textContent).toContain('\n  nginx:\n');

    fireEvent.input(screen.getByLabelText(/compose service name/i), { target: { value: 'my-custom-name' } });

    await waitFor(() => expect(document.querySelector('.output')!.textContent).toContain('\n  my-custom-name:\n'));
  });
});
