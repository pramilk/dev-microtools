import { type ToolResult, ok, err, messageFrom } from './result';
import { xmlToJson } from './xml';

export type Language = 'typescript' | 'go' | 'rust' | 'python' | 'csharp' | 'java' | 'kotlin' | 'swift';

export const LANGUAGES: Language[] = ['typescript', 'go', 'rust', 'python', 'csharp', 'java', 'kotlin', 'swift'];

export const LANGUAGE_LABELS: Record<Language, string> = {
  typescript: 'TypeScript',
  go: 'Go',
  rust: 'Rust',
  python: 'Python',
  csharp: 'C#',
  java: 'Java',
  kotlin: 'Kotlin',
  swift: 'Swift',
};

export const LANGUAGE_EXTENSIONS: Record<Language, string> = {
  typescript: 'ts',
  go: 'go',
  rust: 'rs',
  python: 'py',
  csharp: 'cs',
  java: 'java',
  kotlin: 'kt',
  swift: 'swift',
};

export const DEFAULT_ROOT_NAME = 'Root';

/**
 * Bounds how much JSON this tool will attempt to infer types from. Inference walks the
 * whole parsed value recursively and runs synchronously on the main thread, so an
 * unbounded input would freeze the page with no way to show progress.
 */
export const MAX_INPUT_LENGTH = 2_000_000;

/** Guards against a stack overflow from pathologically deep (but small) JSON. */
const MAX_DEPTH = 300;

class DepthExceededError extends Error {}

// ------------------------------------------------------------------- inference

interface UnknownNode {
  kind: 'unknown';
  nullable: boolean;
}
interface BooleanNode {
  kind: 'boolean';
  nullable: boolean;
}
interface IntegerNode {
  kind: 'integer';
  nullable: boolean;
}
interface FloatNode {
  kind: 'float';
  nullable: boolean;
}
interface StringNode {
  kind: 'string';
  nullable: boolean;
}
interface ArrayNode {
  kind: 'array';
  item: TypeNode;
  nullable: boolean;
}
interface ObjectNode {
  kind: 'object';
  fields: Map<string, FieldInfo>;
  nullable: boolean;
}
interface UnionNode {
  kind: 'union';
  options: TypeNode[];
  nullable: boolean;
}

type TypeNode = UnknownNode | BooleanNode | IntegerNode | FloatNode | StringNode | ArrayNode | ObjectNode | UnionNode;

interface FieldInfo {
  type: TypeNode;
  /** True when the key is missing from at least one sample object that was merged into this shape. */
  optional: boolean;
}

/**
 * Infers a type tree from a parsed JSON value. A JSON `null` becomes an "unknown, nullable"
 * node rather than its own type, since `null` alone carries no information about what the
 * real (non-null) type would be — merging it with a concrete value later resolves it.
 */
function inferType(value: unknown, depth = 0): TypeNode {
  if (depth > MAX_DEPTH) throw new DepthExceededError();

  if (value === null) return { kind: 'unknown', nullable: true };
  if (typeof value === 'boolean') return { kind: 'boolean', nullable: false };
  if (typeof value === 'number') return { kind: Number.isInteger(value) ? 'integer' : 'float', nullable: false };
  if (typeof value === 'string') return { kind: 'string', nullable: false };

  if (Array.isArray(value)) {
    if (value.length === 0) return { kind: 'array', item: { kind: 'unknown', nullable: false }, nullable: false };
    let item = inferType(value[0], depth + 1);
    for (let i = 1; i < value.length; i += 1) {
      item = mergeNode(item, inferType(value[i], depth + 1));
    }
    return { kind: 'array', item, nullable: false };
  }

  const fields = new Map<string, FieldInfo>();
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    fields.set(key, { type: inferType(val, depth + 1), optional: false });
  }
  return { kind: 'object', fields, nullable: false };
}

/**
 * Merges two type observations of "the same position" (two elements of one array, or the
 * same object key seen across several array elements) into one type that describes both.
 * Objects merge field-by-field, marking a key optional when it's missing on either side;
 * genuinely incompatible kinds (e.g. a field that's sometimes a string, sometimes a number)
 * fold into a union rather than silently picking one and dropping data about the other.
 */
function mergeNode(a: TypeNode, b: TypeNode): TypeNode {
  const nullable = a.nullable || b.nullable;

  if (a.kind === 'unknown') return { ...b, nullable };
  if (b.kind === 'unknown') return { ...a, nullable };

  if (a.kind === 'object' && b.kind === 'object') {
    const fields = new Map<string, FieldInfo>();
    const keys = new Set([...a.fields.keys(), ...b.fields.keys()]);
    for (const key of keys) {
      const fa = a.fields.get(key);
      const fb = b.fields.get(key);
      if (fa && fb) {
        fields.set(key, { type: mergeNode(fa.type, fb.type), optional: fa.optional || fb.optional });
      } else if (fa) {
        fields.set(key, { type: fa.type, optional: true });
      } else {
        fields.set(key, { type: fb!.type, optional: true });
      }
    }
    return { kind: 'object', fields, nullable };
  }

  if (a.kind === 'array' && b.kind === 'array') {
    return { kind: 'array', item: mergeNode(a.item, b.item), nullable };
  }

  if ((a.kind === 'integer' || a.kind === 'float') && (b.kind === 'integer' || b.kind === 'float')) {
    return { kind: a.kind === 'float' || b.kind === 'float' ? 'float' : 'integer', nullable };
  }

  if (a.kind === b.kind) return { ...a, nullable };

  return unionOf([...flattenUnionOptions(a), ...flattenUnionOptions(b)], nullable);
}

function flattenUnionOptions(node: TypeNode): TypeNode[] {
  return node.kind === 'union' ? node.options : [node];
}

function canMerge(a: TypeNode, b: TypeNode): boolean {
  if (a.kind === 'unknown' || b.kind === 'unknown') return true;
  if (a.kind === b.kind) return true;
  return (a.kind === 'integer' || a.kind === 'float') && (b.kind === 'integer' || b.kind === 'float');
}

function unionOf(options: TypeNode[], nullable: boolean): TypeNode {
  const merged: TypeNode[] = [];
  for (const option of options) {
    const matchIndex = merged.findIndex((existing) => canMerge(existing, option));
    if (matchIndex >= 0) {
      merged[matchIndex] = mergeNode(merged[matchIndex]!, option);
    } else {
      merged.push(option);
    }
  }
  if (merged.length === 1) return { ...merged[0]!, nullable: merged[0]!.nullable || nullable };
  return { kind: 'union', options: merged, nullable };
}

// ------------------------------------------------------------------- naming

/** Splits an identifier-ish string into words, handling camelCase, snake_case, kebab-case and acronyms. */
function splitWords(raw: string): string[] {
  const spaced = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  return spaced.split(/[^A-Za-z0-9]+/).filter(Boolean);
}

function pascalCase(raw: string): string {
  const words = splitWords(raw);
  return words.map((w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase()).join('');
}

function snakeCase(raw: string): string {
  const words = splitWords(raw);
  return words.map((w) => w.toLowerCase()).join('_');
}

function camelCase(raw: string): string {
  const pascal = pascalCase(raw);
  return pascal === '' ? '' : pascal[0]!.toLowerCase() + pascal.slice(1);
}

/** A type name valid in all four target languages: starts with a letter, ASCII alphanumeric only. */
function sanitizeTypeName(raw: string): string {
  let name = pascalCase(raw);
  if (name !== '' && /^[0-9]/.test(name)) name = `T${name}`;
  return name;
}

/** Best-effort English singularization, used to name an array's element type from its field name. */
function singularize(word: string): string {
  if (word.length > 3 && /ies$/i.test(word)) return word.slice(0, -3) + 'y';
  if (/(s|x|z|ch|sh)es$/i.test(word)) return word.slice(0, -2);
  if (word.length > 1 && /s$/i.test(word) && !/ss$/i.test(word)) return word.slice(0, -1);
  return word;
}

function elementHint(containerHint: string): string {
  const singular = singularize(containerHint);
  return singular === containerHint ? `${containerHint}Item` : singular;
}

function makeUniquer(): (base: string) => string {
  const used = new Set<string>();
  return (base: string) => {
    const safeBase = base === '' ? 'Field' : base;
    let candidate = safeBase;
    let suffix = 2;
    while (used.has(candidate)) {
      candidate = `${safeBase}${suffix}`;
      suffix += 1;
    }
    used.add(candidate);
    return candidate;
  };
}

// ------------------------------------------------------------------- resolution (naming + dedup)

interface ResolvedBase {
  nullable: boolean;
}
type ResolvedType =
  | ({ kind: 'unknown' } & ResolvedBase)
  | ({ kind: 'boolean' } & ResolvedBase)
  | ({ kind: 'integer' } & ResolvedBase)
  | ({ kind: 'float' } & ResolvedBase)
  | ({ kind: 'string' } & ResolvedBase)
  | ({ kind: 'array'; item: ResolvedType } & ResolvedBase)
  | ({ kind: 'union'; options: ResolvedType[] } & ResolvedBase)
  | ({ kind: 'ref'; name: string } & ResolvedBase);

interface NamedField {
  jsonKey: string;
  optional: boolean;
  type: ResolvedType;
}
interface NamedObject {
  name: string;
  fields: NamedField[];
}
interface TypeModel {
  rootName: string;
  /** Object names in child-before-parent order, so every reference is already defined above it. */
  order: string[];
  objects: Map<string, NamedObject>;
  root: ResolvedType;
}

function typeSig(t: ResolvedType): string {
  const suffix = t.nullable ? '?' : '';
  switch (t.kind) {
    case 'ref':
      return `ref:${t.name}${suffix}`;
    case 'array':
      return `array<${typeSig(t.item)}>${suffix}`;
    case 'union':
      return `union<${t.options.map(typeSig).sort().join(',')}>${suffix}`;
    default:
      return `${t.kind}${suffix}`;
  }
}

function signatureOf(fields: NamedField[]): string {
  return fields
    .slice()
    .sort((a, b) => a.jsonKey.localeCompare(b.jsonKey))
    .map((f) => `${f.jsonKey}:${f.optional ? 1 : 0}:${typeSig(f.type)}`)
    .join('|');
}

/**
 * Turns the inferred type tree into named, deduplicated types: every object shape gets a
 * name derived from where it appears (a field called `address` produces `Address`; an array
 * field called `tags` produces the element type `Tag`), and two structurally identical
 * shapes reuse one name rather than being emitted twice.
 */
function resolveNode(
  node: TypeNode,
  nameHint: string,
  registry: Map<string, NamedObject>,
  order: string[],
  signatures: Map<string, string>,
  nameUniquer: (base: string) => string,
  isRoot: boolean
): ResolvedType {
  switch (node.kind) {
    case 'unknown':
    case 'boolean':
    case 'integer':
    case 'float':
    case 'string':
      return { kind: node.kind, nullable: node.nullable };
    case 'array': {
      const item = resolveNode(node.item, elementHint(nameHint), registry, order, signatures, nameUniquer, false);
      return { kind: 'array', item, nullable: node.nullable };
    }
    case 'union': {
      const options = node.options.map((option, index) =>
        resolveNode(option, `${nameHint}Variant${index + 1}`, registry, order, signatures, nameUniquer, false)
      );
      return { kind: 'union', options, nullable: node.nullable };
    }
    case 'object': {
      // The root's name is reserved up front so it always keeps the requested name, even
      // if a nested field happens to want the same hint (it would otherwise win the name
      // first, since nested objects finish resolving before their parent does).
      const reservedName = isRoot ? nameUniquer(sanitizeTypeName(nameHint) || 'Object') : null;

      const fields: NamedField[] = [];
      for (const [key, info] of node.fields) {
        const fieldType = resolveNode(info.type, pascalCase(key) || 'Field', registry, order, signatures, nameUniquer, false);
        fields.push({ jsonKey: key, optional: info.optional, type: fieldType });
      }

      const signature = signatureOf(fields);
      if (!isRoot) {
        const existing = signatures.get(signature);
        if (existing) return { kind: 'ref', name: existing, nullable: node.nullable };
      }

      const name = reservedName ?? nameUniquer(sanitizeTypeName(nameHint) || 'Object');
      registry.set(name, { name, fields });
      order.push(name);
      signatures.set(signature, name);
      return { kind: 'ref', name, nullable: node.nullable };
    }
  }
}

// ------------------------------------------------------------------- TypeScript

function tsTypeName(t: ResolvedType): string {
  let base: string;
  switch (t.kind) {
    case 'ref':
      base = t.name;
      break;
    case 'boolean':
      base = 'boolean';
      break;
    case 'integer':
    case 'float':
      base = 'number';
      break;
    case 'string':
      base = 'string';
      break;
    case 'unknown':
      base = 'unknown';
      break;
    case 'array': {
      const itemStr = tsTypeName(t.item);
      const needsParens = t.item.kind === 'union' || t.item.nullable;
      base = `${needsParens ? `(${itemStr})` : itemStr}[]`;
      break;
    }
    case 'union':
      base = t.options.map(tsTypeName).join(' | ');
      break;
  }
  return t.nullable ? `${base} | null` : base;
}

const TS_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function renderTsObject(obj: NamedObject): string {
  if (obj.fields.length === 0) return `export interface ${obj.name} {}`;
  const lines = obj.fields.map((f) => {
    const keyPart = TS_IDENTIFIER.test(f.jsonKey) ? f.jsonKey : JSON.stringify(f.jsonKey);
    return `  ${keyPart}${f.optional ? '?' : ''}: ${tsTypeName(f.type)};`;
  });
  return `export interface ${obj.name} {\n${lines.join('\n')}\n}`;
}

function renderTypeScript(model: TypeModel): string {
  const parts = model.order.map((name) => renderTsObject(model.objects.get(name)!));
  if (model.root.kind !== 'ref') {
    parts.push(`export type ${model.rootName} = ${tsTypeName(model.root)};`);
  }
  return `${parts.join('\n\n')}\n`;
}

// ------------------------------------------------------------------- Go

function goPointerWorthy(kind: ResolvedType['kind']): boolean {
  return kind === 'ref' || kind === 'boolean' || kind === 'integer' || kind === 'float' || kind === 'string';
}

function goTypeFor(t: ResolvedType): string {
  switch (t.kind) {
    case 'ref':
      return t.name;
    case 'boolean':
      return 'bool';
    case 'integer':
      return 'int64';
    case 'float':
      return 'float64';
    case 'string':
      return 'string';
    case 'unknown':
    case 'union':
      return 'interface{}';
    case 'array': {
      const itemBase = goTypeFor(t.item);
      const item = t.item.nullable && goPointerWorthy(t.item.kind) ? `*${itemBase}` : itemBase;
      return `[]${item}`;
    }
  }
}

function goFieldType(f: NamedField): string {
  const base = goTypeFor(f.type);
  const wantsPointer = (f.optional || f.type.nullable) && goPointerWorthy(f.type.kind);
  return wantsPointer ? `*${base}` : base;
}

function goFieldName(key: string, uniquer: (base: string) => string): string {
  let base = pascalCase(key);
  if (base === '') base = 'Field';
  if (/^[0-9]/.test(base)) base = `F${base}`;
  return uniquer(base);
}

function renderGoObject(obj: NamedObject): string {
  if (obj.fields.length === 0) return `type ${obj.name} struct{}`;
  const uniquer = makeUniquer();
  const lines = obj.fields.map((f) => {
    const name = goFieldName(f.jsonKey, uniquer);
    const typeStr = goFieldType(f);
    const tag = f.optional ? `${f.jsonKey},omitempty` : f.jsonKey;
    return `\t${name} ${typeStr} \`json:"${tag}"\``;
  });
  return `type ${obj.name} struct {\n${lines.join('\n')}\n}`;
}

function renderGo(model: TypeModel): string {
  const parts = model.order.map((name) => renderGoObject(model.objects.get(name)!));
  if (model.root.kind !== 'ref') {
    parts.push(`type ${model.rootName} = ${goTypeFor(model.root)}`);
  }
  return `package main\n\n${parts.join('\n\n')}\n`;
}

// ------------------------------------------------------------------- Rust

interface UsesValueFlag {
  value: boolean;
}

function rustBaseType(t: ResolvedType, flag: UsesValueFlag): string {
  switch (t.kind) {
    case 'ref':
      return t.name;
    case 'boolean':
      return 'bool';
    case 'integer':
      return 'i64';
    case 'float':
      return 'f64';
    case 'string':
      return 'String';
    case 'unknown':
    case 'union':
      flag.value = true;
      return 'serde_json::Value';
    case 'array':
      return `Vec<${rustTypeFor(t.item, flag)}>`;
  }
}

function rustTypeFor(t: ResolvedType, flag: UsesValueFlag): string {
  const base = rustBaseType(t, flag);
  return t.nullable ? `Option<${base}>` : base;
}

/** Optionality and nullability both map to `Option`, so a field that's both never double-wraps. */
function rustFieldType(f: NamedField, flag: UsesValueFlag): string {
  const inner = rustTypeFor(f.type, flag);
  if (!f.optional) return inner;
  return f.type.nullable ? inner : `Option<${inner}>`;
}

const RUST_KEYWORDS = new Set([
  'as', 'break', 'const', 'continue', 'crate', 'dyn', 'else', 'enum', 'extern', 'false', 'fn', 'for', 'if', 'impl',
  'in', 'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return', 'self', 'Self', 'static', 'struct',
  'super', 'trait', 'true', 'type', 'unsafe', 'use', 'where', 'while', 'async', 'await', 'try', 'abstract', 'become',
  'box', 'do', 'final', 'macro', 'override', 'priv', 'typeof', 'unsized', 'virtual', 'yield',
]);

function rustFieldName(key: string, uniquer: (base: string) => string): string {
  let base = snakeCase(key);
  if (base === '') base = 'field';
  if (/^[0-9]/.test(base)) base = `_${base}`;
  if (RUST_KEYWORDS.has(base)) base = `${base}_`;
  return uniquer(base);
}

function renderRustObject(obj: NamedObject, flag: UsesValueFlag): string {
  if (obj.fields.length === 0) {
    return `#[derive(Debug, Clone, Serialize, Deserialize)]\npub struct ${obj.name} {}`;
  }
  const uniquer = makeUniquer();
  const lines = obj.fields.map((f) => {
    const rustName = rustFieldName(f.jsonKey, uniquer);
    const attrs: string[] = [];
    if (rustName !== f.jsonKey) attrs.push(`    #[serde(rename = ${JSON.stringify(f.jsonKey)})]`);
    if (f.optional) attrs.push('    #[serde(default, skip_serializing_if = "Option::is_none")]');
    const typeStr = rustFieldType(f, flag);
    const attrText = attrs.length > 0 ? `${attrs.join('\n')}\n` : '';
    return `${attrText}    pub ${rustName}: ${typeStr},`;
  });
  return `#[derive(Debug, Clone, Serialize, Deserialize)]\npub struct ${obj.name} {\n${lines.join('\n')}\n}`;
}

function renderRust(model: TypeModel): string {
  const flag: UsesValueFlag = { value: false };
  const objectBlocks = model.order.map((name) => renderRustObject(model.objects.get(name)!, flag));
  if (model.root.kind !== 'ref') {
    objectBlocks.push(`pub type ${model.rootName} = ${rustTypeFor(model.root, flag)};`);
  }
  const header = flag.value
    ? 'use serde::{Deserialize, Serialize};\nuse serde_json::Value;'
    : 'use serde::{Deserialize, Serialize};';
  return `${header}\n\n${objectBlocks.join('\n\n')}\n`;
}

// ------------------------------------------------------------------- Python

function pyTypeFor(t: ResolvedType): string {
  let base: string;
  switch (t.kind) {
    case 'ref':
      base = t.name;
      break;
    case 'boolean':
      base = 'bool';
      break;
    case 'integer':
      base = 'int';
      break;
    case 'float':
      base = 'float';
      break;
    case 'string':
      base = 'str';
      break;
    case 'unknown':
      base = 'Any';
      break;
    case 'array':
      base = `List[${pyTypeFor(t.item)}]`;
      break;
    case 'union':
      base = `Union[${t.options.map(pyTypeFor).join(', ')}]`;
      break;
  }
  return t.nullable ? `Optional[${base}]` : base;
}

function renderPythonObject(obj: NamedObject): string {
  if (obj.fields.length === 0) return `${obj.name} = TypedDict("${obj.name}", {})`;
  const lines = obj.fields.map((f) => {
    const typeStr = pyTypeFor(f.type);
    const wrapped = f.optional ? `NotRequired[${typeStr}]` : typeStr;
    return `        ${JSON.stringify(f.jsonKey)}: ${wrapped},`;
  });
  // A functional-syntax TypedDict is used (rather than the class form) because it works
  // for every JSON key unconditionally — including ones that aren't valid Python
  // identifiers or that collide with keywords — with no field-name sanitization needed.
  return `${obj.name} = TypedDict(\n    "${obj.name}",\n    {\n${lines.join('\n')}\n    },\n)`;
}

function renderPython(model: TypeModel): string {
  const parts = model.order.map((name) => renderPythonObject(model.objects.get(name)!));
  if (model.root.kind !== 'ref') {
    parts.push(`${model.rootName} = ${pyTypeFor(model.root)}`);
  }
  const header = 'from __future__ import annotations\nfrom typing import Any, List, NotRequired, Optional, TypedDict, Union';
  return `${header}\n\n${parts.join('\n\n')}\n`;
}

// ------------------------------------------------------------------- C#

interface CsFlags {
  usesJsonElement: boolean;
}

function csBaseType(t: ResolvedType, flags: CsFlags): string {
  switch (t.kind) {
    case 'ref':
      return t.name;
    case 'boolean':
      return 'bool';
    case 'integer':
      return 'long';
    case 'float':
      return 'double';
    case 'string':
      return 'string';
    case 'unknown':
    case 'union':
      flags.usesJsonElement = true;
      return 'JsonElement';
    case 'array':
      return `List<${csTypeFor(t.item, flags)}>`;
  }
}

function csTypeFor(t: ResolvedType, flags: CsFlags): string {
  const base = csBaseType(t, flags);
  return t.nullable ? `${base}?` : base;
}

/** Optionality and nullability are both represented with `?`, so a field that's both never double-marks. */
function csFieldType(f: NamedField, flags: CsFlags): string {
  const inner = csTypeFor(f.type, flags);
  if (!f.optional) return inner;
  return f.type.nullable ? inner : `${inner}?`;
}

/** A reference-typed, non-nullable property needs an explicit default under `#nullable enable`. */
function csDefaultFor(f: NamedField): string {
  if (f.type.nullable || f.optional) return '';
  switch (f.type.kind) {
    case 'string':
      return ' = string.Empty;';
    case 'ref':
    case 'array':
      return ' = new();';
    default:
      return '';
  }
}

function renderCsObject(obj: NamedObject, flags: CsFlags): string {
  if (obj.fields.length === 0) return `public class ${obj.name}\n{\n}`;
  const uniquer = makeUniquer();
  const properties = obj.fields.map((f) => {
    let base = pascalCase(f.jsonKey);
    if (base === '') base = 'Field';
    if (/^[0-9]/.test(base)) base = `P${base}`;
    const propertyName = uniquer(base);
    const typeStr = csFieldType(f, flags);
    return `    [JsonPropertyName(${JSON.stringify(f.jsonKey)})]\n    public ${typeStr} ${propertyName} { get; set; }${csDefaultFor(f)}`;
  });
  return `public class ${obj.name}\n{\n${properties.join('\n\n')}\n}`;
}

function renderCSharp(model: TypeModel): string {
  const flags: CsFlags = { usesJsonElement: false };
  const classBlocks = model.order.map((name) => renderCsObject(model.objects.get(name)!, flags));
  const rootAlias = model.root.kind !== 'ref' ? `using ${model.rootName} = ${csTypeFor(model.root, flags)};` : null;

  const usings = ['using System.Collections.Generic;', 'using System.Text.Json.Serialization;'];
  if (flags.usesJsonElement) usings.push('using System.Text.Json;');
  if (rootAlias) usings.push(rootAlias);

  const body = classBlocks.filter((block) => block !== '').join('\n\n');
  return body ? `#nullable enable\n\n${usings.join('\n')}\n\n${body}\n` : `#nullable enable\n\n${usings.join('\n')}\n`;
}

// ------------------------------------------------------------------- Java

interface JavaFlags {
  usesJsonNode: boolean;
  usesList: boolean;
}

const JAVA_KEYWORDS = new Set([
  'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class', 'const', 'continue', 'default',
  'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements', 'import',
  'instanceof', 'int', 'interface', 'long', 'native', 'new', 'package', 'private', 'protected', 'public', 'return',
  'short', 'static', 'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try',
  'void', 'volatile', 'while', 'var', 'record', 'yield', 'sealed', 'permits', 'true', 'false', 'null',
]);

function javaPrimitiveEligible(kind: ResolvedType['kind']): boolean {
  return kind === 'boolean' || kind === 'integer' || kind === 'float';
}

/** Java generics can never hold a primitive, so a list element is always boxed regardless of nullability. */
function javaBoxedType(t: ResolvedType, flags: JavaFlags): string {
  switch (t.kind) {
    case 'boolean':
      return 'Boolean';
    case 'integer':
      return 'Long';
    case 'float':
      return 'Double';
    case 'array':
      flags.usesList = true;
      return `List<${javaBoxedType(t.item, flags)}>`;
    default:
      return javaBaseType(t, flags);
  }
}

function javaBaseType(t: ResolvedType, flags: JavaFlags): string {
  switch (t.kind) {
    case 'ref':
      return t.name;
    case 'boolean':
      return 'boolean';
    case 'integer':
      return 'long';
    case 'float':
      return 'double';
    case 'string':
      return 'String';
    case 'unknown':
    case 'union':
      flags.usesJsonNode = true;
      return 'JsonNode';
    case 'array':
      flags.usesList = true;
      return `List<${javaBoxedType(t.item, flags)}>`;
  }
}

/** A primitive field that's optional or nullable needs its boxed wrapper, since only a reference type can be null. */
function javaFieldType(f: NamedField, flags: JavaFlags): string {
  const base = javaBaseType(f.type, flags);
  if (!(f.optional || f.type.nullable) || !javaPrimitiveEligible(f.type.kind)) return base;
  return f.type.kind === 'boolean' ? 'Boolean' : f.type.kind === 'integer' ? 'Long' : 'Double';
}

function javaFieldName(key: string, uniquer: (base: string) => string): string {
  let base = camelCase(key);
  if (base === '') base = 'field';
  if (/^[0-9]/.test(base)) base = `_${base}`;
  if (JAVA_KEYWORDS.has(base)) base = `${base}_`;
  return uniquer(base);
}

function renderJavaObject(obj: NamedObject, flags: JavaFlags): string {
  if (obj.fields.length === 0) return `public class ${obj.name} {\n}`;
  const uniquer = makeUniquer();
  const resolved = obj.fields.map((f) => ({
    fieldName: javaFieldName(f.jsonKey, uniquer),
    typeStr: javaFieldType(f, flags),
    jsonKey: f.jsonKey,
  }));

  const fieldBlock = resolved
    .map((f) => `    @JsonProperty(${JSON.stringify(f.jsonKey)})\n    private ${f.typeStr} ${f.fieldName};`)
    .join('\n\n');

  const methodBlock = resolved
    .map((f) => {
      const capitalized = f.fieldName[0]!.toUpperCase() + f.fieldName.slice(1);
      // A boolean field already named like "isActive" keeps that as its own getter (`isActive()`)
      // rather than the doubled-up "isIsActive()" the generic is+Capitalized rule would produce.
      const getterName = f.typeStr !== 'boolean' ? `get${capitalized}` : /^is[A-Z]/.test(f.fieldName) ? f.fieldName : `is${capitalized}`;
      return [
        `    public ${f.typeStr} ${getterName}() {`,
        `        return ${f.fieldName};`,
        `    }`,
        '',
        `    public void set${capitalized}(${f.typeStr} ${f.fieldName}) {`,
        `        this.${f.fieldName} = ${f.fieldName};`,
        `    }`,
      ].join('\n');
    })
    .join('\n\n');

  return `public class ${obj.name} {\n${fieldBlock}\n\n${methodBlock}\n}`;
}

function renderJava(model: TypeModel): string {
  const flags: JavaFlags = { usesJsonNode: false, usesList: false };
  const classBlocks = model.order.map((name) => renderJavaObject(model.objects.get(name)!, flags));
  const parts = [...classBlocks];
  const rootTypeComment =
    model.root.kind !== 'ref'
      ? `// Java has no top-level type-alias syntax, so ${model.rootName} is left as: ${javaBaseType(model.root, flags)}`
      : null;
  if (rootTypeComment) parts.push(rootTypeComment);

  const imports = ['import com.fasterxml.jackson.annotation.JsonProperty;'];
  if (flags.usesJsonNode) imports.push('import com.fasterxml.jackson.databind.JsonNode;');
  if (flags.usesList) imports.push('import java.util.List;');

  return `${imports.join('\n')}\n\n${parts.join('\n\n')}\n`;
}

// ------------------------------------------------------------------- Kotlin

interface KotlinFlags {
  usesJsonElement: boolean;
  usesSerialName: boolean;
}

const KOTLIN_KEYWORDS = new Set([
  'as', 'break', 'class', 'continue', 'do', 'else', 'false', 'for', 'fun', 'if', 'in', 'interface', 'is', 'null',
  'object', 'package', 'return', 'super', 'this', 'throw', 'true', 'try', 'typealias', 'typeof', 'val', 'var',
  'when', 'while',
]);

function kotlinBaseType(t: ResolvedType, flags: KotlinFlags): string {
  switch (t.kind) {
    case 'ref':
      return t.name;
    case 'boolean':
      return 'Boolean';
    case 'integer':
      return 'Long';
    case 'float':
      return 'Double';
    case 'string':
      return 'String';
    case 'unknown':
    case 'union':
      flags.usesJsonElement = true;
      return 'JsonElement';
    case 'array':
      return `List<${kotlinTypeFor(t.item, flags)}>`;
  }
}

function kotlinTypeFor(t: ResolvedType, flags: KotlinFlags): string {
  const base = kotlinBaseType(t, flags);
  return t.nullable ? `${base}?` : base;
}

/** Optionality and nullability both become `?` with a `null` default, so a field that's both never double-marks. */
function kotlinFieldType(f: NamedField, flags: KotlinFlags): string {
  const inner = kotlinTypeFor(f.type, flags);
  if (!f.optional) return inner;
  return f.type.nullable ? inner : `${inner}?`;
}

function renderKotlinObject(obj: NamedObject, flags: KotlinFlags): string {
  // A data class needs at least one constructor property; a genuinely empty shape is
  // better modelled as a Kotlin `object` (a singleton with no properties) than forced
  // into an invalid `data class X()`.
  if (obj.fields.length === 0) return `@Serializable\nobject ${obj.name}`;

  const uniquer = makeUniquer();
  const lines = obj.fields.map((f) => {
    let base = camelCase(f.jsonKey);
    if (base === '') base = 'field';
    if (/^[0-9]/.test(base)) base = `_${base}`;
    if (KOTLIN_KEYWORDS.has(base)) base = `${base}_`;
    const name = uniquer(base);

    const typeStr = kotlinFieldType(f, flags);
    const needsDefault = f.optional || f.type.nullable;
    const suffix = needsDefault ? ' = null' : '';

    if (name === f.jsonKey) return `    val ${name}: ${typeStr}${suffix},`;
    flags.usesSerialName = true;
    return `    @SerialName(${JSON.stringify(f.jsonKey)})\n    val ${name}: ${typeStr}${suffix},`;
  });

  return `@Serializable\ndata class ${obj.name}(\n${lines.join('\n')}\n)`;
}

function renderKotlin(model: TypeModel): string {
  const flags: KotlinFlags = { usesJsonElement: false, usesSerialName: false };
  const classBlocks = model.order.map((name) => renderKotlinObject(model.objects.get(name)!, flags));
  const parts = [...classBlocks];
  if (model.root.kind !== 'ref') {
    parts.push(`typealias ${model.rootName} = ${kotlinTypeFor(model.root, flags)}`);
  }

  const imports = ['import kotlinx.serialization.Serializable'];
  if (flags.usesSerialName) imports.push('import kotlinx.serialization.SerialName');
  if (flags.usesJsonElement) imports.push('import kotlinx.serialization.json.JsonElement');

  return `${imports.join('\n')}\n\n${parts.join('\n\n')}\n`;
}

// ------------------------------------------------------------------- Swift

interface SwiftFlags {
  usesAnyCodable: boolean;
}

const SWIFT_KEYWORDS = new Set([
  'associatedtype', 'class', 'deinit', 'enum', 'extension', 'fileprivate', 'func', 'import', 'init', 'inout',
  'internal', 'let', 'open', 'operator', 'private', 'protocol', 'public', 'rethrows', 'static', 'struct',
  'subscript', 'typealias', 'var', 'break', 'case', 'continue', 'default', 'defer', 'do', 'else', 'fallthrough',
  'for', 'guard', 'if', 'in', 'repeat', 'return', 'switch', 'where', 'while', 'as', 'Any', 'catch', 'false', 'is',
  'nil', 'super', 'self', 'Self', 'throw', 'throws', 'true', 'try',
]);

/**
 * A small, self-contained `Codable` box for "any JSON value" — the same role Go's
 * `interface{}`, Rust's `serde_json::Value` and Java's `JsonNode` play — inlined directly
 * into the output rather than pulled in as a package dependency, since Swift's standard
 * library has no equivalent and the community `AnyCodable` package isn't guaranteed to be
 * in every project.
 */
const SWIFT_ANY_CODABLE = `struct AnyCodable: Codable {
    let value: Any

    init(_ value: Any) {
        self.value = value
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let intVal = try? container.decode(Int.self) {
            value = intVal
        } else if let doubleVal = try? container.decode(Double.self) {
            value = doubleVal
        } else if let boolVal = try? container.decode(Bool.self) {
            value = boolVal
        } else if let stringVal = try? container.decode(String.self) {
            value = stringVal
        } else if let arrayVal = try? container.decode([AnyCodable].self) {
            value = arrayVal.map { $0.value }
        } else if let dictVal = try? container.decode([String: AnyCodable].self) {
            value = dictVal.mapValues { $0.value }
        } else {
            value = ()
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case let intVal as Int: try container.encode(intVal)
        case let doubleVal as Double: try container.encode(doubleVal)
        case let boolVal as Bool: try container.encode(boolVal)
        case let stringVal as String: try container.encode(stringVal)
        case let arrayVal as [Any]: try container.encode(arrayVal.map { AnyCodable($0) })
        case let dictVal as [String: Any]: try container.encode(dictVal.mapValues { AnyCodable($0) })
        default: try container.encodeNil()
        }
    }
}`;

function swiftBaseType(t: ResolvedType, flags: SwiftFlags): string {
  switch (t.kind) {
    case 'ref':
      return t.name;
    case 'boolean':
      return 'Bool';
    case 'integer':
      return 'Int';
    case 'float':
      return 'Double';
    case 'string':
      return 'String';
    case 'unknown':
    case 'union':
      flags.usesAnyCodable = true;
      return 'AnyCodable';
    case 'array':
      return `[${swiftTypeFor(t.item, flags)}]`;
  }
}

function swiftTypeFor(t: ResolvedType, flags: SwiftFlags): string {
  const base = swiftBaseType(t, flags);
  return t.nullable ? `${base}?` : base;
}

function swiftFieldType(f: NamedField, flags: SwiftFlags): string {
  const inner = swiftTypeFor(f.type, flags);
  if (!f.optional) return inner;
  return f.type.nullable ? inner : `${inner}?`;
}

function renderSwiftObject(obj: NamedObject, flags: SwiftFlags): string {
  if (obj.fields.length === 0) return `struct ${obj.name}: Codable {}`;

  const uniquer = makeUniquer();
  const resolved = obj.fields.map((f) => {
    let base = camelCase(f.jsonKey);
    if (base === '') base = 'field';
    if (/^[0-9]/.test(base)) base = `_${base}`;
    const propertyName = uniquer(base);
    // Swift lets a keyword be used as an identifier by backtick-escaping it, which is the
    // idiomatic way to handle a JSON key like "class" or "self" rather than renaming it.
    const declaredName = SWIFT_KEYWORDS.has(propertyName) ? `\`${propertyName}\`` : propertyName;
    return { propertyName, declaredName, typeStr: swiftFieldType(f, flags), jsonKey: f.jsonKey };
  });

  const propertyLines = resolved.map((f) => `    let ${f.declaredName}: ${f.typeStr}`);

  // Swift's synthesized Codable conformance maps a property directly to a same-named JSON
  // key, so a CodingKeys enum is only needed — and only added — when at least one property
  // name actually differs from its JSON key; once present, though, it must list every case.
  const needsCodingKeys = resolved.some((f) => f.propertyName !== f.jsonKey);
  let codingKeysBlock = '';
  if (needsCodingKeys) {
    const cases = resolved.map((f) =>
      f.propertyName === f.jsonKey
        ? `        case ${f.declaredName}`
        : `        case ${f.declaredName} = ${JSON.stringify(f.jsonKey)}`
    );
    codingKeysBlock = `\n\n    enum CodingKeys: String, CodingKey {\n${cases.join('\n')}\n    }`;
  }

  return `struct ${obj.name}: Codable {\n${propertyLines.join('\n')}${codingKeysBlock}\n}`;
}

function renderSwift(model: TypeModel): string {
  const flags: SwiftFlags = { usesAnyCodable: false };
  const structBlocks = model.order.map((name) => renderSwiftObject(model.objects.get(name)!, flags));
  const parts = [...structBlocks];
  if (model.root.kind !== 'ref') {
    parts.push(`typealias ${model.rootName} = ${swiftTypeFor(model.root, flags)}`);
  }

  const header = flags.usesAnyCodable ? `import Foundation\n\n${SWIFT_ANY_CODABLE}` : 'import Foundation';
  return `${header}\n\n${parts.join('\n\n')}\n`;
}

// ------------------------------------------------------------------- entry point

export type SourceFormat = 'json' | 'xml';

export const SOURCE_FORMATS: SourceFormat[] = ['json', 'xml'];

export const SOURCE_FORMAT_LABELS: Record<SourceFormat, string> = {
  json: 'JSON',
  xml: 'XML',
};

/**
 * Shared by both entry points once their input has already been parsed into a plain JS
 * value: validates the root shape, infers and names the type tree, and renders it for the
 * requested language.
 */
function generateTypesFromValue(value: unknown, language: Language, rootName: string): ToolResult<string> {
  if (value === null || typeof value !== 'object') {
    return err(
      'The root value must be an object or an array — a plain string, number, boolean or null has no fields to generate a type from.'
    );
  }

  let root: TypeNode;
  try {
    root = inferType(value);
  } catch (error) {
    if (error instanceof DepthExceededError) {
      return err(`This is nested too deeply to convert (more than ${MAX_DEPTH} levels).`);
    }
    throw error;
  }

  const registry = new Map<string, NamedObject>();
  const order: string[] = [];
  const signatures = new Map<string, string>();
  const nameUniquer = makeUniquer();
  const safeRootName = sanitizeTypeName(rootName) || DEFAULT_ROOT_NAME;
  const resolvedRoot = resolveNode(root, safeRootName, registry, order, signatures, nameUniquer, true);
  const model: TypeModel = { rootName: safeRootName, order, objects: registry, root: resolvedRoot };

  switch (language) {
    case 'typescript':
      return ok(renderTypeScript(model));
    case 'go':
      return ok(renderGo(model));
    case 'rust':
      return ok(renderRust(model));
    case 'python':
      return ok(renderPython(model));
    case 'csharp':
      return ok(renderCSharp(model));
    case 'java':
      return ok(renderJava(model));
    case 'kotlin':
      return ok(renderKotlin(model));
    case 'swift':
      return ok(renderSwift(model));
  }
}

/**
 * Generates type/struct definitions for the given language from a JSON sample.
 *
 * Optionality (a key missing from some sample) and nullability (a key present but `null`)
 * are tracked separately and rendered with each language's own idiom — see the FAQ in this
 * tool's content page for exactly how each target represents them.
 */
export function generateTypesFromJson(input: string, language: Language, rootName: string = DEFAULT_ROOT_NAME): ToolResult<string> {
  if (input.trim() === '') return err('Paste some JSON first.');
  if (input.length > MAX_INPUT_LENGTH) {
    return err(
      `Input is too large to convert in the browser (${input.length.toLocaleString()} characters, limit ${MAX_INPUT_LENGTH.toLocaleString()}).`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (error) {
    return err(messageFrom(error, 'That is not valid JSON.'));
  }

  return generateTypesFromValue(parsed, language, rootName);
}

/**
 * Generates type/struct definitions from an XML document, by first converting it to a
 * plain JS value with this codebase's documented XML<->JSON convention (the same one
 * `xmlToJson` uses for the Data Format Converter): attributes become `@name` keys, text
 * alongside them goes under `#text`, and the document's one root element becomes the single
 * top-level key — so `<person><name>Ada</name></person>` produces a `Root` type with a
 * `person` field, not a `Person` type directly. That's a deliberate consistency choice: a
 * visitor who has already used the XML converter sees the exact same shape here.
 */
export function generateTypesFromXml(input: string, language: Language, rootName: string = DEFAULT_ROOT_NAME): ToolResult<string> {
  const parsed = xmlToJson(input);
  if (!parsed.ok) return parsed;

  return generateTypesFromValue(parsed.value, language, rootName);
}
