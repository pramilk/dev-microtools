import { describe, expect, it } from 'vitest';
import {
  tokenizeShellCommand,
  shellEscape,
  parseDockerRunCommand,
  dockerRunToCompose,
  deriveServiceName,
  sanitizeServiceName,
  parseComposeYaml,
  parseComposeService,
  composeServiceToDockerRun,
  type DockerRunSpec,
  type ComposeServiceSpec,
} from './dockerConvert';

// --------------------------------------------------------------------- shellEscape

describe('shellEscape', () => {
  it('wraps a plain value in single quotes', () => {
    expect(shellEscape('hello')).toBe("'hello'");
  });

  it('escapes an embedded single quote', () => {
    expect(shellEscape("it's here")).toBe("'it'\\''s here'");
  });

  it('handles an empty string', () => {
    expect(shellEscape('')).toBe("''");
  });
});

// --------------------------------------------------------------------- tokenizeShellCommand

describe('tokenizeShellCommand', () => {
  it('splits plain whitespace-separated tokens', () => {
    expect(tokenizeShellCommand('docker run nginx')).toEqual({ ok: true, value: ['docker', 'run', 'nginx'] });
  });

  it('collapses repeated whitespace between tokens', () => {
    expect(tokenizeShellCommand('docker   run\tnginx')).toEqual({ ok: true, value: ['docker', 'run', 'nginx'] });
  });

  it('keeps a single-quoted segment literal, including $ and backslashes', () => {
    const result = tokenizeShellCommand(`echo '$HOME \\ literal'`);
    expect(result).toEqual({ ok: true, value: ['echo', '$HOME \\ literal'] });
  });

  it('does not interpret escapes inside single quotes', () => {
    const result = tokenizeShellCommand(`echo 'a\\"b'`);
    expect(result).toEqual({ ok: true, value: ['echo', 'a\\"b'] });
  });

  it('processes \\" \\\\ and \\$ escapes inside double quotes', () => {
    const result = tokenizeShellCommand('echo "say \\"hi\\" and \\\\ and \\$HOME"');
    expect(result).toEqual({ ok: true, value: ['echo', 'say "hi" and \\ and $HOME'] });
  });

  it('leaves an unrecognized backslash escape inside double quotes untouched', () => {
    const result = tokenizeShellCommand('echo "a\\nb"');
    expect(result).toEqual({ ok: true, value: ['echo', 'a\\nb'] });
  });

  it('concatenates adjacent quoted and unquoted segments into one token', () => {
    const result = tokenizeShellCommand(`foo'bar'"baz"qux`);
    expect(result).toEqual({ ok: true, value: ['foobarbazqux'] });
  });

  it('produces an empty token from an empty quoted string', () => {
    expect(tokenizeShellCommand(`-e ""`)).toEqual({ ok: true, value: ['-e', ''] });
  });

  it('escapes the next character with a backslash outside quotes', () => {
    expect(tokenizeShellCommand(`a\\ b c`)).toEqual({ ok: true, value: ['a b', 'c'] });
  });

  it('joins a line-continued command across multiple lines', () => {
    const command = 'docker run \\\n  -d \\\n  --name web \\\n  nginx';
    expect(tokenizeShellCommand(command)).toEqual({ ok: true, value: ['docker', 'run', '-d', '--name', 'web', 'nginx'] });
  });

  it('joins a line-continued command that uses CRLF line endings', () => {
    const command = 'docker run \\\r\n  -d \\\r\n  nginx';
    expect(tokenizeShellCommand(command)).toEqual({ ok: true, value: ['docker', 'run', '-d', 'nginx'] });
  });

  it('rejects an unterminated single-quoted string', () => {
    const result = tokenizeShellCommand(`docker run -e KEY='unterminated`);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/single-quoted/);
  });

  it('rejects an unterminated double-quoted string', () => {
    const result = tokenizeShellCommand(`docker run -e KEY="unterminated`);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/double-quoted/);
  });

  it('returns an empty array for empty input', () => {
    expect(tokenizeShellCommand('')).toEqual({ ok: true, value: [] });
  });

  it('returns an empty array for whitespace-only input', () => {
    expect(tokenizeShellCommand('   \t  ')).toEqual({ ok: true, value: [] });
  });
});

// --------------------------------------------------------------------- parseDockerRunCommand

describe('parseDockerRunCommand', () => {
  it('rejects empty input', () => {
    const result = parseDockerRunCommand('');
    expect(result).toEqual({ ok: false, error: 'Enter a `docker run` command to convert.' });
  });

  it('rejects whitespace-only input', () => {
    expect(parseDockerRunCommand('   ').ok).toBe(false);
  });

  it('rejects a command that is not docker run', () => {
    const result = parseDockerRunCommand('docker ps -a');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/docker run/);
  });

  it('rejects an unrelated command entirely', () => {
    const result = parseDockerRunCommand('ls -la /tmp');
    expect(result.ok).toBe(false);
  });

  it('tolerates a bare "run ..." prefix', () => {
    const result = parseDockerRunCommand('run nginx:alpine');
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.image).toBe('nginx:alpine');
  });

  it('rejects a command that ends with only flags and no image', () => {
    const result = parseDockerRunCommand('docker run -d --name web');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/No image found/);
  });

  it('parses a bare image with no flags', () => {
    const result = parseDockerRunCommand('docker run redis');
    expect(result).toEqual({
      ok: true,
      value: {
        detach: false, name: null, publish: [], volumes: [], env: [], envFiles: [],
        network: null, restart: null, workdir: null, entrypoint: null, user: null,
        rm: false, tty: false, stdinOpen: false, labels: [], memory: null, cpus: null,
        image: 'redis', command: [], unsupportedFlags: [],
      },
    });
  });

  it('parses -d / --detach', () => {
    expect(parseDockerRunCommand('docker run -d redis').ok && (parseDockerRunCommand('docker run -d redis') as { ok: true; value: DockerRunSpec }).value.detach).toBe(true);
    const long = parseDockerRunCommand('docker run --detach redis');
    expect(long.ok && long.value.detach).toBe(true);
  });

  it('parses --name with a space and with =', () => {
    const spaced = parseDockerRunCommand('docker run --name web nginx');
    expect(spaced.ok && spaced.value.name).toBe('web');
    const equals = parseDockerRunCommand('docker run --name=web nginx');
    expect(equals.ok && equals.value.name).toBe('web');
  });

  it('parses -p and --publish, repeated, both forms', () => {
    const result = parseDockerRunCommand('docker run -p 8080:80 --publish=443:443/tcp -p 3000 nginx');
    expect(result.ok && result.value.publish).toEqual(['8080:80', '443:443/tcp', '3000']);
  });

  it('parses -v and --volume, repeated, both forms, including :ro', () => {
    const result = parseDockerRunCommand('docker run -v ./data:/app/data --volume=cache:/tmp/cache:ro nginx');
    expect(result.ok && result.value.volumes).toEqual(['./data:/app/data', 'cache:/tmp/cache:ro']);
  });

  it('parses -e and --env, repeated, and a bare KEY with no value', () => {
    const result = parseDockerRunCommand('docker run -e NODE_ENV=production --env=DEBUG=true -e BARE nginx');
    expect(result.ok && result.value.env).toEqual([
      { key: 'NODE_ENV', value: 'production' },
      { key: 'DEBUG', value: 'true' },
      { key: 'BARE', value: '' },
    ]);
  });

  it('splits an env value on the first = only, keeping the rest intact', () => {
    const result = parseDockerRunCommand('docker run -e KEY=a=b=c nginx');
    expect(result.ok && result.value.env).toEqual([{ key: 'KEY', value: 'a=b=c' }]);
  });

  it('parses --env-file, repeatable', () => {
    const result = parseDockerRunCommand('docker run --env-file .env --env-file .env.local nginx');
    expect(result.ok && result.value.envFiles).toEqual(['.env', '.env.local']);
  });

  it('parses --network', () => {
    const result = parseDockerRunCommand('docker run --network=my-net nginx');
    expect(result.ok && result.value.network).toBe('my-net');
  });

  it('parses --restart', () => {
    const result = parseDockerRunCommand('docker run --restart unless-stopped nginx');
    expect(result.ok && result.value.restart).toBe('unless-stopped');
  });

  it('parses -w and --workdir', () => {
    const short = parseDockerRunCommand('docker run -w /app nginx');
    expect(short.ok && short.value.workdir).toBe('/app');
    const long = parseDockerRunCommand('docker run --workdir=/app nginx');
    expect(long.ok && long.value.workdir).toBe('/app');
  });

  it('parses --entrypoint', () => {
    const result = parseDockerRunCommand('docker run --entrypoint /bin/sh nginx');
    expect(result.ok && result.value.entrypoint).toBe('/bin/sh');
  });

  it('parses -u and --user', () => {
    const short = parseDockerRunCommand('docker run -u 1000:1000 nginx');
    expect(short.ok && short.value.user).toBe('1000:1000');
    const long = parseDockerRunCommand('docker run --user=1000 nginx');
    expect(long.ok && long.value.user).toBe('1000');
  });

  it('parses --rm', () => {
    const result = parseDockerRunCommand('docker run --rm nginx');
    expect(result.ok && result.value.rm).toBe(true);
  });

  it('parses -it as both stdin_open and tty', () => {
    const result = parseDockerRunCommand('docker run -it ubuntu bash');
    expect(result.ok && result.value.stdinOpen).toBe(true);
    expect(result.ok && result.value.tty).toBe(true);
  });

  it('parses -i and -t separately', () => {
    const result = parseDockerRunCommand('docker run -i -t ubuntu');
    expect(result.ok && result.value.stdinOpen).toBe(true);
    expect(result.ok && result.value.tty).toBe(true);
  });

  it('parses --label, repeated, with and without a value', () => {
    const result = parseDockerRunCommand('docker run --label env=prod --label=team=infra --label bare nginx');
    expect(result.ok && result.value.labels).toEqual([
      { key: 'env', value: 'prod' },
      { key: 'team', value: 'infra' },
      { key: 'bare', value: '' },
    ]);
  });

  it('parses -m / --memory and --cpus', () => {
    const result = parseDockerRunCommand('docker run -m 512m --cpus=1.5 nginx');
    expect(result.ok && result.value.memory).toBe('512m');
    expect(result.ok && result.value.cpus).toBe('1.5');
  });

  it('captures a tag and a digest in the image reference verbatim', () => {
    const tagged = parseDockerRunCommand('docker run nginx:1.25-alpine');
    expect(tagged.ok && tagged.value.image).toBe('nginx:1.25-alpine');
    const digested = parseDockerRunCommand('docker run nginx@sha256:abcdef1234567890');
    expect(digested.ok && digested.value.image).toBe('nginx@sha256:abcdef1234567890');
  });

  it('captures everything after the image as the command override', () => {
    const result = parseDockerRunCommand('docker run ubuntu echo "hello world"');
    expect(result.ok && result.value.image).toBe('ubuntu');
    expect(result.ok && result.value.command).toEqual(['echo', 'hello world']);
  });

  it('collects an unrecognized boolean-shaped flag without eating the image', () => {
    const result = parseDockerRunCommand('docker run --privileged nginx');
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.image).toBe('nginx');
    expect(result.ok && result.value.unsupportedFlags).toEqual(['--privileged']);
  });

  it('collects a known-but-unmapped value flag together with its value', () => {
    const result = parseDockerRunCommand('docker run --platform linux/amd64 --hostname myhost nginx');
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.image).toBe('nginx');
    expect(result.ok && result.value.unsupportedFlags).toEqual(['--platform linux/amd64', '--hostname myhost']);
  });

  it('keeps the original token for an unmapped value flag given in --flag=value form', () => {
    const result = parseDockerRunCommand('docker run --platform=linux/amd64 nginx');
    expect(result.ok && result.value.unsupportedFlags).toEqual(['--platform=linux/amd64']);
  });

  it('parses a fully multi-line, backslash-continued command', () => {
    const command = [
      'docker run \\',
      '  -d \\',
      '  --name web \\',
      '  -p 8080:80 \\',
      '  -e NODE_ENV=production \\',
      '  -v ./data:/app/data \\',
      '  --restart unless-stopped \\',
      '  nginx:alpine',
    ].join('\n');
    const result = parseDockerRunCommand(command);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.detach).toBe(true);
    expect(result.value.name).toBe('web');
    expect(result.value.publish).toEqual(['8080:80']);
    expect(result.value.env).toEqual([{ key: 'NODE_ENV', value: 'production' }]);
    expect(result.value.volumes).toEqual(['./data:/app/data']);
    expect(result.value.restart).toBe('unless-stopped');
    expect(result.value.image).toBe('nginx:alpine');
  });

  it('parses a combined command exercising every recognized flag at once', () => {
    const command =
      'docker run -d --name web -p 8080:80 -v ./data:/app/data -e NODE_ENV=production ' +
      '--env-file .env --network my-net --restart unless-stopped -w /app --entrypoint /bin/sh ' +
      '-u 1000 --rm -it --label team=infra -m 512m --cpus 1.5 nginx:alpine echo hi';
    const result = parseDockerRunCommand(command);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      detach: true,
      name: 'web',
      publish: ['8080:80'],
      volumes: ['./data:/app/data'],
      env: [{ key: 'NODE_ENV', value: 'production' }],
      envFiles: ['.env'],
      network: 'my-net',
      restart: 'unless-stopped',
      workdir: '/app',
      entrypoint: '/bin/sh',
      user: '1000',
      rm: true,
      tty: true,
      stdinOpen: true,
      labels: [{ key: 'team', value: 'infra' }],
      memory: '512m',
      cpus: '1.5',
      image: 'nginx:alpine',
      command: ['echo', 'hi'],
      unsupportedFlags: [],
    });
  });

  it('rejects a flag missing its required value', () => {
    const result = parseDockerRunCommand('docker run --name');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/needs a value/);
  });
});

// --------------------------------------------------------------------- sanitizeServiceName / deriveServiceName

describe('sanitizeServiceName', () => {
  it('lowercases and keeps already-valid characters', () => {
    expect(sanitizeServiceName('Web-1.0_test')).toBe('web-1.0_test');
  });

  it('replaces invalid characters with a hyphen', () => {
    expect(sanitizeServiceName('my service!!')).toBe('my-service');
  });

  it('falls back to "app" for a name that sanitizes to nothing', () => {
    expect(sanitizeServiceName('###')).toBe('app');
  });
});

describe('deriveServiceName', () => {
  const base: DockerRunSpec = {
    detach: false, name: null, publish: [], volumes: [], env: [], envFiles: [],
    network: null, restart: null, workdir: null, entrypoint: null, user: null,
    rm: false, tty: false, stdinOpen: false, labels: [], memory: null, cpus: null,
    image: '', command: [], unsupportedFlags: [],
  };

  it('prefers the --name value when present', () => {
    expect(deriveServiceName({ ...base, name: 'MyWeb', image: 'nginx:alpine' })).toBe('myweb');
  });

  it('derives from the image base name, stripping registry path and tag', () => {
    expect(deriveServiceName({ ...base, image: 'nginx:alpine' })).toBe('nginx');
  });

  it('derives from the image base name, stripping a registry path', () => {
    expect(deriveServiceName({ ...base, image: 'ghcr.io/acme/my-app:1.0' })).toBe('my-app');
  });

  it('derives from the image base name, stripping a digest', () => {
    expect(deriveServiceName({ ...base, image: 'redis@sha256:abcdef' })).toBe('redis');
  });
});

// --------------------------------------------------------------------- dockerRunToCompose

describe('dockerRunToCompose', () => {
  it('produces the exact worked example from the sample docker run command', async () => {
    const parsed = parseDockerRunCommand(
      'docker run -d --name web -p 8080:80 -e NODE_ENV=production -v ./data:/app/data --restart unless-stopped nginx:alpine'
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const result = await dockerRunToCompose(parsed.value, { serviceName: 'web' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toBe(
      [
        'services:',
        '  web:',
        '    image: nginx:alpine',
        '    container_name: web',
        '    restart: unless-stopped',
        '    ports:',
        '      - 8080:80',
        '    volumes:',
        '      - ./data:/app/data',
        '    environment:',
        '      NODE_ENV: production',
        '',
      ].join('\n')
    );
  });

  it('omits keys for flags that were not present', async () => {
    const parsed = parseDockerRunCommand('docker run redis');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const result = await dockerRunToCompose(parsed.value, { serviceName: 'redis' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toMatch(/container_name|restart|ports|volumes|environment|env_file|working_dir|entrypoint|command|user|networks|labels|tty|stdin_open|mem_limit|cpus/);
    expect(result.value).not.toMatch(/^version:/m);
  });

  it('never emits a top-level version key', async () => {
    const parsed = parseDockerRunCommand('docker run -d --name web nginx');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = await dockerRunToCompose(parsed.value, { serviceName: 'web' });
    expect(result.ok && result.value).not.toMatch(/version:/);
  });

  it('emits tty and stdin_open for -it', async () => {
    const parsed = parseDockerRunCommand('docker run -it ubuntu bash');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = await dockerRunToCompose(parsed.value, { serviceName: 'ubuntu' });
    expect(result.ok && result.value).toContain('tty: true');
    expect(result.ok && result.value).toContain('stdin_open: true');
  });

  it('falls back to the derived service name when the option is blank', async () => {
    const parsed = parseDockerRunCommand('docker run nginx:alpine');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = await dockerRunToCompose(parsed.value, { serviceName: '' });
    expect(result.ok && result.value).toContain('nginx:');
  });

  it('sanitizes an edited service name', async () => {
    const parsed = parseDockerRunCommand('docker run nginx:alpine');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = await dockerRunToCompose(parsed.value, { serviceName: 'My Web!!' });
    expect(result.ok && result.value.startsWith('services:\n  my-web:')).toBe(true);
  });

  it('emits multiple env-files as a list, a single one as a plain string', async () => {
    const single = parseDockerRunCommand('docker run --env-file .env nginx');
    expect(single.ok).toBe(true);
    if (!single.ok) return;
    const singleResult = await dockerRunToCompose(single.value, { serviceName: 'nginx' });
    expect(singleResult.ok && singleResult.value).toContain('env_file: .env');

    const multiple = parseDockerRunCommand('docker run --env-file .env --env-file .env.local nginx');
    expect(multiple.ok).toBe(true);
    if (!multiple.ok) return;
    const multipleResult = await dockerRunToCompose(multiple.value, { serviceName: 'nginx' });
    expect(multipleResult.ok && multipleResult.value).toContain('env_file:\n      - .env\n      - .env.local');
  });
});

// --------------------------------------------------------------------- parseComposeYaml

describe('parseComposeYaml', () => {
  it('rejects empty input', async () => {
    const result = await parseComposeYaml('');
    expect(result.ok).toBe(false);
  });

  it('rejects malformed YAML', async () => {
    const result = await parseComposeYaml('services:\n  web:\n  bad indent here');
    expect(result.ok).toBe(false);
  });

  it('rejects YAML with no services key', async () => {
    const result = await parseComposeYaml('version: "3"\nnetworks:\n  default: {}\n');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/services/);
  });

  it('rejects a top-level YAML value that is not a mapping', async () => {
    const result = await parseComposeYaml('- a\n- b\n');
    expect(result.ok).toBe(false);
  });

  it('rejects an empty services mapping', async () => {
    const result = await parseComposeYaml('services: {}\n');
    expect(result.ok).toBe(false);
  });

  it('parses a single service', async () => {
    const result = await parseComposeYaml('services:\n  web:\n    image: nginx:alpine\n');
    expect(result.ok).toBe(true);
    expect(result.ok && Object.keys(result.value.services)).toEqual(['web']);
  });

  it('parses multiple services', async () => {
    const result = await parseComposeYaml('services:\n  web:\n    image: nginx\n  db:\n    image: postgres\n');
    expect(result.ok).toBe(true);
    expect(result.ok && Object.keys(result.value.services)).toEqual(['web', 'db']);
  });
});

// --------------------------------------------------------------------- parseComposeService

describe('parseComposeService', () => {
  it('rejects a non-mapping service entry', () => {
    expect(parseComposeService('nginx').ok).toBe(false);
    expect(parseComposeService(null).ok).toBe(false);
    expect(parseComposeService(['nginx']).ok).toBe(false);
  });

  it('requires an image field', () => {
    const result = parseComposeService({ ports: ['80:80'] });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/image/);
  });

  it('parses a representative service covering most fields', () => {
    const result = parseComposeService({
      image: 'nginx:alpine',
      container_name: 'web',
      restart: 'unless-stopped',
      ports: ['8080:80', 3000],
      volumes: ['./data:/app/data'],
      environment: { NODE_ENV: 'production' },
      env_file: '.env',
      working_dir: '/app',
      entrypoint: ['/bin/sh', '-c'],
      command: 'npm start',
      user: '1000',
      networks: ['my-net'],
      labels: ['team=infra'],
      tty: true,
      stdin_open: true,
      mem_limit: '512m',
      cpus: 1.5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      image: 'nginx:alpine',
      containerName: 'web',
      restart: 'unless-stopped',
      ports: ['8080:80', '3000'],
      volumes: ['./data:/app/data'],
      environment: [{ key: 'NODE_ENV', value: 'production' }],
      envFile: ['.env'],
      workingDir: '/app',
      entrypoint: ['/bin/sh', '-c'],
      command: 'npm start',
      user: '1000',
      networks: ['my-net'],
      labels: [{ key: 'team', value: 'infra' }],
      tty: true,
      stdinOpen: true,
      memLimit: '512m',
      cpus: '1.5',
      unsupportedNotes: [],
    });
  });

  it('accepts environment and labels as either a mapping or a list', () => {
    const asList = parseComposeService({ image: 'x', environment: ['A=1', 'B=2'], labels: ['x=y'] });
    expect(asList.ok && asList.value.environment).toEqual([{ key: 'A', value: '1' }, { key: 'B', value: '2' }]);
    const asMap = parseComposeService({ image: 'x', environment: { A: '1', B: 2 }, labels: { x: 'y' } });
    expect(asMap.ok && asMap.value.environment).toEqual([{ key: 'A', value: '1' }, { key: 'B', value: '2' }]);
  });

  it('rejects a malformed ports field', () => {
    const result = parseComposeService({ image: 'x', ports: 'not-a-list' });
    expect(result.ok).toBe(false);
  });

  it('notes long-syntax ports and volumes without failing the whole conversion', () => {
    const result = parseComposeService({
      image: 'x',
      ports: ['80:80', { target: 80, published: 8080 }],
      volumes: ['./a:/a', { type: 'volume', source: 'v', target: '/v' }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.ports).toEqual(['80:80']);
    expect(result.value.volumes).toEqual(['./a:/a']);
    expect(result.value.unsupportedNotes.some((n) => n.includes('ports'))).toBe(true);
    expect(result.value.unsupportedNotes.some((n) => n.includes('volumes'))).toBe(true);
  });

  it('collects unknown top-level fields as unsupported notes', () => {
    const result = parseComposeService({ image: 'x', build: '.', depends_on: ['db'], healthcheck: { test: ['CMD', 'true'] } });
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.unsupportedNotes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('build'),
        expect.stringContaining('depends_on'),
        expect.stringContaining('healthcheck'),
      ])
    );
  });

  it('notes when only the first of several networks can be represented', () => {
    const result = parseComposeService({ image: 'x', networks: ['a', 'b', 'c'] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.networks).toEqual(['a', 'b', 'c']);
    expect(result.value.unsupportedNotes.some((n) => n.includes('a') && n.includes('only'))).toBe(true);
  });

  it('reads network names from mapping-form networks and notes dropped per-network config', () => {
    const result = parseComposeService({ image: 'x', networks: { frontend: { aliases: ['web'] }, backend: null } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.networks).toEqual(['frontend', 'backend']);
    expect(result.value.unsupportedNotes.some((n) => n.includes('per-network configuration'))).toBe(true);
  });

  it('rejects a non-boolean tty or stdin_open', () => {
    expect(parseComposeService({ image: 'x', tty: 'yes' }).ok).toBe(false);
    expect(parseComposeService({ image: 'x', stdin_open: 1 }).ok).toBe(false);
  });

  it('accepts a numeric mem_limit and cpus', () => {
    const result = parseComposeService({ image: 'x', mem_limit: 536870912, cpus: 2 });
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.memLimit).toBe('536870912');
    expect(result.ok && result.value.cpus).toBe('2');
  });
});

// --------------------------------------------------------------------- composeServiceToDockerRun

const emptyService: ComposeServiceSpec = {
  image: 'nginx',
  containerName: null,
  restart: null,
  ports: [],
  volumes: [],
  environment: [],
  envFile: [],
  workingDir: null,
  entrypoint: null,
  command: null,
  user: null,
  networks: [],
  labels: [],
  tty: false,
  stdinOpen: false,
  memLimit: null,
  cpus: null,
  unsupportedNotes: [],
};

describe('composeServiceToDockerRun', () => {
  it('rejects a service with no image', () => {
    const result = composeServiceToDockerRun('web', { ...emptyService, image: '' }, { multiline: false });
    expect(result.ok).toBe(false);
  });

  it('builds a minimal single-line command for a bare service', () => {
    const result = composeServiceToDockerRun('web', emptyService, { multiline: false });
    expect(result).toEqual({ ok: true, value: "docker run --name 'web' 'nginx'" });
  });

  it('uses container_name over the service name when both are present', () => {
    const result = composeServiceToDockerRun('web', { ...emptyService, containerName: 'my-container' }, { multiline: false });
    expect(result.ok && result.value).toContain("--name 'my-container'");
  });

  it('builds a representative multiline command covering most fields', () => {
    const service: ComposeServiceSpec = {
      ...emptyService,
      image: 'nginx:alpine',
      containerName: 'web',
      restart: 'unless-stopped',
      ports: ['8080:80'],
      volumes: ['./data:/app/data'],
      environment: [{ key: 'NODE_ENV', value: 'production' }],
      envFile: ['.env'],
      workingDir: '/app',
      user: '1000',
      networks: ['my-net'],
      labels: [{ key: 'team', value: 'infra' }],
      tty: true,
      stdinOpen: true,
      memLimit: '512m',
      cpus: '1.5',
      command: ['npm', 'start'],
    };
    const result = composeServiceToDockerRun('web', service, { multiline: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(
      [
        'docker run \\',
        '  -it \\',
        "  --name 'web' \\",
        "  -p '8080:80' \\",
        "  -v './data:/app/data' \\",
        "  -e 'NODE_ENV=production' \\",
        "  --env-file '.env' \\",
        "  --network 'my-net' \\",
        "  --restart 'unless-stopped' \\",
        "  -w '/app' \\",
        "  -u '1000' \\",
        "  --label 'team=infra' \\",
        "  -m '512m' \\",
        "  --cpus '1.5' \\",
        "  'nginx:alpine' \\",
        "  'npm' \\",
        "  'start'",
      ].join('\n')
    );
  });

  it('joins with spaces instead of backslash-newline when multiline is false', () => {
    const result = composeServiceToDockerRun('web', { ...emptyService, ports: ['80:80'] }, { multiline: false });
    expect(result.ok && result.value).not.toContain('\\\n');
    expect(result.ok && result.value).toBe("docker run --name 'web' -p '80:80' 'nginx'");
  });

  it('tokenizes a shorthand string command the same as an array command', () => {
    const asString = composeServiceToDockerRun('web', { ...emptyService, command: 'npm run start' }, { multiline: false });
    const asArray = composeServiceToDockerRun('web', { ...emptyService, command: ['npm', 'run', 'start'] }, { multiline: false });
    expect(asString).toEqual(asArray);
  });

  it('propagates a tokenizer error from a malformed shorthand command string', () => {
    const result = composeServiceToDockerRun('web', { ...emptyService, command: `sh -c 'unterminated` }, { multiline: false });
    expect(result.ok).toBe(false);
  });

  it('splits a multi-item entrypoint array into --entrypoint plus leading command args', () => {
    const result = composeServiceToDockerRun(
      'web',
      { ...emptyService, entrypoint: ['/bin/sh', '-c', 'echo hi'], command: ['extra'] },
      { multiline: false }
    );
    expect(result.ok && result.value).toBe("docker run --name 'web' --entrypoint '/bin/sh' 'nginx' '-c' 'echo hi' 'extra'");
  });

  it('shell-escapes values containing single quotes', () => {
    const result = composeServiceToDockerRun('web', { ...emptyService, labels: [{ key: 'note', value: "it's fine" }] }, { multiline: false });
    expect(result.ok && result.value).toContain("--label 'note=it'\\''s fine'");
  });

  it('emits only one --network flag when the service has several', () => {
    const result = composeServiceToDockerRun('web', { ...emptyService, networks: ['a', 'b'] }, { multiline: false });
    expect(result.ok && result.value).toContain("--network 'a'");
    expect(result.ok && result.value).not.toContain("'b'");
  });
});

// --------------------------------------------------------------------- round trip

describe('round trip: docker run -> compose -> docker run', () => {
  it('preserves every mapped field through a full round trip', async () => {
    const original =
      'docker run -d --name web -p 8080:80 -v ./data:/app/data -e NODE_ENV=production ' +
      '--env-file .env --network my-net --restart unless-stopped -w /app -u 1000 -it ' +
      '--label team=infra -m 512m --cpus 1.5 nginx:alpine';

    const parsed = parseDockerRunCommand(original);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const composeResult = await dockerRunToCompose(parsed.value, { serviceName: 'web' });
    expect(composeResult.ok).toBe(true);
    if (!composeResult.ok) return;

    const reparsedCompose = await parseComposeYaml(composeResult.value);
    expect(reparsedCompose.ok).toBe(true);
    if (!reparsedCompose.ok) return;

    const serviceSpecResult = parseComposeService(reparsedCompose.value.services.web);
    expect(serviceSpecResult.ok).toBe(true);
    if (!serviceSpecResult.ok) return;

    const backToRun = composeServiceToDockerRun('web', serviceSpecResult.value, { multiline: false });
    expect(backToRun.ok).toBe(true);
    if (!backToRun.ok) return;

    const reparsedRun = parseDockerRunCommand(backToRun.value);
    expect(reparsedRun.ok).toBe(true);
    if (!reparsedRun.ok) return;

    // -d and --rm have no compose service field by design, so they don't round-trip —
    // everything else mappable should come back unchanged.
    expect(reparsedRun.value.name).toBe('web');
    expect(reparsedRun.value.publish).toEqual(['8080:80']);
    expect(reparsedRun.value.volumes).toEqual(['./data:/app/data']);
    expect(reparsedRun.value.env).toEqual([{ key: 'NODE_ENV', value: 'production' }]);
    expect(reparsedRun.value.envFiles).toEqual(['.env']);
    expect(reparsedRun.value.network).toBe('my-net');
    expect(reparsedRun.value.restart).toBe('unless-stopped');
    expect(reparsedRun.value.workdir).toBe('/app');
    expect(reparsedRun.value.user).toBe('1000');
    expect(reparsedRun.value.tty).toBe(true);
    expect(reparsedRun.value.stdinOpen).toBe(true);
    expect(reparsedRun.value.labels).toEqual([{ key: 'team', value: 'infra' }]);
    expect(reparsedRun.value.memory).toBe('512m');
    expect(reparsedRun.value.cpus).toBe('1.5');
    expect(reparsedRun.value.image).toBe('nginx:alpine');
  });
});
