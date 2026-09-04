import { useEffect, useMemo, useState } from 'preact/hooks';
import { EMPTY_SECURITY_TXT, buildSecurityTxt, type SecurityTxtFields } from '../lib/tools/securityTxt';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { OutputPane } from './shared/OutputPane';
import { DownloadButton } from './shared/DownloadButton';
import { ShareLinkButton } from './shared/ShareLinkButton';

/** Matches `example.input`/`output` in security-txt-generator.mdx — keep the two in step. */
const EXAMPLE: SecurityTxtFields = {
  contacts: ['security@example.com', 'https://example.com/report'],
  expires: '2027-09-03',
  encryption: 'https://example.com/pgp-key.txt',
  acknowledgments: 'https://example.com/security/hall-of-fame',
  preferredLanguages: 'en, es',
  canonical: 'https://example.com/.well-known/security.txt',
  policy: 'https://example.com/security-policy',
  hiring: '',
  csaf: '',
};

type ShareState = SecurityTxtFields;

export default function SecurityTxtGenerator() {
  const [fields, setFields] = useState<SecurityTxtFields>(EMPTY_SECURITY_TXT);

  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      setFields({ ...EMPTY_SECURITY_TXT, ...restored.value, contacts: restored.value.contacts?.length ? restored.value.contacts : [''] });
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  const patch = (partial: Partial<SecurityTxtFields>) => setFields((current) => ({ ...current, ...partial }));
  const patchContact = (index: number, value: string) =>
    setFields((current) => ({ ...current, contacts: current.contacts.map((c, i) => (i === index ? value : c)) }));
  const addContact = () => setFields((current) => ({ ...current, contacts: [...current.contacts, ''] }));
  const removeContact = (index: number) =>
    setFields((current) => ({ ...current, contacts: current.contacts.length > 1 ? current.contacts.filter((_, i) => i !== index) : current.contacts }));

  const result = useMemo(() => buildSecurityTxt(fields), [fields]);
  const content = result.ok ? result.value.content : '';
  const warnings = result.ok ? result.value.warnings : [];
  const hasAnyInput = fields.contacts.some((c) => c.trim() !== '') || fields.expires.trim() !== '';
  const error = hasAnyInput && !result.ok ? result.error : null;

  const loadExample = () => setFields(EXAMPLE);
  const clearAll = () => setFields(EMPTY_SECURITY_TXT);
  const isEmpty = JSON.stringify(fields) === JSON.stringify(EMPTY_SECURITY_TXT);

  return (
    <div class="tool">
      <div class="tool-bar">
        <span class="tool-bar__spacer" />
        <ShareLinkButton getState={(): ShareState => fields} describe="this security.txt" />
        <button type="button" class="btn" onClick={loadExample} title="Fill in a worked example">
          Load example
        </button>
        <button type="button" class="btn" onClick={clearAll} disabled={isEmpty} title="Reset every field">
          Clear
        </button>
      </div>

      <div class="field">
        <span class="field__label">
          <span>Contact (required — at least one)</span>
        </span>
        <div class="sec-contacts">
          {fields.contacts.map((contact, index) => (
            <div class="sec-contact-row" key={index}>
              <input
                type="text"
                class="input"
                placeholder="security@example.com, https://example.com/report, or +1 201 555 0123"
                aria-label={`Contact ${index + 1}`}
                value={contact}
                onInput={(event) => patchContact(index, (event.target as HTMLInputElement).value)}
              />
              <button
                type="button"
                class="btn"
                onClick={() => removeContact(index)}
                disabled={fields.contacts.length <= 1}
                title="Remove this contact"
                aria-label={`Remove contact ${index + 1}`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button type="button" class="btn" onClick={addContact}>
          + Add contact
        </button>
        <span class="field__hint">An email, phone number, or URL — the mailto:/tel:/https:// prefix is added automatically if you leave it off. List your preferred contact first.</span>
      </div>

      <div class="sec-grid">
        <div class="field">
          <label class="field__label" for="sec-expires" title="How long this file is valid for — RFC 9116 requires it and recommends under a year">
            <span>Expires</span>
          </label>
          <input id="sec-expires" type="date" class="input" value={fields.expires} onInput={(event) => patch({ expires: (event.target as HTMLInputElement).value })} />
          <span class="field__hint">Required. Keep it under a year out so the file gets revisited.</span>
        </div>
        <div class="field">
          <label class="field__label" for="sec-languages">
            <span>Preferred languages</span>
          </label>
          <input
            id="sec-languages"
            type="text"
            class="input"
            placeholder="en, es"
            value={fields.preferredLanguages}
            onInput={(event) => patch({ preferredLanguages: (event.target as HTMLInputElement).value })}
          />
          <span class="field__hint">Comma-separated language tags for reports. Optional.</span>
        </div>
      </div>

      <div class="sec-grid">
        <div class="field">
          <label class="field__label" for="sec-encryption" title="A link to a PGP key or other encryption info reporters can use">
            <span>Encryption</span>
          </label>
          <input id="sec-encryption" type="url" class="input" value={fields.encryption} onInput={(event) => patch({ encryption: (event.target as HTMLInputElement).value })} />
        </div>
        <div class="field">
          <label class="field__label" for="sec-acknowledgments">
            <span>Acknowledgments</span>
          </label>
          <input
            id="sec-acknowledgments"
            type="url"
            class="input"
            value={fields.acknowledgments}
            onInput={(event) => patch({ acknowledgments: (event.target as HTMLInputElement).value })}
          />
          <span class="field__hint">A page crediting researchers who've reported issues. Optional.</span>
        </div>
      </div>

      <div class="sec-grid">
        <div class="field">
          <label class="field__label" for="sec-policy">
            <span>Policy</span>
          </label>
          <input id="sec-policy" type="url" class="input" value={fields.policy} onInput={(event) => patch({ policy: (event.target as HTMLInputElement).value })} />
          <span class="field__hint">Your vulnerability disclosure policy. Optional but recommended.</span>
        </div>
        <div class="field">
          <label class="field__label" for="sec-hiring">
            <span>Hiring</span>
          </label>
          <input id="sec-hiring" type="url" class="input" value={fields.hiring} onInput={(event) => patch({ hiring: (event.target as HTMLInputElement).value })} />
          <span class="field__hint">Security-related job postings. Optional.</span>
        </div>
      </div>

      <div class="field">
        <label class="field__label" for="sec-csaf" title="Link to a CSAF provider-metadata.json document, if you publish machine-readable security advisories">
          <span>CSAF</span>
        </label>
        <input id="sec-csaf" type="url" class="input" value={fields.csaf} onInput={(event) => patch({ csaf: (event.target as HTMLInputElement).value })} />
      </div>

      <div class="field">
        <label class="field__label" for="sec-canonical">
          <span>Canonical URL(s) (one per line)</span>
        </label>
        <textarea
          id="sec-canonical"
          class="textarea textarea--short"
          placeholder="https://example.com/.well-known/security.txt"
          value={fields.canonical}
          onInput={(event) => patch({ canonical: (event.target as HTMLTextAreaElement).value })}
        />
        <span class="field__hint">This file's own address(es). Recommended so a copy found elsewhere can be traced back to the original.</span>
      </div>

      <OutputPane
        label="security.txt"
        value={content}
        placeholder="Add at least one Contact and an Expires date above."
        tall
        describe="this security.txt file"
        actions={<DownloadButton value={content} filename="security.txt" describe="this security.txt file" />}
      />
      <ErrorMessage message={error} />

      {warnings.length > 0 && (
        <div class="msg msg--warning">
          <span class="msg__icon" aria-hidden="true">!</span>
          <ul class="sec-warnings">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      <p class="field__hint">
        Serve this exact content at <code>/.well-known/security.txt</code> with a{' '}
        <code>Content-Type: text/plain; charset=utf-8</code> header. This tool doesn't PGP-sign the file — see the FAQ below if
        you need that.
      </p>

      <style>{`
        .sec-grid { display: grid; gap: var(--space-4); grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); }
        .sec-contacts { display: flex; flex-direction: column; gap: var(--space-2); margin-bottom: var(--space-2); }
        .sec-contact-row { display: flex; gap: var(--space-2); }
        .sec-contact-row .input { flex: 1; }
        .sec-warnings { margin: 0; padding-left: var(--space-4); display: flex; flex-direction: column; gap: var(--space-2); }
      `}</style>
    </div>
  );
}
