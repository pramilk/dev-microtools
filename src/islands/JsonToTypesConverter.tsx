import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  generateTypesFromJson,
  generateTypesFromXml,
  LANGUAGES,
  LANGUAGE_LABELS,
  LANGUAGE_EXTENSIONS,
  SOURCE_FORMATS,
  SOURCE_FORMAT_LABELS,
  DEFAULT_ROOT_NAME,
  type Language,
  type SourceFormat,
} from '../lib/tools/jsonToTypes';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';
import { DownloadButton } from './shared/DownloadButton';
import { ShareLinkButton } from './shared/ShareLinkButton';
import { useTextFileDrop } from './shared/useTextFileDrop';

const SAMPLE: Record<SourceFormat, string> = {
  json: '{"id":101,"name":"Ada Lovelace","email":null,"isActive":true,"address":{"city":"London","zip":"SW1A"},"tags":["mathematician","writer"],"orders":[{"id":1,"total":42.5},{"id":2,"total":10,"discount":5}]}',
  xml: '<person id="101">\n  <name>Ada Lovelace</name>\n  <isActive>true</isActive>\n  <address>\n    <city>London</city>\n    <zip>SW1A</zip>\n  </address>\n  <tag>mathematician</tag>\n  <tag>writer</tag>\n</person>',
};

interface ShareState {
  sourceFormat: SourceFormat;
  input: string;
  language: Language;
  rootName: string;
}

export default function JsonToTypesConverter() {
  const [sourceFormat, setSourceFormat] = useState<SourceFormat>('json');
  const [input, setInput] = useState('');
  const [language, setLanguage] = useState<Language>('typescript');
  const [rootName, setRootName] = useState(DEFAULT_ROOT_NAME);

  const { isDragActive, dropHandlers } = useTextFileDrop(setInput);

  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      setSourceFormat(restored.value.sourceFormat);
      setInput(restored.value.input);
      setLanguage(restored.value.language);
      setRootName(restored.value.rootName);
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  const result = useMemo(() => {
    if (input.trim() === '') return null;
    return sourceFormat === 'json'
      ? generateTypesFromJson(input, language, rootName)
      : generateTypesFromXml(input, language, rootName);
  }, [sourceFormat, input, language, rootName]);
  const output = result?.ok ? result.value : '';
  const error = result && !result.ok ? result.error : null;

  const sourceLabel = SOURCE_FORMAT_LABELS[sourceFormat];

  return (
    <div class="tool">
      <div class="tool-bar" role="group" aria-label="Options">
        <label class="checkbox">
          <span class="field__hint">Input format</span>
          <select
            class="select"
            style="width:auto"
            value={sourceFormat}
            aria-label="Input format"
            onChange={(event) => setSourceFormat((event.target as HTMLSelectElement).value as SourceFormat)}
          >
            {SOURCE_FORMATS.map((format) => (
              <option key={format} value={format}>
                {SOURCE_FORMAT_LABELS[format]}
              </option>
            ))}
          </select>
        </label>
        <label class="checkbox">
          <span class="field__hint">Language</span>
          <select
            class="select"
            style="width:auto"
            value={language}
            aria-label="Target language"
            onChange={(event) => setLanguage((event.target as HTMLSelectElement).value as Language)}
          >
            {LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>
                {LANGUAGE_LABELS[lang]}
              </option>
            ))}
          </select>
        </label>
        <label class="checkbox" title="Name given to the top-level generated type">
          <span class="field__hint">Root type name</span>
          <input
            class="input"
            style="width:10rem"
            spellcheck={false}
            autocomplete="off"
            value={rootName}
            aria-label="Root type name"
            onInput={(event) => setRootName((event.target as HTMLInputElement).value)}
          />
        </label>

        <span class="tool-bar__spacer" />
        <ShareLinkButton getState={() => ({ sourceFormat, input, language, rootName })} describe={`this ${sourceLabel} and its settings`} />
        <button type="button" class="btn" onClick={() => setInput(SAMPLE[sourceFormat])} title="Load a small example">
          Load example
        </button>
        <button type="button" class="btn" onClick={() => setInput('')} disabled={input === ''} title="Clear the input">
          Clear
        </button>
      </div>

      <div class="panes panes--split">
        <div class="field">
          <label class="field__label" for="json-to-types-input">
            <span>{sourceLabel} input</span>
          </label>
          <textarea
            id="json-to-types-input"
            class={`textarea textarea--tall${isDragActive ? ' textarea--drag-active' : ''}`}
            spellcheck={false}
            autocomplete="off"
            placeholder={`Paste a ${sourceLabel} document here, or drop a file`}
            value={input}
            aria-invalid={error !== null}
            onInput={(event) => setInput((event.target as HTMLTextAreaElement).value)}
            {...dropHandlers}
          />
          {sourceFormat === 'xml' && (
            <p class="field__hint">
              Follows this site's XML↔JSON convention: an attribute becomes an <code>@name</code> field, and the
              document's root tag becomes the outer type's one field.
            </p>
          )}
        </div>

        <OutputPane
          label={`${LANGUAGE_LABELS[language]} output`}
          value={output}
          placeholder="Generated type definitions appear here."
          tall
          describe={`the generated ${LANGUAGE_LABELS[language]} types`}
          actions={
            <DownloadButton
              value={output}
              filename={`types.${LANGUAGE_EXTENSIONS[language]}`}
              mimeType="text/plain"
              describe={`the generated ${LANGUAGE_LABELS[language]} types`}
            />
          }
        />
      </div>

      <ErrorMessage message={error} />
    </div>
  );
}
