import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  parseDockerRunCommand,
  dockerRunToCompose,
  deriveServiceName,
  parseComposeYaml,
  parseComposeService,
  composeServiceToDockerRun,
  type DockerRunSpec,
} from '../lib/tools/dockerConvert';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';
import { ShareLinkButton } from './shared/ShareLinkButton';

type Direction = 'run-to-compose' | 'compose-to-run';

const SAMPLE_RUN_COMMAND =
  'docker run -d --name web -p 8080:80 -e NODE_ENV=production -v ./data:/app/data --restart unless-stopped nginx:alpine';

const SAMPLE_COMPOSE_YAML = [
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
].join('\n');

interface ShareState {
  direction: Direction;
  input: string;
  serviceName: string;
  multiline: boolean;
}

/** `-d`/`--detach` and `--rm` are recognized `docker run` flags with no compose *service*
 *  field — detached mode is a property of `docker compose up -d`, not of the service
 *  definition, and compose services have no self-removal concept at all. Computed rather
 *  than stored on the spec, since it's presentation, not parsing, logic. */
function droppedFlagsNote(spec: DockerRunSpec): string | null {
  const parts: string[] = [];
  if (spec.rm) parts.push('--rm has no compose service field — a compose service can\'t remove itself after stopping');
  if (parts.length === 0) return null;
  return parts.join('; ') + '.';
}

export default function DockerRunComposeConverter() {
  const [direction, setDirection] = useState<Direction>('run-to-compose');
  const [input, setInput] = useState('');
  const [serviceName, setServiceName] = useState('');
  const [multiline, setMultiline] = useState(true);
  const [selectedService, setSelectedService] = useState<string | null>(null);

  const [output, setOutput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [availableServices, setAvailableServices] = useState<string[]>([]);
  const [runSpec, setRunSpec] = useState<DockerRunSpec | null>(null);

  const requestId = useRef(0);

  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      const state = restored.value;
      setDirection(state.direction);
      setInput(state.input);
      setServiceName(state.serviceName);
      setMultiline(state.multiline);
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  // ------------------------------------------------------------- docker run -> compose

  useEffect(() => {
    if (direction !== 'run-to-compose') return;
    const id = (requestId.current += 1);

    if (input.trim() === '') {
      setOutput('');
      setError(null);
      setWarnings([]);
      setRunSpec(null);
      setAvailableServices([]);
      return;
    }

    const parsed = parseDockerRunCommand(input);
    if (!parsed.ok) {
      setOutput('');
      setError(parsed.error);
      setWarnings([]);
      setRunSpec(null);
      setAvailableServices([]);
      return;
    }
    setRunSpec(parsed.value);
    setAvailableServices([]);

    const nameToUse = serviceName.trim() !== '' ? serviceName.trim() : deriveServiceName(parsed.value);
    void dockerRunToCompose(parsed.value, { serviceName: nameToUse }).then((result) => {
      if (id !== requestId.current) return;
      if (result.ok) {
        setOutput(result.value);
        setError(null);
        const flagWarnings = parsed.value.unsupportedFlags.map((flag) => `Unrecognized flag dropped: ${flag}`);
        const dropped = droppedFlagsNote(parsed.value);
        setWarnings(dropped ? [...flagWarnings, dropped] : flagWarnings);
      } else {
        setOutput('');
        setError(result.error);
        setWarnings([]);
      }
    });
  }, [input, direction, serviceName]);

  // ------------------------------------------------------------- compose -> docker run

  useEffect(() => {
    if (direction !== 'compose-to-run') return;
    const id = (requestId.current += 1);

    if (input.trim() === '') {
      setOutput('');
      setError(null);
      setWarnings([]);
      setAvailableServices([]);
      return;
    }

    void parseComposeYaml(input).then((composeResult) => {
      if (id !== requestId.current) return;
      if (!composeResult.ok) {
        setOutput('');
        setError(composeResult.error);
        setWarnings([]);
        setAvailableServices([]);
        return;
      }

      const names = Object.keys(composeResult.value.services);
      setAvailableServices(names);
      const chosen = selectedService !== null && names.includes(selectedService) ? selectedService : names[0]!;
      if (chosen !== selectedService) setSelectedService(chosen);

      const serviceResult = parseComposeService(composeResult.value.services[chosen]);
      if (!serviceResult.ok) {
        setOutput('');
        setError(serviceResult.error);
        setWarnings([]);
        return;
      }

      const commandResult = composeServiceToDockerRun(chosen, serviceResult.value, { multiline });
      if (!commandResult.ok) {
        setOutput('');
        setError(commandResult.error);
        setWarnings([]);
        return;
      }

      setOutput(commandResult.value);
      setError(null);
      setWarnings(serviceResult.value.unsupportedNotes);
    });
  }, [input, direction, selectedService, multiline]);

  const derivedDefaultName = useMemo(() => {
    if (direction !== 'run-to-compose') return 'app';
    return runSpec ? deriveServiceName(runSpec) : 'app';
  }, [direction, runSpec]);

  const swap = () => {
    if (output === '') return;
    setDirection((current) => (current === 'run-to-compose' ? 'compose-to-run' : 'run-to-compose'));
    setInput(output);
    setSelectedService(null);
  };

  const loadExample = () => {
    if (direction === 'run-to-compose') {
      setInput(SAMPLE_RUN_COMMAND);
      setServiceName('');
    } else {
      setInput(SAMPLE_COMPOSE_YAML);
      setSelectedService(null);
    }
  };

  const clearAll = () => {
    setInput('');
    setServiceName('');
    setSelectedService(null);
  };

  const inputLabel = direction === 'run-to-compose' ? 'docker run command' : 'compose YAML';
  const outputLabel = direction === 'run-to-compose' ? 'docker-compose.yml' : 'docker run command';
  const placeholder =
    direction === 'run-to-compose'
      ? 'Paste a docker run command, e.g.\ndocker run -d --name web -p 8080:80 nginx:alpine'
      : 'Paste a docker-compose.yml file here';

  return (
    <div class="tool">
      <div class="seg docker-direction-seg" role="group" aria-label="Conversion direction">
        <button
          type="button"
          class="seg__btn"
          aria-pressed={direction === 'run-to-compose'}
          onClick={() => setDirection('run-to-compose')}
        >
          docker run → compose
        </button>
        <button
          type="button"
          class="seg__btn"
          aria-pressed={direction === 'compose-to-run'}
          onClick={() => setDirection('compose-to-run')}
        >
          compose → docker run
        </button>
      </div>

      <div class="tool-bar" role="group" aria-label="Docker converter options">
        {direction === 'run-to-compose' && (
          <label class="checkbox">
            <span class="field__hint">Service name</span>
            <input
              class="input"
              style="width:auto"
              type="text"
              spellcheck={false}
              autocomplete="off"
              placeholder={derivedDefaultName}
              aria-label="Compose service name"
              title="The key under services: in the generated compose file — defaults to --name, or the image name if not given"
              value={serviceName}
              onInput={(event) => setServiceName((event.target as HTMLInputElement).value)}
            />
          </label>
        )}

        {direction === 'compose-to-run' && availableServices.length > 1 && (
          <label class="checkbox">
            <span class="field__hint">Service</span>
            <select
              class="select"
              style="width:auto"
              value={selectedService ?? availableServices[0]}
              aria-label="Compose service to convert"
              title="This compose file has more than one service — pick which one to convert"
              onChange={(event) => setSelectedService((event.target as HTMLSelectElement).value)}
            >
              {availableServices.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}

        {direction === 'compose-to-run' && (
          <div class="seg" role="group" aria-label="Output format">
            <button
              type="button"
              class="seg__btn"
              aria-pressed={multiline}
              onClick={() => setMultiline(true)}
              title="One flag per line, joined with a line-continuation backslash"
            >
              Multi-line
            </button>
            <button
              type="button"
              class="seg__btn"
              aria-pressed={!multiline}
              onClick={() => setMultiline(false)}
              title="Everything on a single line"
            >
              Single line
            </button>
          </div>
        )}

        <button
          type="button"
          class="btn"
          onClick={swap}
          disabled={output === ''}
          title="Move the generated output into the input and flip direction"
        >
          <span aria-hidden="true">⇄</span> Swap
        </button>

        <span class="tool-bar__spacer" />
        <ShareLinkButton getState={(): ShareState => ({ direction, input, serviceName, multiline })} describe="this conversion" />
        <button type="button" class="btn" onClick={loadExample} title="Load a small example">
          Load example
        </button>
        <button type="button" class="btn" onClick={clearAll} disabled={input === ''} title="Clear the input">
          Clear
        </button>
      </div>

      <div class="panes panes--split">
        <div class="field">
          <label class="field__label" for="docker-convert-input">
            <span>{inputLabel}</span>
          </label>
          <textarea
            id="docker-convert-input"
            class="textarea textarea--tall"
            spellcheck={false}
            autocomplete="off"
            placeholder={placeholder}
            value={input}
            aria-invalid={error !== null}
            onInput={(event) => setInput((event.target as HTMLTextAreaElement).value)}
          />
        </div>

        <OutputPane label={outputLabel} value={output} placeholder="Converted output appears here." tall describe={outputLabel} />
      </div>

      <ErrorMessage message={error} />

      {warnings.length > 0 && (
        <p class="msg msg--warning" role="status">
          <span class="msg__icon" aria-hidden="true">
            !
          </span>
          <span>
            The conversion completed, but couldn't fully represent everything:
            <ul class="docker-convert-warnings">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </span>
        </p>
      )}

      <style>{`
        .docker-convert-warnings { margin: var(--space-1) 0 0; padding-left: 1.25em; }
        /* .seg is inline-flex, but .tool is a flex-column with the default align-items:
           stretch, which stretches a direct-child .seg to the full row width, leaving dead
           space after the last button. Local, so no other tool's toggles move. */
        .docker-direction-seg { align-self: flex-start; }
      `}</style>
    </div>
  );
}
