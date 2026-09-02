import { type ToolResult, ok, err, messageFrom } from './result';

// --------------------------------------------------------------------- shell tokenizer

/**
 * Wraps a value in single quotes for a POSIX shell, escaping any embedded single quote
 * by closing the quote, emitting an escaped literal quote, then reopening it — the same
 * technique `curlCommand.ts`'s `shellEscape` uses. Kept as a small local copy rather than
 * a shared import: each tool's string-building logic stays self-contained (see this
 * codebase's per-file duplication convention for small helpers like this one).
 */
export function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Tokenizes a command line the way a POSIX shell would: single-quoted segments are
 * literal, double-quoted segments support `\"`, `\\`, `` \` `` and `\$` escapes, unquoted
 * text supports a backslash escaping the next character, and a trailing `\` at the end of
 * a line is a line continuation (swallowed, so the next line's tokens flow straight into
 * this one) — the formatting `docker run \`, one flag per line, commonly appears in.
 * Adjacent quoted/unquoted segments with no whitespace between them concatenate into a
 * single token, matching real shell word-splitting (`foo'bar'baz` -> `foobarbaz`).
 */
export function tokenizeShellCommand(input: string): ToolResult<string[]> {
  const tokens: string[] = [];
  let current = '';
  let tokenStarted = false;
  let inSingle = false;
  let inDouble = false;
  let i = 0;

  const pushToken = () => {
    if (tokenStarted) tokens.push(current);
    current = '';
    tokenStarted = false;
  };

  while (i < input.length) {
    const ch = input[i]!;

    // Line continuation: a backslash immediately followed by a newline (optionally
    // preceded by \r) is removed entirely, joining this line to the next.
    if (!inSingle && !inDouble && ch === '\\') {
      if (input[i + 1] === '\n') {
        i += 2;
        continue;
      }
      if (input[i + 1] === '\r' && input[i + 2] === '\n') {
        i += 3;
        continue;
      }
    }

    if (inDouble) {
      if (ch === '\\' && (input[i + 1] === '"' || input[i + 1] === '\\' || input[i + 1] === '$' || input[i + 1] === '`')) {
        current += input[i + 1];
        tokenStarted = true;
        i += 2;
        continue;
      }
      if (ch === '"') {
        inDouble = false;
        i += 1;
        continue;
      }
      current += ch;
      tokenStarted = true;
      i += 1;
      continue;
    }

    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
        i += 1;
        continue;
      }
      current += ch;
      tokenStarted = true;
      i += 1;
      continue;
    }

    // Unquoted context.
    if (ch === "'") {
      inSingle = true;
      tokenStarted = true;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      tokenStarted = true;
      i += 1;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      pushToken();
      i += 1;
      continue;
    }
    if (ch === '\\' && i + 1 < input.length) {
      current += input[i + 1];
      tokenStarted = true;
      i += 2;
      continue;
    }
    current += ch;
    tokenStarted = true;
    i += 1;
  }

  if (inSingle) return err("Unterminated single-quoted string — a closing ' is missing.");
  if (inDouble) return err('Unterminated double-quoted string — a closing " is missing.');

  pushToken();
  return ok(tokens);
}

// --------------------------------------------------------------------- docker run -> compose

export interface DockerRunSpec {
  detach: boolean;
  name: string | null;
  publish: string[];
  volumes: string[];
  env: { key: string; value: string }[];
  envFiles: string[];
  network: string | null;
  restart: string | null;
  workdir: string | null;
  entrypoint: string | null;
  user: string | null;
  rm: boolean;
  tty: boolean;
  stdinOpen: boolean;
  labels: { key: string; value: string }[];
  memory: string | null;
  cpus: string | null;
  image: string;
  /** Tokens after the image — the container's command override. */
  command: string[];
  /** Raw flag text (and, for a handful of well-known but unmapped docker run flags,
   *  its value) for anything this tool doesn't recognize or can't represent in compose —
   *  shown as a visible warning rather than silently dropped. */
  unsupportedFlags: string[];
}

/**
 * A handful of additional real `docker run` flags this tool doesn't translate into any
 * compose field, but still knows *take a value* — tracked only so that value isn't
 * mistaken for the image or the command override when such a flag appears. The flag
 * itself is still recorded in `unsupportedFlags`, so nothing about it silently vanishes.
 */
const UNMAPPED_VALUE_FLAGS = new Set([
  '--add-host', '--cap-add', '--cap-drop', '--cgroup-parent', '--cidfile', '--device',
  '--dns', '--dns-option', '--dns-search', '--domainname', '--expose', '--gpus',
  '--group-add', '--health-cmd', '--health-interval', '--health-retries',
  '--health-start-period', '--health-timeout', '-h', '--hostname', '--ip', '--ip6',
  '--ipc', '--isolation', '--kernel-memory', '--link', '--log-driver', '--log-opt',
  '--mac-address', '--memory-reservation', '--memory-swap', '--memory-swappiness',
  '--mount', '--net', '--oom-score-adj', '--pid', '--platform', '--pull', '--runtime',
  '--security-opt', '--shm-size', '--stop-signal', '--stop-timeout', '--sysctl',
  '--tmpfs', '--ulimit', '--uts', '--volumes-from', '--volume-driver',
]);

/**
 * Parses a `docker run ...` command into a structured spec. Tokenizes like a shell first
 * (see `tokenizeShellCommand`), then walks the tokens recognizing a fixed set of common
 * flags; anything else is collected into `unsupportedFlags` instead of disappearing.
 */
export function parseDockerRunCommand(command: string): ToolResult<DockerRunSpec> {
  const trimmed = command.trim();
  if (trimmed === '') return err('Enter a `docker run` command to convert.');

  const tokenResult = tokenizeShellCommand(trimmed);
  if (!tokenResult.ok) return tokenResult;
  let tokens = tokenResult.value;

  if (tokens.length >= 2 && tokens[0] === 'docker' && tokens[1] === 'run') {
    tokens = tokens.slice(2);
  } else if (tokens.length >= 1 && tokens[0] === 'run') {
    tokens = tokens.slice(1);
  } else {
    return err('This doesn\'t look like a `docker run` command — it needs to start with "docker run" (or just "run").');
  }

  const spec: DockerRunSpec = {
    detach: false,
    name: null,
    publish: [],
    volumes: [],
    env: [],
    envFiles: [],
    network: null,
    restart: null,
    workdir: null,
    entrypoint: null,
    user: null,
    rm: false,
    tty: false,
    stdinOpen: false,
    labels: [],
    memory: null,
    cpus: null,
    image: '',
    command: [],
    unsupportedFlags: [],
  };

  let i = 0;
  let imageFound = false;

  const takeValue = (flag: string, inlineValue: string | null): ToolResult<string> => {
    if (inlineValue !== null) return ok(inlineValue);
    i += 1;
    const value = tokens[i];
    if (value === undefined) return err(`Flag ${flag} needs a value but none was given.`);
    return ok(value);
  };

  while (i < tokens.length) {
    const token = tokens[i]!;

    if (imageFound) {
      spec.command.push(token);
      i += 1;
      continue;
    }

    if (!token.startsWith('-')) {
      spec.image = token;
      imageFound = true;
      i += 1;
      continue;
    }

    let flag = token;
    let inlineValue: string | null = null;
    if (flag.startsWith('--') && flag.includes('=')) {
      const eqIndex = flag.indexOf('=');
      inlineValue = flag.slice(eqIndex + 1);
      flag = flag.slice(0, eqIndex);
    }

    switch (flag) {
      case '-d':
      case '--detach':
        spec.detach = true;
        i += 1;
        break;
      case '--rm':
        spec.rm = true;
        i += 1;
        break;
      case '-i':
      case '--interactive':
        spec.stdinOpen = true;
        i += 1;
        break;
      case '-t':
      case '--tty':
        spec.tty = true;
        i += 1;
        break;
      case '-it':
      case '-ti':
        spec.stdinOpen = true;
        spec.tty = true;
        i += 1;
        break;
      case '--name': {
        const v = takeValue(flag, inlineValue);
        if (!v.ok) return v;
        spec.name = v.value;
        i += 1;
        break;
      }
      case '-p':
      case '--publish': {
        const v = takeValue(flag, inlineValue);
        if (!v.ok) return v;
        spec.publish.push(v.value);
        i += 1;
        break;
      }
      case '-v':
      case '--volume': {
        const v = takeValue(flag, inlineValue);
        if (!v.ok) return v;
        spec.volumes.push(v.value);
        i += 1;
        break;
      }
      case '-e':
      case '--env': {
        const v = takeValue(flag, inlineValue);
        if (!v.ok) return v;
        const eqIndex = v.value.indexOf('=');
        // A bare `-e KEY` with no "=" is valid docker syntax (pass the host's value
        // through at run time) — kept as an empty value rather than rejected.
        spec.env.push(
          eqIndex === -1
            ? { key: v.value, value: '' }
            : { key: v.value.slice(0, eqIndex), value: v.value.slice(eqIndex + 1) }
        );
        i += 1;
        break;
      }
      case '--env-file': {
        const v = takeValue(flag, inlineValue);
        if (!v.ok) return v;
        spec.envFiles.push(v.value);
        i += 1;
        break;
      }
      case '--network': {
        const v = takeValue(flag, inlineValue);
        if (!v.ok) return v;
        spec.network = v.value;
        i += 1;
        break;
      }
      case '--restart': {
        const v = takeValue(flag, inlineValue);
        if (!v.ok) return v;
        spec.restart = v.value;
        i += 1;
        break;
      }
      case '-w':
      case '--workdir': {
        const v = takeValue(flag, inlineValue);
        if (!v.ok) return v;
        spec.workdir = v.value;
        i += 1;
        break;
      }
      case '--entrypoint': {
        const v = takeValue(flag, inlineValue);
        if (!v.ok) return v;
        spec.entrypoint = v.value;
        i += 1;
        break;
      }
      case '-u':
      case '--user': {
        const v = takeValue(flag, inlineValue);
        if (!v.ok) return v;
        spec.user = v.value;
        i += 1;
        break;
      }
      case '--label': {
        const v = takeValue(flag, inlineValue);
        if (!v.ok) return v;
        const eqIndex = v.value.indexOf('=');
        spec.labels.push(
          eqIndex === -1
            ? { key: v.value, value: '' }
            : { key: v.value.slice(0, eqIndex), value: v.value.slice(eqIndex + 1) }
        );
        i += 1;
        break;
      }
      case '-m':
      case '--memory': {
        const v = takeValue(flag, inlineValue);
        if (!v.ok) return v;
        spec.memory = v.value;
        i += 1;
        break;
      }
      case '--cpus': {
        const v = takeValue(flag, inlineValue);
        if (!v.ok) return v;
        spec.cpus = v.value;
        i += 1;
        break;
      }
      default: {
        if (UNMAPPED_VALUE_FLAGS.has(flag)) {
          const v = takeValue(flag, inlineValue);
          if (!v.ok) return v;
          spec.unsupportedFlags.push(inlineValue !== null ? token : `${flag} ${v.value}`);
        } else {
          // Unknown, or a known boolean flag with no compose equivalent (--privileged,
          // --read-only, -P, etc.) — no value to consume either way.
          spec.unsupportedFlags.push(token);
        }
        i += 1;
        break;
      }
    }
  }

  if (!imageFound || spec.image === '') {
    return err('No image found — a `docker run` command needs an image after the flags, e.g. `docker run nginx:alpine`.');
  }

  return ok(spec);
}

/** Lowercases and strips anything outside compose's allowed service-name characters. */
export function sanitizeServiceName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '');
  return cleaned === '' ? 'app' : cleaned;
}

/** Derives a sensible default compose service name: the `--name` value if given, else the
 *  image's base name (registry/path and tag/digest stripped), sanitized either way. */
export function deriveServiceName(spec: DockerRunSpec): string {
  if (spec.name) return sanitizeServiceName(spec.name);
  const lastSegment = spec.image.split('/').pop() ?? spec.image;
  const withoutDigest = lastSegment.split('@')[0] ?? lastSegment;
  const withoutTag = withoutDigest.split(':')[0] ?? withoutDigest;
  return sanitizeServiceName(withoutTag);
}

let yamlModule: typeof import('js-yaml') | null = null;
async function loadYaml(): Promise<typeof import('js-yaml')> {
  yamlModule ??= await import('js-yaml');
  return yamlModule;
}

export interface DockerRunToComposeOptions {
  serviceName: string;
}

/**
 * Builds a `docker-compose.yml` document for a single service from a parsed spec. No
 * top-level `version:` key is emitted — that field is deprecated and ignored by modern
 * Compose, so its absence is correct. `-d`/`--detach` and `--rm` are recognized flags with
 * no compose *service* field: detached mode is a property of running `docker compose up
 * -d`, not of the service definition, and compose services have no "remove myself after
 * stopping" concept at all — see the FAQ on the tool's content page.
 */
export async function dockerRunToCompose(spec: DockerRunSpec, options: DockerRunToComposeOptions): Promise<ToolResult<string>> {
  const serviceName = sanitizeServiceName(options.serviceName.trim() !== '' ? options.serviceName : deriveServiceName(spec));

  const service: Record<string, unknown> = {};
  service.image = spec.image;
  if (spec.name) service.container_name = spec.name;
  if (spec.restart) service.restart = spec.restart;
  if (spec.publish.length > 0) service.ports = [...spec.publish];
  if (spec.volumes.length > 0) service.volumes = [...spec.volumes];
  if (spec.env.length > 0) {
    const environment: Record<string, string> = {};
    for (const { key, value } of spec.env) environment[key] = value;
    service.environment = environment;
  }
  if (spec.envFiles.length > 0) {
    service.env_file = spec.envFiles.length === 1 ? spec.envFiles[0] : [...spec.envFiles];
  }
  if (spec.workdir) service.working_dir = spec.workdir;
  if (spec.entrypoint) service.entrypoint = spec.entrypoint;
  if (spec.command.length > 0) service.command = [...spec.command];
  if (spec.user) service.user = spec.user;
  if (spec.network) service.networks = [spec.network];
  if (spec.labels.length > 0) {
    const labels: Record<string, string> = {};
    for (const { key, value } of spec.labels) labels[key] = value;
    service.labels = labels;
  }
  if (spec.tty) service.tty = true;
  if (spec.stdinOpen) service.stdin_open = true;
  if (spec.memory) service.mem_limit = spec.memory;
  if (spec.cpus) {
    const asNumber = Number(spec.cpus);
    service.cpus = Number.isNaN(asNumber) ? spec.cpus : asNumber;
  }

  try {
    const yaml = await loadYaml();
    return ok(yaml.dump({ services: { [serviceName]: service } }));
  } catch (error) {
    return err(messageFrom(error, 'Could not serialise the compose YAML.'));
  }
}

// --------------------------------------------------------------------- compose -> docker run

/** Parses compose YAML text and returns its top-level `services:` mapping, unvalidated
 *  beyond confirming it exists and is non-empty — each service is validated separately
 *  by `parseComposeService`. */
export async function parseComposeYaml(yamlText: string): Promise<ToolResult<{ services: Record<string, unknown> }>> {
  const trimmed = yamlText.trim();
  if (trimmed === '') return err('Enter some compose YAML to convert.');

  let parsed: unknown;
  try {
    const yaml = await loadYaml();
    parsed = yaml.load(yamlText);
  } catch (error) {
    return err(messageFrom(error, 'Could not parse as YAML.'));
  }

  if (!isRecord(parsed)) {
    return err('This doesn\'t look like a compose file — expected a YAML mapping with a `services:` key at the top level.');
  }
  const services = parsed.services;
  if (!isRecord(services) || Object.keys(services).length === 0) {
    return err('No `services:` key found — this doesn\'t look like a compose file.');
  }

  return ok({ services });
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');

/** Accepts compose's two equivalent shapes for `environment:`/`labels:` — a mapping
 *  (`KEY: value`) or a list of `"KEY=value"` strings (`KEY` alone means an empty value,
 *  compose's own shorthand for "pass this through unset"). */
function parseKeyValueField(raw: unknown, fieldName: string): ToolResult<{ key: string; value: string }[]> {
  if (raw === undefined || raw === null) return ok([]);

  if (Array.isArray(raw)) {
    const entries: { key: string; value: string }[] = [];
    for (const item of raw) {
      if (typeof item !== 'string') return err(`${fieldName}: list entries must be strings like "KEY=value".`);
      const eqIndex = item.indexOf('=');
      entries.push(eqIndex === -1 ? { key: item, value: '' } : { key: item.slice(0, eqIndex), value: item.slice(eqIndex + 1) });
    }
    return ok(entries);
  }

  if (isRecord(raw)) {
    const entries: { key: string; value: string }[] = [];
    for (const [key, value] of Object.entries(raw)) {
      if (value === null || value === undefined) {
        entries.push({ key, value: '' });
      } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        entries.push({ key, value: String(value) });
      } else {
        return err(`${fieldName}.${key}: expected a plain value, not a nested object or array.`);
      }
    }
    return ok(entries);
  }

  return err(`${fieldName} must be a mapping or a list of "KEY=value" strings.`);
}

export interface ComposeServiceSpec {
  image: string;
  containerName: string | null;
  restart: string | null;
  ports: string[];
  volumes: string[];
  environment: { key: string; value: string }[];
  envFile: string[];
  workingDir: string | null;
  entrypoint: string | string[] | null;
  command: string | string[] | null;
  user: string | null;
  networks: string[];
  labels: { key: string; value: string }[];
  tty: boolean;
  stdinOpen: boolean;
  memLimit: string | null;
  cpus: string | null;
  /** Fields (or field entries) present in the compose service that have no `docker run`
   *  equivalent this tool represents, worded for direct display as a warning. */
  unsupportedNotes: string[];
}

const KNOWN_SERVICE_FIELDS = new Set([
  'image', 'container_name', 'restart', 'ports', 'volumes', 'environment', 'env_file',
  'working_dir', 'entrypoint', 'command', 'user', 'networks', 'labels', 'tty', 'stdin_open',
  'mem_limit', 'cpus',
]);

/** Validates and extracts the fields this tool understands from one compose service
 *  entry (already parsed YAML — an object of arbitrary shape). Field-shaped problems
 *  (e.g. `ports` isn't a list) are hard errors; fields/entries with no `docker run`
 *  equivalent are collected into `unsupportedNotes` rather than silently dropped. */
export function parseComposeService(raw: unknown): ToolResult<ComposeServiceSpec> {
  if (!isRecord(raw)) return err('This service entry isn\'t a mapping of settings.');

  const notes: string[] = [];

  if (raw.image !== undefined && typeof raw.image !== 'string') return err('image must be a string.');
  const image = typeof raw.image === 'string' ? raw.image : '';
  if (image === '') {
    return err('This service has no `image:` field, so there\'s nothing to build a docker run command from.');
  }

  if (raw.container_name !== undefined && typeof raw.container_name !== 'string') return err('container_name must be a string.');
  const containerName = typeof raw.container_name === 'string' ? raw.container_name : null;

  if (raw.restart !== undefined && typeof raw.restart !== 'string') return err('restart must be a string.');
  const restart = typeof raw.restart === 'string' ? raw.restart : null;

  const ports: string[] = [];
  if (raw.ports !== undefined && raw.ports !== null) {
    if (!Array.isArray(raw.ports)) return err('ports must be a list.');
    let sawLongSyntax = false;
    for (const entry of raw.ports) {
      if (typeof entry === 'string') ports.push(entry);
      else if (typeof entry === 'number') ports.push(String(entry));
      else sawLongSyntax = true;
    }
    if (sawLongSyntax) notes.push('one or more `ports` entries used the object ("long syntax") form, which isn\'t supported — only short "host:container" strings were carried over');
  }

  const volumes: string[] = [];
  if (raw.volumes !== undefined && raw.volumes !== null) {
    if (!Array.isArray(raw.volumes)) return err('volumes must be a list.');
    let sawLongSyntax = false;
    for (const entry of raw.volumes) {
      if (typeof entry === 'string') volumes.push(entry);
      else sawLongSyntax = true;
    }
    if (sawLongSyntax) notes.push('one or more `volumes` entries used the object ("long syntax") form, which isn\'t supported — only short "host:container" strings were carried over');
  }

  const environmentResult = parseKeyValueField(raw.environment, 'environment');
  if (!environmentResult.ok) return environmentResult;

  const envFile: string[] = [];
  if (raw.env_file !== undefined && raw.env_file !== null) {
    if (typeof raw.env_file === 'string') envFile.push(raw.env_file);
    else if (isStringArray(raw.env_file)) envFile.push(...raw.env_file);
    else return err('env_file must be a string or a list of strings.');
  }

  if (raw.working_dir !== undefined && typeof raw.working_dir !== 'string') return err('working_dir must be a string.');
  const workingDir = typeof raw.working_dir === 'string' ? raw.working_dir : null;

  let entrypoint: string | string[] | null = null;
  if (raw.entrypoint !== undefined && raw.entrypoint !== null) {
    if (typeof raw.entrypoint === 'string') entrypoint = raw.entrypoint;
    else if (isStringArray(raw.entrypoint)) entrypoint = raw.entrypoint;
    else return err('entrypoint must be a string or a list of strings.');
  }

  let command: string | string[] | null = null;
  if (raw.command !== undefined && raw.command !== null) {
    if (typeof raw.command === 'string') command = raw.command;
    else if (isStringArray(raw.command)) command = raw.command;
    else return err('command must be a string or a list of strings.');
  }

  if (raw.user !== undefined && typeof raw.user !== 'string') return err('user must be a string.');
  const user = typeof raw.user === 'string' ? raw.user : null;

  const networks: string[] = [];
  if (raw.networks !== undefined && raw.networks !== null) {
    if (isStringArray(raw.networks)) {
      networks.push(...raw.networks);
    } else if (isRecord(raw.networks)) {
      networks.push(...Object.keys(raw.networks));
      const hasConfig = Object.values(raw.networks).some((value) => isRecord(value) && Object.keys(value).length > 0);
      if (hasConfig) notes.push('per-network configuration (aliases, static IPs, etc.) has no `docker run` equivalent and was dropped');
    } else {
      return err('networks must be a list of names or a mapping of network name to config.');
    }
    if (networks.length > 1) {
      notes.push(`\`docker run\` only accepts one --network, so only "${networks[0]}" was used — ${networks.slice(1).join(', ')} ${networks.length === 2 ? 'was' : 'were'} dropped`);
    }
  }

  const labelsResult = parseKeyValueField(raw.labels, 'labels');
  if (!labelsResult.ok) return labelsResult;

  if (raw.tty !== undefined && typeof raw.tty !== 'boolean') return err('tty must be true or false.');
  const tty = raw.tty === true;

  if (raw.stdin_open !== undefined && typeof raw.stdin_open !== 'boolean') return err('stdin_open must be true or false.');
  const stdinOpen = raw.stdin_open === true;

  if (raw.mem_limit !== undefined && raw.mem_limit !== null && typeof raw.mem_limit !== 'string' && typeof raw.mem_limit !== 'number') {
    return err('mem_limit must be a string or number.');
  }
  const memLimit = raw.mem_limit === undefined || raw.mem_limit === null ? null : String(raw.mem_limit);

  if (raw.cpus !== undefined && raw.cpus !== null && typeof raw.cpus !== 'string' && typeof raw.cpus !== 'number') {
    return err('cpus must be a string or number.');
  }
  const cpus = raw.cpus === undefined || raw.cpus === null ? null : String(raw.cpus);

  for (const key of Object.keys(raw)) {
    if (!KNOWN_SERVICE_FIELDS.has(key)) notes.push(`\`${key}\` has no \`docker run\` equivalent and was dropped`);
  }

  return ok({
    image,
    containerName,
    restart,
    ports,
    volumes,
    environment: environmentResult.value,
    envFile,
    workingDir,
    entrypoint,
    command,
    user,
    networks,
    labels: labelsResult.value,
    tty,
    stdinOpen,
    memLimit,
    cpus,
    unsupportedNotes: notes,
  });
}

export interface ComposeServiceToDockerRunOptions {
  multiline: boolean;
}

/**
 * Builds a copy-pasteable `docker run` command from an already-validated compose service
 * spec, shell-escaping every value. A multi-item `entrypoint` array is split the way
 * docker itself would run it: the first item becomes `--entrypoint` (which only ever
 * takes a single executable), and any remaining items are prepended to the command args.
 */
export function composeServiceToDockerRun(
  serviceName: string,
  service: ComposeServiceSpec,
  options: ComposeServiceToDockerRunOptions
): ToolResult<string> {
  if (service.image === '') return err('This service has no image to build a docker run command from.');

  const segments: string[] = [];

  if (service.stdinOpen && service.tty) segments.push('-it');
  else if (service.stdinOpen) segments.push('-i');
  else if (service.tty) segments.push('-t');

  const nameToUse = service.containerName ?? serviceName;
  if (nameToUse) segments.push(`--name ${shellEscape(nameToUse)}`);
  for (const port of service.ports) segments.push(`-p ${shellEscape(port)}`);
  for (const volume of service.volumes) segments.push(`-v ${shellEscape(volume)}`);
  for (const { key, value } of service.environment) segments.push(`-e ${shellEscape(`${key}=${value}`)}`);
  for (const file of service.envFile) segments.push(`--env-file ${shellEscape(file)}`);
  if (service.networks.length > 0) segments.push(`--network ${shellEscape(service.networks[0]!)}`);
  if (service.restart) segments.push(`--restart ${shellEscape(service.restart)}`);
  if (service.workingDir) segments.push(`-w ${shellEscape(service.workingDir)}`);

  let entrypointFlag: string | null = null;
  let leadingCommandArgs: string[] = [];
  if (service.entrypoint !== null) {
    if (Array.isArray(service.entrypoint)) {
      if (service.entrypoint.length > 0) {
        entrypointFlag = service.entrypoint[0]!;
        leadingCommandArgs = service.entrypoint.slice(1);
      }
    } else {
      entrypointFlag = service.entrypoint;
    }
  }
  if (entrypointFlag) segments.push(`--entrypoint ${shellEscape(entrypointFlag)}`);

  if (service.user) segments.push(`-u ${shellEscape(service.user)}`);
  for (const { key, value } of service.labels) segments.push(`--label ${shellEscape(`${key}=${value}`)}`);
  if (service.memLimit) segments.push(`-m ${shellEscape(service.memLimit)}`);
  if (service.cpus) segments.push(`--cpus ${shellEscape(service.cpus)}`);

  segments.push(shellEscape(service.image));

  let commandTokens: string[] = [];
  if (service.command !== null) {
    if (Array.isArray(service.command)) {
      commandTokens = service.command;
    } else {
      const tokenized = tokenizeShellCommand(service.command);
      if (!tokenized.ok) return tokenized;
      commandTokens = tokenized.value;
    }
  }
  for (const token of [...leadingCommandArgs, ...commandTokens]) segments.push(shellEscape(token));

  const joiner = options.multiline ? ' \\\n  ' : ' ';
  return ok(['docker run', ...segments].join(joiner));
}
