/**
 * Foreground preview server for the end-to-end suite.
 *
 * Playwright's `webServer` needs a process that stays in the foreground for as long as
 * the server is up. `astro preview` cannot promise that: it daemonises itself when it
 * detects it is being run by an AI coding agent, and it refuses to start at all while a
 * lock file from an earlier background server exists — either of which makes the suite
 * fail with "Process from config.webServer exited early" rather than run.
 *
 * Astro's programmatic `preview()` is the same server without the CLI's process
 * management, so this script is the stable thing to point Playwright at.
 */
import { preview } from 'astro';

const port = Number(process.env.PREVIEW_PORT ?? 4331);

const server = await preview({ server: { port } });

/*
 * Astro silently falls back to the next free port when the requested one is taken.
 * Playwright is pointed at a fixed URL, so that fallback would leave it either hanging
 * or — worse — testing whatever unrelated server already owns the port.
 */
if (server.port !== port) {
  await server.stop();
  console.error(
    `Port ${port} is already in use (the preview server was moved to ${server.port}).
` +
      'Stop whatever is holding it and re-run, or set PREVIEW_PORT to a free port.'
  );
  process.exit(1);
}

const shutdown = async () => {
  await server.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
