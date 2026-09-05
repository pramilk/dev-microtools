import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  generateLoremIpsum,
  DEFAULT_LOREM_OPTIONS,
  LOREM_LIMITS,
  type LoremIpsumOptions,
  type LoremUnit,
} from '../lib/tools/loremIpsum';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';
import { DownloadButton } from './shared/DownloadButton';
import { ShareLinkButton } from './shared/ShareLinkButton';

// No "Load example" button — like Fake Data Generator, this tool always shows generated
// text immediately with sensible defaults, so the default output is itself the example.

const UNIT_LABELS: Record<LoremUnit, string> = {
  paragraphs: 'Paragraphs',
  sentences: 'Sentences',
  words: 'Words',
};

export default function LoremIpsumGenerator() {
  const [options, setOptions] = useState<LoremIpsumOptions>(DEFAULT_LOREM_OPTIONS);

  useEffect(() => {
    void readShareStateFromLocation<LoremIpsumOptions>().then((restored) => {
      if (!restored?.ok) return;
      setOptions(restored.value);
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  const result = useMemo(() => generateLoremIpsum(options), [options]);
  const output = result.ok ? result.value : '';
  const error = result.ok ? null : result.error;

  // A word/character count of the *output* here, not just the "how many paragraphs/
  // sentences/words to generate" input above — so checking whether the generated text
  // fits a design spec's word or character budget doesn't mean copying it out to a
  // separate tool just to count it.
  const wordCount = useMemo(() => (output.trim() === '' ? 0 : output.trim().split(/\s+/).length), [output]);
  const charCount = output.length;

  const limits = LOREM_LIMITS[options.unit];
  const extension = options.asHtml ? 'html' : 'txt';
  const mimeType = options.asHtml ? 'text/html' : 'text/plain';

  const changeUnit = (unit: LoremUnit) => {
    setOptions((prev) => ({ ...prev, unit, count: Math.min(prev.count, LOREM_LIMITS[unit].max) }));
  };

  return (
    <div class="tool">
      <div class="tool-bar" role="group" aria-label="Generator options">
        <label class="checkbox" title="What unit of text to generate">
          <span class="field__hint">Generate</span>
          <select
            class="select"
            style="width:auto"
            value={options.unit}
            aria-label="Unit"
            onChange={(event) => changeUnit((event.target as HTMLSelectElement).value as LoremUnit)}
          >
            {(Object.keys(UNIT_LABELS) as LoremUnit[]).map((unit) => (
              <option key={unit} value={unit}>
                {UNIT_LABELS[unit]}
              </option>
            ))}
          </select>
        </label>
        <label class="checkbox" title={`How many ${options.unit} to generate (${limits.min}-${limits.max})`}>
          <span class="field__hint">Count</span>
          <input
            type="number"
            class="input"
            style="width:6rem"
            min={limits.min}
            max={limits.max}
            value={options.count}
            aria-label="Count"
            onInput={(event) =>
              setOptions((prev) => ({ ...prev, count: Number((event.target as HTMLInputElement).value) }))
            }
          />
        </label>

        <label class="checkbox" title="Start with the classic 'Lorem ipsum dolor sit amet…' opening, or somewhere else in the passage">
          <input
            type="checkbox"
            checked={options.startWithLorem}
            onChange={() => setOptions((prev) => ({ ...prev, startWithLorem: !prev.startWithLorem }))}
          />
          <span>Start with "Lorem ipsum…"</span>
        </label>
        <label class="checkbox" title="Wrap the output in <p> tags, ready to paste into HTML">
          <input
            type="checkbox"
            checked={options.asHtml}
            onChange={() => setOptions((prev) => ({ ...prev, asHtml: !prev.asHtml }))}
          />
          <span>HTML output</span>
        </label>

        <span class="tool-bar__spacer" />
        <ShareLinkButton getState={() => options} describe="these settings" />
      </div>

      <ErrorMessage message={error} />

      <OutputPane
        label="Generated text"
        value={output}
        placeholder="Generated Lorem Ipsum text appears here."
        tall
        describe="the generated text"
        actions={
          <>
            {output !== '' && (
              <span class="field__hint tnum">
                {wordCount} words · {charCount} characters
              </span>
            )}
            <DownloadButton value={output} filename={`lorem-ipsum.${extension}`} mimeType={mimeType} describe="the generated text" />
          </>
        }
      />
    </div>
  );
}
