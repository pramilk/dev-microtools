import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  MODELS,
  DEFAULT_MODEL_ID,
  modelOrDefault,
  PRICING_AS_OF,
  PRICING_SOURCES,
  findModel,
  modelsByProvider,
  estimateTokensForAllModels,
  ratesFor,
  estimateCost,
  formatUsd,
  contextUsagePercent,
  type TokenModel,
} from '../lib/tools/tokenCount';
import {
  countExactly,
  isEncodingLoaded,
  ENCODING_DOWNLOAD_KB,
  type ExactCount,
} from '../lib/tools/exactTokenizer';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ShareLinkButton } from './shared/ShareLinkButton';
import { CopyButton } from './shared/CopyButton';
import { ErrorMessage } from './shared/ErrorMessage';
import { useTextFileDrop } from './shared/useTextFileDrop';

/** Matches the worked example in llm-token-counter.mdx, so the two can never drift apart. */
const SAMPLE_TEXT = `You are a senior technical writer. Rewrite the following release note so a
non-technical customer can understand it, keep it under 80 words, and end with a single
sentence explaining why the change matters.

Release note: Migrated the ingestion pipeline from per-row inserts to batched COPY
statements, reducing p99 write latency from 840ms to 62ms under peak load.`;

const DEFAULT_OUTPUT_TOKENS = '500';
const DEFAULT_CALLS = '1';

/**
 * Exact counting is debounced rather than run per keystroke: `encode()` walks the whole
 * input through the merge table, which is fast but not free on a large paste. The estimate
 * underneath updates instantly, so nothing ever looks frozen while this settles.
 */
const EXACT_DEBOUNCE_MS = 150;

interface ShareState {
  input: string;
  modelId: string;
  outputTokens: string;
  calls: string;
}

/** Parses a count field, treating anything invalid or negative as zero. */
function toCount(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** Parses a price field. Zero is a legitimate rate (a free tier), so only reject invalid input. */
function toPrice(raw: string): number {
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

const compact = (value: number): string => value.toLocaleString('en-US');

export default function TokenCounter() {
  const [input, setInput] = useState('');
  const [modelId, setModelId] = useState(DEFAULT_MODEL_ID);
  const [outputTokens, setOutputTokens] = useState(DEFAULT_OUTPUT_TOKENS);
  const [calls, setCalls] = useState(DEFAULT_CALLS);
  const [useCustomRates, setUseCustomRates] = useState(false);
  const [customInputPrice, setCustomInputPrice] = useState('');
  const [customOutputPrice, setCustomOutputPrice] = useState('');
  const [exactResult, setExactResult] = useState<ExactCount | null>(null);
  const [exactBusy, setExactBusy] = useState(false);
  const [exactError, setExactError] = useState<string | null>(null);

  const model: TokenModel = modelOrDefault(modelId);
  const encoding = model.encoding;
  // Exact counting is not a mode the visitor switches on — it just happens, for every model
  // whose vocabulary is public. Anthropic's and Google's models fall back to the estimate,
  // and that is a fact about those vendors rather than a setting anyone should have to find.
  const exactAvailable = encoding !== null;

  const { isDragActive, dropHandlers } = useTextFileDrop(setInput);

  // Restore state from a shared link.
  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      const state = restored.value;
      setInput(state.input);
      if (findModel(state.modelId)) setModelId(state.modelId);
      setOutputTokens(state.outputTokens);
      setCalls(state.calls);
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  // One pass over the text covers the headline number and every row of the comparison
  // table, instead of one pass per model.
  const estimates = useMemo(() => estimateTokensForAllModels(input), [input]);
  const estimatedTokens = estimates.get(model.id) ?? 0;

  useEffect(() => {
    if (encoding === null || input === '') {
      setExactResult(null);
      setExactError(null);
      setExactBusy(false);
      return;
    }

    let cancelled = false;
    // The very first run for an encoding has to fetch the vocabulary; later ones are
    // instant, so the loading state is only shown when it can actually be seen.
    setExactBusy(!isEncodingLoaded(encoding));

    const timer = setTimeout(() => {
      void countExactly(input, encoding).then((result) => {
        // Guard against a slow response overwriting a newer input's result.
        if (cancelled) return;
        setExactBusy(false);
        if (result.ok) {
          setExactResult(result.value);
          setExactError(null);
        } else {
          setExactResult(null);
          setExactError(result.error);
        }
      });
    }, EXACT_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [encoding, input]);

  const showingExact = exactResult !== null;
  const inputTokens = showingExact ? exactResult.total : estimatedTokens;

  const rates = useCustomRates
    ? { inputPricePerMillion: toPrice(customInputPrice), outputPricePerMillion: toPrice(customOutputPrice) }
    : ratesFor(model, inputTokens);

  const cost = estimateCost({
    inputTokens,
    outputTokens: toCount(outputTokens),
    calls: toCount(calls),
    ...rates,
  });

  const contextPercent = contextUsagePercent(inputTokens, model.contextWindow);
  const overContext = inputTokens > model.contextWindow;

  const characters = input.length;
  const words = input.trim() === '' ? 0 : input.trim().split(/\s+/).length;
  const tokensPerWord = words === 0 ? 0 : inputTokens / words;

  const report = [
    `Model: ${model.label} (${model.provider})`,
    `Input tokens: ${compact(inputTokens)} (${showingExact ? 'exact' : 'estimated'})`,
    `Characters: ${compact(characters)} · Words: ${compact(words)}`,
    `Context window: ${compact(model.contextWindow)} tokens (${contextPercent.toFixed(1)}% used)`,
    `Assumed output tokens: ${compact(toCount(outputTokens))}`,
    `Cost per call: ${formatUsd(cost.perCallCost)}`,
    `Cost for ${compact(toCount(calls))} call(s): ${formatUsd(cost.totalCost)}`,
  ].join('\n');

  const enableCustomRates = (enabled: boolean) => {
    // Seed the fields from the selected model so the first thing shown is a real rate to
    // edit, not two empty boxes and a $0.00 total.
    if (enabled && customInputPrice === '' && customOutputPrice === '') {
      setCustomInputPrice(String(model.inputPricePerMillion));
      setCustomOutputPrice(String(model.outputPricePerMillion));
    }
    setUseCustomRates(enabled);
  };

  const clearAll = () => {
    setInput('');
    setOutputTokens(DEFAULT_OUTPUT_TOKENS);
    setCalls(DEFAULT_CALLS);
    setExactResult(null);
    setExactError(null);
  };

  return (
    <div class="tool">
      <div class="tool-bar">
        <span class="tool-bar__spacer" />
        <ShareLinkButton
          getState={(): ShareState => ({ input, modelId, outputTokens, calls })}
          describe="this prompt and model"
        />
        <button
          type="button"
          class="btn"
          onClick={() => setInput(SAMPLE_TEXT)}
          title="Load a realistic example prompt"
        >
          Load example
        </button>
        <button
          type="button"
          class="btn"
          onClick={clearAll}
          disabled={input === ''}
          title="Clear the prompt and reset the cost settings"
        >
          Clear
        </button>
      </div>

      <div class="field">
        <label class="field__label" for="token-input">
          <span>Prompt or document</span>
          <span class="field__hint">
            {compact(characters)} characters · {compact(words)} words
          </span>
        </label>
        <textarea
          id="token-input"
          class={`textarea textarea--short${isDragActive ? ' textarea--drag-active' : ''}`}
          spellcheck={false}
          autocomplete="off"
          placeholder="Paste the prompt, document or transcript you want to price — or drop a .txt file here…"
          value={input}
          onInput={(event) => setInput((event.target as HTMLTextAreaElement).value)}
          {...dropHandlers}
        />
        {/* The drop target is the textarea itself, which gives no visual clue on its own once
            it has text in it. This line keeps the affordance visible at every stage, and
            confirms the drop is live while a file is actually being dragged over. */}
        <p class={`dropnote${isDragActive ? ' dropnote--active' : ''}`}>
          <span aria-hidden="true">📄</span>{' '}
          {isDragActive
            ? 'Release to load this file'
            : 'You can also drag a .txt, .md, .json or source file onto the box above — it is read in your browser, never uploaded.'}
        </p>
      </div>

      <div class="tool-bar">
        <label class="field__label field__label--inline" for="token-model">
          Model
        </label>
        <select
          id="token-model"
          class="select select--auto"
          value={modelId}
          onChange={(event) => setModelId((event.target as HTMLSelectElement).value)}
          title="Pricing and context window come from this model"
        >
          {modelsByProvider().map(({ provider, models }) => (
            <optgroup key={provider} label={provider}>
              {models.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        <span class="tool-bar__spacer" />

        {exactAvailable && (
          <span class="count-note">
            Counted exactly with OpenAI&rsquo;s {encoding} vocabulary
          </span>
        )}
      </div>

      {/* The vocabulary is a megabyte-scale download, so its arrival is announced rather
          than left to a number that silently changes a second after the page settles. */}
      {exactBusy && encoding !== null && (
        <p class="msg msg--info" role="status">
          <span class="msg__icon" aria-hidden="true">
            ↓
          </span>
          <span>
            Downloading {model.label}&rsquo;s tokenizer ({encoding},{' '}
            {compact(ENCODING_DOWNLOAD_KB[encoding])} KB) for an exact count. The number below is
            an estimate until it arrives.
          </span>
        </p>
      )}

      {model.priceNote && <p class="field__hint">Pricing note: {model.priceNote}</p>}

      {!exactAvailable && (
        <p class="msg msg--warning">
          <span class="msg__icon" aria-hidden="true">
            !
          </span>
          <span>
            <strong>
              {model.provider} has not published its tokenizer, so this count is an estimate.
              Exact counting is only possible for OpenAI models, whose vocabularies are public.
            </strong>{' '}
            The figure below is modelled on OpenAI&rsquo;s tokenizer and corrected using{' '}
            {model.provider}&rsquo;s published characters-per-token guidance &mdash; expect it to
            be close, not precise.
          </span>
        </p>
      )}

      <ErrorMessage message={exactError} />

      <div class="count-card">
        <div class="count-card__main">
          <span class="count-card__value tnum" aria-live="polite">
            {compact(inputTokens)}
          </span>
          <span class="count-card__unit">input {inputTokens === 1 ? 'token' : 'tokens'}</span>
          <span class={`count-badge count-badge--${showingExact ? 'exact' : 'estimate'}`}>
            {showingExact ? 'Exact' : exactBusy ? 'Estimate — downloading…' : 'Estimate'}
          </span>
        </div>
        <div class="stats">
          <span class="stats__item">
            <strong>{compact(characters)}</strong> characters
          </span>
          <span class="stats__item">
            <strong>{compact(words)}</strong> words
          </span>
          <span class="stats__item">
            <strong>{tokensPerWord === 0 ? '—' : tokensPerWord.toFixed(2)}</strong> tokens per word
          </span>
          <span class="stats__item">
            <strong>{characters === 0 ? '—' : (characters / Math.max(inputTokens, 1)).toFixed(2)}</strong>{' '}
            characters per token
          </span>
        </div>

        <div class="context">
          <div class="context__head">
            <span>
              {contextPercent < 0.05 && inputTokens > 0 ? '<0.1' : contextPercent.toFixed(1)}% of{' '}
              {model.label}&rsquo;s {compact(model.contextWindow)}-token context window
            </span>
          </div>
          <div class="context__track">
            <div
              class={`context__fill${overContext ? ' context__fill--over' : ''}`}
              style={{ width: `${Math.min(100, contextPercent)}%` }}
            />
          </div>
          {overContext && (
            <p class="msg msg--warning">
              <span class="msg__icon" aria-hidden="true">
                !
              </span>
              <span>
                This is longer than {model.label} can accept in one request — it would need to be
                split or summarised first.
              </span>
            </p>
          )}
        </div>
      </div>

      <fieldset class="cost">
        <legend class="cost__legend">Cost estimate</legend>

        <div class="cost__inputs">
          <div class="field">
            <label class="field__label" for="token-output">
              <span>Expected output tokens</span>
              <span class="field__hint">Per call</span>
            </label>
            <input
              id="token-output"
              class="input"
              type="number"
              min="0"
              step="50"
              value={outputTokens}
              onInput={(event) => setOutputTokens((event.target as HTMLInputElement).value)}
              title="Output tokens are billed at a higher rate than input on almost every model, so a guess here matters"
            />
          </div>

          <div class="field">
            <label class="field__label" for="token-calls">
              <span>Number of calls</span>
              <span class="field__hint">Turns a per-call price into a bill</span>
            </label>
            <input
              id="token-calls"
              class="input"
              type="number"
              min="1"
              step="100"
              value={calls}
              onInput={(event) => setCalls((event.target as HTMLInputElement).value)}
              title="How many times this prompt runs — e.g. one per row in a batch job"
            />
          </div>
        </div>

        <label
          class="checkbox"
          title="Override the built-in prices — useful for a negotiated rate, a provider not listed, or a price that has changed"
        >
          <input
            type="checkbox"
            checked={useCustomRates}
            onChange={(event) => enableCustomRates((event.target as HTMLInputElement).checked)}
          />
          Use my own rates
        </label>

        {useCustomRates && (
          <div class="cost__inputs">
            <div class="field">
              <label class="field__label" for="token-price-in">
                <span>Input price</span>
                <span class="field__hint">USD per 1M tokens</span>
              </label>
              <input
                id="token-price-in"
                class="input"
                type="number"
                min="0"
                step="0.01"
                value={customInputPrice}
                onInput={(event) => setCustomInputPrice((event.target as HTMLInputElement).value)}
              />
            </div>
            <div class="field">
              <label class="field__label" for="token-price-out">
                <span>Output price</span>
                <span class="field__hint">USD per 1M tokens</span>
              </label>
              <input
                id="token-price-out"
                class="input"
                type="number"
                min="0"
                step="0.01"
                value={customOutputPrice}
                onInput={(event) => setCustomOutputPrice((event.target as HTMLInputElement).value)}
              />
            </div>
          </div>
        )}

        <table class="cost-table">
          <tbody>
            <tr>
              <th scope="row">Input ({compact(inputTokens)} tokens)</th>
              <td class="tnum">{formatUsd(cost.inputCost)}</td>
            </tr>
            <tr>
              <th scope="row">Output ({compact(toCount(outputTokens))} tokens)</th>
              <td class="tnum">{formatUsd(cost.outputCost)}</td>
            </tr>
            <tr>
              <th scope="row">Per call</th>
              <td class="tnum">{formatUsd(cost.perCallCost)}</td>
            </tr>
            <tr class="cost-table__total">
              <th scope="row">
                Total for {compact(toCount(calls))} {toCount(calls) === 1 ? 'call' : 'calls'}
              </th>
              <td class="tnum">{formatUsd(cost.totalCost)}</td>
            </tr>
          </tbody>
        </table>

        <div class="tool-bar">
          <span class="tool-bar__spacer" />
          <CopyButton value={report} label="Copy report" describe="token and cost report" />
        </div>
      </fieldset>

      {showingExact && exactResult.pieces.length > 0 && (
        <div class="field">
          <label class="field__label">
            <span>How {model.label} splits it</span>
            <span class="field__hint">
              {exactResult.piecesTruncated
                ? `First ${compact(exactResult.pieces.length)} of ${compact(exactResult.total)} tokens`
                : `All ${compact(exactResult.total)} tokens`}
            </span>
          </label>
          <div class="tokens" aria-label="Token boundaries">
            {exactResult.pieces.map((piece, index) => (
              <span
                key={`${piece.id}-${index}`}
                class={`tokens__piece tokens__piece--${index % 5}`}
                title={`Token ${compact(index + 1)} · id ${piece.id}`}
              >
                {piece.text}
              </span>
            ))}
          </div>
        </div>
      )}

      <details class="compare">
        <summary class="compare__summary">Compare this prompt across every model</summary>
        <table class="cost-table cost-table--compare">
          <thead>
            <tr>
              <th scope="col">Model</th>
              <th scope="col">Input tokens</th>
              <th scope="col">Per call</th>
              <th scope="col">
                Total &times; {compact(toCount(calls))}
              </th>
            </tr>
          </thead>
          <tbody>
            {MODELS.map((entry) => {
              const entryTokens =
                showingExact && entry.encoding === encoding
                  ? exactResult.total
                  : (estimates.get(entry.id) ?? 0);
              const entryCost = estimateCost({
                inputTokens: entryTokens,
                outputTokens: toCount(outputTokens),
                calls: toCount(calls),
                ...ratesFor(entry, entryTokens),
              });
              return (
                <tr key={entry.id} class={entry.id === model.id ? 'cost-table__current' : undefined}>
                  <th scope="row">
                    {entry.label} <span class="compare__provider">{entry.provider}</span>
                  </th>
                  <td class="tnum">{compact(entryTokens)}</td>
                  <td class="tnum">{formatUsd(entryCost.perCallCost)}</td>
                  <td class="tnum">{formatUsd(entryCost.totalCost)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p class="field__hint">
          Prices checked {PRICING_AS_OF}. Vendors change them without notice — confirm against{' '}
          <a href={PRICING_SOURCES.OpenAI} rel="nofollow noopener" target="_blank">
            OpenAI
          </a>
          ,{' '}
          <a href={PRICING_SOURCES.Anthropic} rel="nofollow noopener" target="_blank">
            Anthropic
          </a>{' '}
          or{' '}
          <a href={PRICING_SOURCES.Google} rel="nofollow noopener" target="_blank">
            Google
          </a>{' '}
          before committing to a budget, or tick &ldquo;Use my own rates&rdquo; above.
        </p>
      </details>

      <style>{`
        .select--auto { width: auto; min-width: 12rem; }

        .dropnote {
          margin: var(--space-2) 0 0;
          font-size: var(--text-xs);
          color: var(--text-muted);
          display: flex; align-items: center; gap: var(--space-2);
          border: 1px dashed var(--border-strong);
          border-radius: var(--radius);
          padding: var(--space-2) var(--space-3);
        }
        .dropnote--active {
          border-style: solid;
          border-color: var(--accent);
          background: var(--accent-subtle);
          color: var(--text);
          font-weight: 600;
        }
        .field__label--inline { margin: 0; }
        .count-note { color: var(--text-subtle); font-weight: 400; }

        .count-card {
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          background: var(--surface);
          padding: var(--space-4);
          display: flex; flex-direction: column; gap: var(--space-3);
          /* Reserves the card's height so the estimate/exact swap never shifts the page. */
          min-height: 9.5rem;
        }
        .count-card__main { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--space-2); }
        .count-card__value {
          font-family: var(--font-mono); font-size: var(--text-3xl);
          font-weight: 650; line-height: 1; color: var(--text);
        }
        .count-card__unit { font-size: var(--text-sm); color: var(--text-muted); }

        .count-badge {
          margin-left: auto;
          font-size: var(--text-xs); font-weight: 600;
          text-transform: uppercase; letter-spacing: .06em;
          border-radius: 99px; padding: .15em .7em; border: 1px solid transparent;
        }
        .count-badge--exact {
          color: var(--success); background: var(--success-subtle); border-color: var(--success-border);
        }
        .count-badge--estimate {
          color: var(--text-muted); background: var(--surface-2); border-color: var(--border);
        }

        .context { display: flex; flex-direction: column; gap: var(--space-2); }
        .context__head { font-size: var(--text-xs); color: var(--text-muted); }
        .context__track {
          height: 6px; border-radius: 99px; background: var(--surface-3); overflow: hidden;
        }
        .context__fill { height: 100%; background: var(--accent); border-radius: 99px; }
        .context__fill--over { background: var(--warning); }

        .cost {
          border: 1px solid var(--border); border-radius: var(--radius-lg);
          background: var(--surface); padding: var(--space-4);
          display: flex; flex-direction: column; gap: var(--space-3);
          margin: 0;
        }
        .cost__legend {
          font-size: var(--text-sm); font-weight: 650; color: var(--text); padding: 0 var(--space-2);
        }
        .cost__inputs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); }
        @media (max-width: 34rem) { .cost__inputs { grid-template-columns: 1fr; } }

        .cost-table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
        .cost-table th, .cost-table td {
          text-align: left; padding: var(--space-2) 0;
          border-bottom: 1px solid var(--border); font-weight: 400; color: var(--text-muted);
        }
        .cost-table td { text-align: right; color: var(--text); font-family: var(--font-mono); }
        .cost-table__total th, .cost-table__total td {
          font-weight: 650; color: var(--text); border-bottom: none; font-size: var(--text-base);
        }

        .cost-table--compare { margin-top: var(--space-3); }
        .cost-table--compare thead th {
          font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .05em;
          color: var(--text-subtle);
        }
        .cost-table--compare thead th:not(:first-child) { text-align: right; }
        .cost-table__current { background: var(--accent-subtle); }
        .compare__provider { color: var(--text-subtle); font-size: var(--text-xs); }

        .compare { border: 1px solid var(--border); border-radius: var(--radius-lg); padding: var(--space-3) var(--space-4); background: var(--surface); }
        .compare__summary { cursor: pointer; font-size: var(--text-sm); font-weight: 600; }

        .tokens {
          font-family: var(--font-mono); font-size: var(--text-sm); line-height: 1.9;
          white-space: pre-wrap; word-break: break-word;
          border: 1px solid var(--border); border-radius: var(--radius);
          background: var(--surface); padding: var(--space-3);
          max-height: 22rem; overflow: auto;
        }
        /* Five rotating tints so adjacent tokens are always distinguishable, including
           whitespace-only tokens, which would otherwise be invisible. */
        .tokens__piece { border-radius: var(--radius-sm); padding: .1em 0; }
        .tokens__piece--0 { background: color-mix(in srgb, var(--accent) 16%, transparent); }
        .tokens__piece--1 { background: color-mix(in srgb, var(--warning) 18%, transparent); }
        .tokens__piece--2 { background: color-mix(in srgb, var(--success) 16%, transparent); }
        .tokens__piece--3 { background: color-mix(in srgb, var(--danger) 14%, transparent); }
        .tokens__piece--4 { background: var(--surface-3); }
      `}</style>
    </div>
  );
}
