import { describe, it, expect } from 'vitest';
import { toSafeJsonLd } from './jsonLd';

/** How the browser sees the embedded block: everything up to the first real `</script`. */
const asScriptBody = (serialised: string) => `<script type="application/ld+json">${serialised}</script>`;

describe('toSafeJsonLd', () => {
  it('produces parseable JSON for an ordinary object', () => {
    const schema = { '@context': 'https://schema.org', '@type': 'WebApplication', name: 'JSON Formatter' };
    expect(JSON.parse(toSafeJsonLd(schema))).toEqual(schema);
  });

  it('escapes a literal </script> so the block cannot be terminated early', () => {
    // The real regression: the minifier's FAQ copy mentions a `</script>` tag, and an
    // unescaped one ended the JSON-LD element and spilled the rest onto the page.
    const serialised = toSafeJsonLd({ text: 'Remove the trailing </script> tag.' });

    expect(serialised).not.toContain('</script');
    expect(serialised).toContain('\\u003c/script');
    expect(asScriptBody(serialised).indexOf('</script>')).toBe(asScriptBody(serialised).lastIndexOf('</script>'));
  });

  it('survives the round trip with the escape intact', () => {
    const schema = { text: 'Remove the trailing </script> tag.' };
    expect(JSON.parse(toSafeJsonLd(schema))).toEqual(schema);
  });

  it('escapes every `<`, not just the ones in a closing tag', () => {
    // Cheaper and safer than trying to match the exact `</script` sequence: `<` has no
    // meaning in JSON, so a blanket escape can never corrupt a document.
    const serialised = toSafeJsonLd({ q: 'a < b <b>bold</b> <!-- note -->' });
    expect(serialised).not.toContain('<');
    expect(JSON.parse(serialised)).toEqual({ q: 'a < b <b>bold</b> <!-- note -->' });
  });

  it('escapes case variants and split-attribute forms of the closing tag', () => {
    // `</SCRIPT >` and `</script foo>` both end a script element in HTML parsers.
    for (const text of ['</SCRIPT>', '</Script >', '</script\tbar>']) {
      const serialised = toSafeJsonLd({ text });
      expect(serialised.toLowerCase()).not.toContain('</script');
      expect(JSON.parse(serialised)).toEqual({ text });
    }
  });

  it('escapes `<` inside keys as well as values', () => {
    const serialised = toSafeJsonLd({ '</script>': 'value' });
    expect(serialised).not.toContain('<');
    expect(JSON.parse(serialised)).toEqual({ '</script>': 'value' });
  });

  it('escapes `<` nested deep inside arrays and objects', () => {
    const schema = {
      '@type': 'FAQPage',
      mainEntity: [{ acceptedAnswer: { text: 'Close it with </script>.' } }],
    };
    const serialised = toSafeJsonLd(schema);

    expect(serialised).not.toContain('<');
    expect(JSON.parse(serialised)).toEqual(schema);
  });

  it('leaves other characters alone', () => {
    const schema = { text: '日本語 😀 "quoted" & > \\ backslash' };
    expect(JSON.parse(toSafeJsonLd(schema))).toEqual(schema);
  });

  it('handles an empty object and an empty array', () => {
    expect(toSafeJsonLd({})).toBe('{}');
    expect(toSafeJsonLd([])).toBe('[]');
  });
});
