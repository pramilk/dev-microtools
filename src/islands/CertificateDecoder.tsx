import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  checkHostname,
  computeFingerprints,
  decodeCertificateInput,
  formatCertificateReport,
  reviewCertificate,
  reviewChain,
  sortFindings,
  type CertFinding,
  type DecodedCertificate,
  type DecodedItem,
  type Fingerprints,
} from '../lib/tools/x509';
import { readShareStateFromLocation } from '../lib/shareLink';
import { ErrorMessage } from './shared/ErrorMessage';
import { CopyButton } from './shared/CopyButton';
import { ShareLinkButton } from './shared/ShareLinkButton';
import { FindingList } from './shared/FindingList';
import { CollapsibleHelp } from './shared/CollapsibleHelp';
import { useTextFileDrop } from './shared/useTextFileDrop';

// Matches the worked example in x509-certificate-decoder.mdx exactly: a self-signed ECDSA
// certificate for the reserved example.test domain, whose key was discarded.
const SAMPLE_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIICwDCCAmagAwIBAgIUCgoTKANLy9M8GQCqIMX7h0vgeocwCgYIKoZIzj0EAwIw
fTELMAkGA1UEBhMCVVMxEzARBgNVBAgMCkNhbGlmb3JuaWExFjAUBgNVBAcMDVNh
biBGcmFuY2lzY28xFDASBgNVBAoMC0V4YW1wbGUgSW5jMRQwEgYDVQQLDAtFbmdp
bmVlcmluZzEVMBMGA1UEAwwMZXhhbXBsZS50ZXN0MB4XDTI2MTEwNjA2MzAzMloX
DTM2MTEwMzA2MzAzMlowfTELMAkGA1UEBhMCVVMxEzARBgNVBAgMCkNhbGlmb3Ju
aWExFjAUBgNVBAcMDVNhbiBGcmFuY2lzY28xFDASBgNVBAoMC0V4YW1wbGUgSW5j
MRQwEgYDVQQLDAtFbmdpbmVlcmluZzEVMBMGA1UEAwwMZXhhbXBsZS50ZXN0MFkw
EwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAESnqKwdvjAj37Z37+eyozoAPrINr9CU1F
IWZ1sjh4rD+SJn5BPjigiaaJuqq9ZOGsh2By9STWN8je4dNeLZXx0qOBwzCBwDAd
BgNVHQ4EFgQUAe5B56wTeuivycEk9EoH1ts3Df8wHwYDVR0jBBgwFoAUAe5B56wT
euivycEk9EoH1ts3Df8wQQYDVR0RBDowOIIMZXhhbXBsZS50ZXN0gg4qLmV4YW1w
bGUudGVzdIcEwAACAYESYWRtaW5AZXhhbXBsZS50ZXN0MA4GA1UdDwEB/wQEAwIH
gDAdBgNVHSUEFjAUBggrBgEFBQcDAQYIKwYBBQUHAwIwDAYDVR0TAQH/BAIwADAK
BggqhkjOPQQDAgNIADBFAiBzkTK7D3NiVW9ClnRv3V51czURl9zDCAELz3l82PI9
xAIhAPA8ARw0EW2V3QewC/vswwNv0pQfzcVxHQIeRpkI8bV4
-----END CERTIFICATE-----`;

const SAMPLE_HOSTNAME = 'api.example.test';

interface ShareState {
  input: string;
  hostname?: string;
}

const formatDate = (date: Date | null): string => (date ? `${date.toISOString().slice(0, 19).replace('T', ' ')} UTC` : '—');

function worst(findings: CertFinding[]): 'danger' | 'warning' | 'ok' {
  if (findings.some((item) => item.severity === 'danger')) return 'danger';
  if (findings.some((item) => item.severity === 'warning')) return 'warning';
  return 'ok';
}

const STATUS: Record<'danger' | 'warning' | 'ok', { cls: string; icon: string; text: string }> = {
  danger: { cls: 'msg--error', icon: '✕', text: 'Problems found' },
  warning: { cls: 'msg--warning', icon: '!', text: 'Worth a look' },
  ok: { cls: 'msg--success', icon: '✓', text: 'No problems found' },
};

function Row({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function CertificateView({
  item,
  index,
  total,
  now,
  hostname,
  fingerprints,
}: {
  item: DecodedItem;
  index: number;
  total: number;
  now: number;
  hostname: string;
  fingerprints: Fingerprints | null;
}) {
  const cert: DecodedCertificate = item.certificate;
  const findings = useMemo(() => sortFindings(reviewCertificate(cert, now)), [cert, now]);
  const status = STATUS[worst(findings)];
  const match = useMemo(() => (index === 0 && cert.kind === 'certificate' ? checkHostname(cert, hostname) : null), [cert, hostname, index]);
  const title = cert.subject.commonName ?? cert.subject.text;

  return (
    <section class="x509-cert" aria-label={`${cert.kind === 'csr' ? 'Request' : 'Certificate'} ${index + 1}: ${title}`}>
      {total > 1 && (
        <h3 class="x509-cert__heading">
          {cert.kind === 'csr' ? 'Request' : 'Certificate'} {index + 1} of {total}: {title}
        </h3>
      )}

      <div class={`msg ${status.cls} x509-status`} role="status">
        <span class="msg__icon" aria-hidden="true">
          {status.icon}
        </span>
        <div>
          <p class="x509-status__headline">
            {title} — {status.text}
          </p>
          <p class="x509-status__summary">
            {cert.kind === 'csr' ? 'Certificate request (CSR)' : cert.isSelfSigned ? 'Self-signed certificate' : `Issued by ${cert.issuer?.commonName ?? cert.issuer?.text ?? 'an unnamed issuer'}`}
            {cert.notAfter ? `, expires ${formatDate(cert.notAfter).slice(0, 10)}` : ''}
          </p>
        </div>
      </div>

      {match && (
        <p class={`msg ${match.matches ? 'msg--success' : 'msg--error'}`} role="status">
          <span class="msg__icon" aria-hidden="true">
            {match.matches ? '✓' : '✕'}
          </span>
          <span>{match.message}</span>
        </p>
      )}

      <div class="result-card">
        <h4 class="result-card__title">Findings</h4>
        <FindingList items={findings} />
      </div>

      <div class="result-card">
        <h4 class="result-card__title">Details</h4>
        <dl class="x509-grid">
          <Row label="Subject">{cert.subject.text}</Row>
          {cert.issuer && <Row label="Issuer">{cert.issuer.text}</Row>}
          {cert.notBefore && <Row label="Valid from">{formatDate(cert.notBefore)}</Row>}
          {cert.notAfter && <Row label="Valid until">{formatDate(cert.notAfter)}</Row>}
          {cert.serial && <Row label="Serial number">{cert.serial}</Row>}
          <Row label="Public key">{cert.publicKey.description}</Row>
          <Row label="Signature">{cert.signatureAlgorithm}</Row>
          {cert.kind === 'certificate' && <Row label="Version">{`v${cert.version}`}</Row>}
          {cert.san.length > 0 && (
            <Row label="Names (SAN)">
              <ul class="x509-list">
                {cert.san.map((entry, entryIndex) => (
                  <li key={`${entry.type}-${entry.value}-${entryIndex}`}>
                    <span class="x509-tag">{entry.type}</span> {entry.value}
                  </li>
                ))}
              </ul>
            </Row>
          )}
          {cert.isCa !== null && <Row label="Certificate authority">{cert.isCa ? `Yes${cert.pathLength !== null ? ` (path length ${cert.pathLength})` : ''}` : 'No'}</Row>}
          {cert.keyUsage.length > 0 && <Row label="Key usage">{cert.keyUsage.join(', ')}</Row>}
          {cert.extendedKeyUsage.length > 0 && <Row label="Extended key usage">{cert.extendedKeyUsage.map((usage) => usage.name).join(', ')}</Row>}
          {cert.policies.length > 0 && <Row label="Policies">{cert.policies.join(', ')}</Row>}
          {cert.ocsp.length > 0 && <Row label="OCSP">{cert.ocsp.join(', ')}</Row>}
          {cert.crlUrls.length > 0 && <Row label="CRL">{cert.crlUrls.join(', ')}</Row>}
          {cert.caIssuers.length > 0 && <Row label="CA issuer">{cert.caIssuers.join(', ')}</Row>}
          {cert.sctCount !== null && <Row label="Transparency">{`${cert.sctCount} embedded timestamp${cert.sctCount === 1 ? '' : 's'} (SCTs)`}</Row>}
          {cert.subjectKeyId && <Row label="Subject key ID">{cert.subjectKeyId}</Row>}
          {cert.authorityKeyId && <Row label="Authority key ID">{cert.authorityKeyId}</Row>}
        </dl>
      </div>

      {fingerprints && cert.kind === 'certificate' && (
        <div class="result-card">
          <h4 class="result-card__title">Fingerprints</h4>
          <dl class="x509-grid">
            <Row label="SHA-256">{fingerprints.sha256}</Row>
            <Row label="SHA-1">{fingerprints.sha1}</Row>
            <Row label="Public key pin">{`pin-sha256="${fingerprints.spkiSha256}"`}</Row>
          </dl>
        </div>
      )}

      {cert.extensions.length > 0 && (
        <details class="x509-extensions">
          <summary>All extensions ({cert.extensions.length})</summary>
          <ul class="x509-ext-list">
            {cert.extensions.map((extension, extensionIndex) => (
              <li key={`${extension.oid}-${extensionIndex}`}>
                <p class="x509-ext__name">
                  {extension.name}
                  {extension.critical && <span class="x509-tag x509-tag--critical">critical</span>}
                </p>
                <p class="x509-ext__oid">{extension.oid}</p>
                {extension.details.map((line, lineIndex) => (
                  <p key={lineIndex} class="x509-ext__line">
                    {line}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export default function CertificateDecoder() {
  const [input, setInput] = useState('');
  const [hostname, setHostname] = useState('');
  const [fingerprints, setFingerprints] = useState<Array<Fingerprints | null>>([]);

  // Restore a shared link, if the page was opened with one.
  useEffect(() => {
    void readShareStateFromLocation<ShareState>().then((restored) => {
      if (!restored?.ok) return;
      setInput(restored.value.input ?? '');
      setHostname(restored.value.hostname ?? '');
      history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  const drop = useTextFileDrop(setInput);

  const result = useMemo(() => (input.trim() === '' ? null : decodeCertificateInput(input)), [input]);
  const decoded = result?.ok ? result.value : null;
  const error = result && !result.ok ? result.error : null;
  const now = Date.now();

  useEffect(() => {
    if (!decoded) {
      setFingerprints([]);
      return undefined;
    }
    let stale = false;
    void Promise.all(decoded.map((item) => computeFingerprints(item.certificate))).then((all) => {
      if (!stale) setFingerprints(all.map((entry) => (entry.ok ? entry.value : null)));
    });
    return () => {
      stale = true;
    };
  }, [decoded]);

  const chainFindings = useMemo(() => (decoded ? reviewChain(decoded) : []), [decoded]);

  const report = useMemo(() => {
    if (!decoded) return '';
    return decoded
      .map((item, index) =>
        formatCertificateReport(item, sortFindings(reviewCertificate(item.certificate, now)), fingerprints[index] ?? null)
      )
      .join('\n\n---\n\n');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `now` changes every render; the report only needs refreshing with the data
  }, [decoded, fingerprints]);

  const loadExample = () => {
    setInput(SAMPLE_CERTIFICATE);
    setHostname(SAMPLE_HOSTNAME);
  };

  return (
    <div class="tool">
      <div class="tool-bar">
        <span class="tool-bar__spacer" />
        <ShareLinkButton getState={() => ({ input, hostname })} describe="this certificate (the pasted certificate is stored inside the link)" />
        <CopyButton value={report} label="Copy report" describe="certificate report" />
        <button type="button" class="btn" onClick={loadExample} title="Fill in a sample self-signed certificate and check a hostname against it">
          Load example
        </button>
        <button
          type="button"
          class="btn"
          onClick={() => {
            setInput('');
            setHostname('');
          }}
          disabled={input === '' && hostname === ''}
          title="Clear the certificate and hostname"
        >
          Clear
        </button>
      </div>

      <CollapsibleHelp summary="How do I get a certificate? (browser, OpenSSL, a file)">
        <div class="help-callout__grid">
          <section>
            <h3>Chrome &amp; Edge</h3>
            <ol>
              <li>
                Click the padlock (or tune icon) left of the address, then <strong>Connection is secure</strong> →{' '}
                <strong>Certificate is valid</strong>.
              </li>
              <li>
                Open the <strong>Details</strong> tab and choose <strong>Export…</strong>, saving as Base64-encoded (PEM).
              </li>
              <li>Open the file in a text editor, copy everything and paste it below.</li>
            </ol>
          </section>
          <section>
            <h3>Firefox</h3>
            <ol>
              <li>
                Click the padlock, then <strong>Connection secure</strong> → <strong>More information</strong> →{' '}
                <strong>View Certificate</strong>.
              </li>
              <li>
                Under <strong>Miscellaneous</strong>, click the <strong>PEM (cert)</strong> link to download it.
              </li>
              <li>Open the file, copy everything and paste it below.</li>
            </ol>
          </section>
          <section>
            <h3>OpenSSL (any server)</h3>
            <ol>
              <li>
                Run <code>openssl s_client -connect example.com:443 -servername example.com &lt;/dev/null | openssl x509</code>
              </li>
              <li>
                Copy the block from <code>-----BEGIN CERTIFICATE-----</code> to <code>-----END CERTIFICATE-----</code>.
              </li>
              <li>
                For a CSR, open the <code>.csr</code> file or run <code>cat request.csr</code>.
              </li>
            </ol>
          </section>
        </div>
        <p class="help-callout__note">
          Certificates are public, so pasting one is safe. <strong>Never paste a private key</strong>: this tool refuses them, and no
          legitimate service will ask for one. You can also drop a <code>.pem</code>, <code>.crt</code> or <code>.csr</code> text file onto
          the box. A binary <code>.cer</code> file needs converting first with{' '}
          <code>openssl x509 -inform der -in file.cer</code>.
        </p>
      </CollapsibleHelp>

      <div class="field">
        <label class="field__label" for="x509-input">
          <span>Certificate or CSR (PEM)</span>
          <span class="field__hint">Paste one or a whole chain. Drop a text file here too.</span>
        </label>
        <textarea
          id="x509-input"
          class={`textarea textarea--tall${drop.isDragActive ? ' textarea--drag-active' : ''}`}
          spellcheck={false}
          autocomplete="off"
          placeholder={'-----BEGIN CERTIFICATE-----\nMIIC…\n-----END CERTIFICATE-----'}
          value={input}
          aria-invalid={error !== null}
          onInput={(event) => setInput((event.target as HTMLTextAreaElement).value)}
          {...drop.dropHandlers}
        />
      </div>

      <div class="field">
        <label class="field__label" for="x509-host">
          <span>Check a hostname (optional)</span>
          <span class="field__hint">Does the first certificate cover this site?</span>
        </label>
        <input
          id="x509-host"
          class="input"
          type="text"
          spellcheck={false}
          autocomplete="off"
          placeholder="www.example.com"
          value={hostname}
          title="A hostname or IP address. The tool checks it against the certificate's Subject Alternative Names, as a browser would."
          onInput={(event) => setHostname((event.target as HTMLInputElement).value)}
        />
      </div>

      <ErrorMessage message={error} />

      {decoded && (
        <div class="x509-result">
          {chainFindings.length > 0 && (
            <div class="result-card">
              <h3 class="result-card__title">Chain</h3>
              <FindingList items={chainFindings} />
            </div>
          )}

          {decoded.map((item, index) => (
            <CertificateView
              key={`${item.certificate.serial}-${index}`}
              item={item}
              index={index}
              total={decoded.length}
              now={now}
              hostname={hostname}
              fingerprints={fingerprints[index] ?? null}
            />
          ))}

          <p class="field__hint">
            This decodes what the certificate says about itself. It does not check signatures, revocation or whether any browser would
            trust the issuer, which needs the issuer&apos;s key and a trust store. Nothing you paste is uploaded.
          </p>
        </div>
      )}

      <style>{`
        .x509-result { display: flex; flex-direction: column; gap: var(--space-4); }
        .x509-cert { display: flex; flex-direction: column; gap: var(--space-3); }
        .x509-cert__heading { margin: 0; font-size: var(--text-base); }
        .x509-status { align-items: flex-start; }
        .x509-status__headline { margin: 0; font-weight: 700; font-size: var(--text-base); word-break: break-word; }
        .x509-status__summary { margin: var(--space-1) 0 0; }
        .x509-grid {
          display: grid; grid-template-columns: minmax(8rem, auto) 1fr;
          gap: var(--space-2) var(--space-4); margin: 0; font-size: var(--text-sm);
        }
        .x509-grid dt { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-muted); font-weight: 600; letter-spacing: .04em; }
        .x509-grid dd { margin: 0; word-break: break-all; font-family: var(--font-mono); font-size: var(--text-xs); }
        .x509-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
        .x509-tag {
          display: inline-block; font-family: var(--font-mono); font-size: .65rem; font-weight: 700;
          padding: 0 .4em; border: 1px solid var(--border); border-radius: 3px; color: var(--text-muted);
          text-transform: uppercase; margin-right: .25em;
        }
        .x509-tag--critical { color: var(--warning); border-color: var(--warning-border); background: var(--warning-subtle); margin-left: var(--space-2); }
        .x509-extensions { border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); padding: var(--space-3) var(--space-4); }
        .x509-extensions > summary { cursor: pointer; font-weight: 600; font-size: var(--text-sm); }
        .x509-extensions > summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
        .x509-ext-list { list-style: none; margin: var(--space-3) 0 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-3); }
        .x509-ext__name { margin: 0; font-weight: 600; font-size: var(--text-sm); }
        .x509-ext__oid { margin: 0; font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-subtle); }
        .x509-ext__line { margin: 0; font-family: var(--font-mono); font-size: var(--text-xs); color: var(--text-muted); word-break: break-all; }
        @media (max-width: 36rem) {
          .x509-grid { grid-template-columns: 1fr; gap: 0; }
          .x509-grid dd { margin-bottom: var(--space-2); }
        }
      `}</style>
    </div>
  );
}
