import { type ToolResult, ok, err, messageFrom } from './result';

/**
 * Bounds how much text this tool will attempt to parse/serialise client-side. DOMParser,
 * the pretty-printer and the JSON conversion are all synchronous and run on the main
 * thread with no way to show progress.
 */
export const MAX_INPUT_LENGTH = 2_000_000;

export const DEFAULT_INDENT_SIZE = 2;

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CDATA_SECTION_NODE = 4;

const isWhitespaceOnlyText = (node: Node): boolean =>
  node.nodeType === TEXT_NODE && /^\s*$/.test(node.nodeValue ?? '');

/**
 * Parses XML with the native `DOMParser`.
 *
 * The critical gotcha: `DOMParser.parseFromString` never throws on malformed XML. It
 * silently returns a `Document` containing a `<parsererror>` element with the error text
 * instead. Skipping this check is the single most common bug in hand-rolled XML parsing —
 * it turns "unclosed tag" into a garbled but "successful" result instead of a clear error.
 */
function parseXmlDocument(input: string): ToolResult<Document> {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(input, 'application/xml');
  } catch (error) {
    return err(messageFrom(error, 'Could not parse this XML.'));
  }

  const parserError = doc.getElementsByTagName('parsererror')[0];
  if (parserError) {
    const detail = parserError.textContent?.trim();
    return err(`This XML is not well-formed: ${detail || 'the parser did not explain why.'}`);
  }
  if (!doc.documentElement) {
    return err('This XML is not well-formed — no root element was found.');
  }

  return ok(doc);
}

/**
 * The XML declaration (`<?xml version="1.0"?>`) is consumed by the parser and never
 * appears as a node in the resulting document — there is nothing to walk to reproduce it.
 * It's pulled out of the raw source text up front instead, and stitched back onto the
 * front of formatted/minified output.
 */
function extractXmlDeclaration(input: string): string | null {
  const match = /^<\?xml\s[^?]*\?>/.exec(input);
  return match ? match[0] : null;
}

function escapeAttrValue(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function attrsToString(el: Element): string {
  const attrs = Array.from(el.attributes);
  if (attrs.length === 0) return '';
  return ' ' + attrs.map((attr) => `${attr.name}="${escapeAttrValue(attr.value)}"`).join(' ');
}

/**
 * Pretty-prints one element. Three shapes, in order of preference:
 *  - genuinely empty (no meaningful children) -> self-closed on one line
 *  - a single text or CDATA child -> kept on one line, e.g. `<name>Alice</name>`
 *  - a single child that mixes text with elements -> serialised verbatim via
 *    `XMLSerializer`, never reformatted, so meaningful inter-element whitespace in mixed
 *    content is never silently corrupted
 *  - otherwise, element-only content -> one child per line, indented
 */
function serializeElementPretty(el: Element, depth: number, indentSize: number, serializer: XMLSerializer): string {
  const indent = ' '.repeat(depth * indentSize);
  const open = `<${el.tagName}${attrsToString(el)}`;
  const children = Array.from(el.childNodes);
  const meaningful = children.filter((node) => !isWhitespaceOnlyText(node));

  if (meaningful.length === 0) return `${indent}${open}/>`;

  if (meaningful.length === 1 && meaningful[0]!.nodeType === TEXT_NODE) {
    return `${indent}${open}>${serializer.serializeToString(meaningful[0]!)}</${el.tagName}>`;
  }
  if (meaningful.length === 1 && meaningful[0]!.nodeType === CDATA_SECTION_NODE) {
    return `${indent}${open}>${serializer.serializeToString(meaningful[0]!)}</${el.tagName}>`;
  }

  const hasMixedText = meaningful.some((node) => node.nodeType === TEXT_NODE);
  if (hasMixedText) {
    const inner = children.map((node) => serializer.serializeToString(node)).join('');
    return `${indent}${open}>${inner}</${el.tagName}>`;
  }

  const innerLines = meaningful
    .map((node) => serializeNodePretty(node, depth + 1, indentSize, serializer))
    .filter((line) => line !== '');
  return `${indent}${open}>\n${innerLines.join('\n')}\n${indent}</${el.tagName}>`;
}

function serializeNodePretty(node: ChildNode, depth: number, indentSize: number, serializer: XMLSerializer): string {
  if (node.nodeType === ELEMENT_NODE) return serializeElementPretty(node as Element, depth, indentSize, serializer);
  if (isWhitespaceOnlyText(node)) return '';

  const indent = ' '.repeat(depth * indentSize);
  // Comments, processing instructions, DOCTYPE and stray text nodes all serialise
  // correctly through the native serializer with no reformatting needed.
  return indent + serializer.serializeToString(node);
}

/**
 * Parses then pretty-prints: one element per line with consistent indentation, attribute
 * order preserved, self-closed genuinely empty elements, and comments/CDATA/the XML
 * declaration/DOCTYPE preserved. Text-only leaves stay on one line rather than being
 * needlessly split across three.
 */
export function formatXml(input: string, indentSize: number = DEFAULT_INDENT_SIZE): ToolResult<string> {
  if (input.trim() === '') return err('Enter some XML to format.');
  if (input.length > MAX_INPUT_LENGTH) {
    return err(
      `Input is too large to format in the browser (${input.length.toLocaleString()} characters, limit ${MAX_INPUT_LENGTH.toLocaleString()}).`
    );
  }

  const parsed = parseXmlDocument(input);
  if (!parsed.ok) return parsed;

  const serializer = new XMLSerializer();
  const declaration = extractXmlDeclaration(input);
  const lines = Array.from(parsed.value.childNodes)
    .map((node) => serializeNodePretty(node, 0, indentSize, serializer))
    .filter((line) => line !== '');

  const body = lines.join('\n');
  return ok(declaration ? `${declaration}\n${body}` : body);
}

/** Removes whitespace-only text nodes in place, recursively. Never touches CDATA. */
function stripInsignificantWhitespace(node: Node): void {
  for (const child of Array.from(node.childNodes)) {
    if (isWhitespaceOnlyText(child)) {
      node.removeChild(child);
      continue;
    }
    if (child.nodeType === ELEMENT_NODE) stripInsignificantWhitespace(child);
  }
}

/**
 * Parses then re-serialises with whitespace-only text nodes between tags removed.
 * Everything else — meaningful text content, CDATA sections, comments, attribute values —
 * is copied through untouched; only insignificant formatting whitespace is dropped.
 */
export function minifyXml(input: string): ToolResult<string> {
  if (input.trim() === '') return err('Enter some XML to minify.');
  if (input.length > MAX_INPUT_LENGTH) {
    return err(
      `Input is too large to minify in the browser (${input.length.toLocaleString()} characters, limit ${MAX_INPUT_LENGTH.toLocaleString()}).`
    );
  }

  const parsed = parseXmlDocument(input);
  if (!parsed.ok) return parsed;

  const doc = parsed.value.cloneNode(true) as Document;
  stripInsignificantWhitespace(doc);

  const serializer = new XMLSerializer();
  const body = Array.from(doc.childNodes)
    .map((node) => serializer.serializeToString(node))
    .join('');
  const declaration = extractXmlDeclaration(input);
  return ok(declaration ? `${declaration}${body}` : body);
}

/**
 * Thin wrapper around the parser: well-formedness only. This is not a DTD/XSD schema
 * validator — it never checks that a document matches a schema, that required elements
 * are present, or that values are the right type. It only checks that the markup itself
 * is well-formed XML (every tag closed and nested correctly, one root element, etc.).
 * Schema validation is a different, much heavier problem this tool doesn't attempt.
 */
export function validateXml(input: string): ToolResult<true> {
  if (input.trim() === '') return err('Nothing to validate — paste some XML first.');
  if (input.length > MAX_INPUT_LENGTH) {
    return err(
      `Input is too large to validate in the browser (${input.length.toLocaleString()} characters, limit ${MAX_INPUT_LENGTH.toLocaleString()}).`
    );
  }

  const parsed = parseXmlDocument(input);
  if (!parsed.ok) return parsed;
  return ok(true);
}

/**
 * Converts one element to a plain JS value, following this tool's documented XML->JSON
 * convention (there is no universal standard, so this is a deliberate, explicit choice):
 *  - attributes become object keys prefixed with `@`
 *  - an element with only text and no attributes/children becomes a plain string, never
 *    auto-coerced to a number or boolean
 *  - an element with text *and* attributes, or text interleaved with child elements, puts
 *    the text under a `#text` key alongside the `@`-attributes / child keys
 *  - repeated sibling tags become a JSON array under that tag name; a single occurrence
 *    stays a plain value, not wrapped in a 1-element array
 */
function elementToJsonValue(el: Element): unknown {
  const attrs = Array.from(el.attributes);
  const childElements = Array.from(el.children);
  const directText = Array.from(el.childNodes)
    .filter((node) => node.nodeType === TEXT_NODE || node.nodeType === CDATA_SECTION_NODE)
    .map((node) => node.nodeValue ?? '')
    .join('');
  const trimmedText = directText.trim();

  if (attrs.length === 0 && childElements.length === 0) {
    return trimmedText;
  }

  const result: Record<string, unknown> = {};
  for (const attr of attrs) result[`@${attr.name}`] = attr.value;

  if (childElements.length > 0) {
    const order: string[] = [];
    const groups = new Map<string, unknown[]>();
    for (const child of childElements) {
      const value = elementToJsonValue(child);
      if (!groups.has(child.tagName)) {
        groups.set(child.tagName, []);
        order.push(child.tagName);
      }
      groups.get(child.tagName)!.push(value);
    }
    for (const tagName of order) {
      const values = groups.get(tagName)!;
      result[tagName] = values.length === 1 ? values[0] : values;
    }
  }

  if (trimmedText !== '') result['#text'] = trimmedText;

  return result;
}

/**
 * Converts a whole document to JSON. The document's single root element becomes the
 * single top-level key of the returned object, e.g. `<root><a>1</a></root>` becomes
 * `{ "root": { "a": "1" } }`.
 */
export function xmlToJson(input: string): ToolResult<unknown> {
  if (input.trim() === '') return err('Enter some XML to convert.');
  if (input.length > MAX_INPUT_LENGTH) {
    return err(
      `Input is too large to convert in the browser (${input.length.toLocaleString()} characters, limit ${MAX_INPUT_LENGTH.toLocaleString()}).`
    );
  }

  const parsed = parseXmlDocument(input);
  if (!parsed.ok) return parsed;

  const root = parsed.value.documentElement;
  return ok({ [root.tagName]: elementToJsonValue(root) });
}

// -------------------------------------------------------------- JSON value -> XML

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A JS object key can be anything; an XML name can't (no spaces, can't start with a
 * digit, only a limited character set). Invalid characters become `_` and a name that
 * doesn't start with a letter or underscore is prefixed with one, so every key produces
 * *some* valid tag/attribute name rather than emitting unparseable XML.
 */
function toXmlName(key: string): string {
  const cleaned = key.replace(/[^A-Za-z0-9_.-]/g, '_');
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `_${cleaned}`;
}

function escapeXmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Builds one or more sibling `<tagName>` lines for `value`, following the same
 * `@attr` / `#text` convention as {@link elementToJsonValue}, in reverse. An array
 * value becomes repeated sibling elements (mirroring how {@link elementToJsonValue}
 * collapses repeated siblings into an array), not a single element wrapping the array.
 */
function valueToXmlLines(tagName: string, value: unknown, depth: number, indentSize: number): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => valueToXmlLines(tagName, item, depth, indentSize));
  return [elementFromValue(tagName, value, depth, indentSize)];
}

function elementFromValue(tagName: string, value: unknown, depth: number, indentSize: number): string {
  const indent = ' '.repeat(depth * indentSize);
  const name = toXmlName(tagName);

  if (value === null || value === undefined) return `${indent}<${name}/>`;

  if (!isPlainObject(value)) {
    const text = escapeXmlText(String(value));
    return text === '' ? `${indent}<${name}/>` : `${indent}<${name}>${text}</${name}>`;
  }

  const attrEntries = Object.entries(value).filter(([key]) => key.startsWith('@'));
  const childEntries = Object.entries(value).filter(([key]) => key !== '#text' && !key.startsWith('@'));
  const text = value['#text'];
  const hasText = text !== undefined && text !== null && String(text) !== '';

  const attrsStr = attrEntries
    .map(([key, attrValue]) => ` ${toXmlName(key.slice(1))}="${escapeAttrValue(String(attrValue))}"`)
    .join('');

  const childLines = childEntries.flatMap(([key, childValue]) => valueToXmlLines(key, childValue, depth + 1, indentSize));

  if (childLines.length === 0 && !hasText) return `${indent}<${name}${attrsStr}/>`;
  if (childLines.length === 0) return `${indent}<${name}${attrsStr}>${escapeXmlText(String(text))}</${name}>`;

  const textLine = hasText ? `${' '.repeat((depth + 1) * indentSize)}${escapeXmlText(String(text))}` : null;
  const inner = [textLine, ...childLines].filter((line): line is string => line !== null).join('\n');
  return `${indent}<${name}${attrsStr}>\n${inner}\n${indent}</${name}>`;
}

/**
 * Converts a plain JS value (typically parsed from JSON, YAML or CSV) to XML — the
 * inverse of {@link xmlToJson}. XML requires exactly one root element, so:
 *  - an object with exactly one key, whose value isn't itself an array, uses that key as
 *    the root tag (round-tripping cleanly with `xmlToJson`'s output shape);
 *  - anything else (an array, a multi-key object, or a plain string/number/boolean) is
 *    wrapped in a `<root>` element, with a top-level array's items becoming repeated
 *    `<item>` children.
 */
export function jsonValueToXml(value: unknown, indentSize: number = DEFAULT_INDENT_SIZE): ToolResult<string> {
  const entries = isPlainObject(value) ? Object.entries(value) : [];

  if (entries.length === 1 && !Array.isArray(entries[0]![1])) {
    const [key, content] = entries[0]!;
    return ok(elementFromValue(key, content, 0, indentSize));
  }

  const rootContent = Array.isArray(value) ? { item: value } : value;
  return ok(elementFromValue('root', rootContent, 0, indentSize));
}
