import { describe, it, expect } from 'vitest';
import { generateTypesFromJson, generateTypesFromXml, MAX_INPUT_LENGTH } from './jsonToTypes';

function generate(input: string, language: Parameters<typeof generateTypesFromJson>[1], rootName?: string) {
  const result = generateTypesFromJson(input, language, rootName);
  if (!result.ok) throw new Error(`expected success, got error: ${result.error}`);
  return result.value;
}

function generateFromXml(input: string, language: Parameters<typeof generateTypesFromXml>[1], rootName?: string) {
  const result = generateTypesFromXml(input, language, rootName);
  if (!result.ok) throw new Error(`expected success, got error: ${result.error}`);
  return result.value;
}

describe('generateTypesFromJson', () => {
  describe('input validation', () => {
    it('rejects empty input', () => {
      const result = generateTypesFromJson('', 'typescript');
      expect(result.ok).toBe(false);
    });

    it('rejects whitespace-only input', () => {
      const result = generateTypesFromJson('   \n  ', 'typescript');
      expect(result.ok).toBe(false);
    });

    it('rejects malformed JSON with a readable message', () => {
      const result = generateTypesFromJson('{ "a": }', 'typescript');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
    });

    it('rejects a root string', () => {
      const result = generateTypesFromJson('"just a string"', 'typescript');
      expect(result.ok).toBe(false);
    });

    it('rejects a root number', () => {
      const result = generateTypesFromJson('42', 'typescript');
      expect(result.ok).toBe(false);
    });

    it('rejects a root boolean', () => {
      const result = generateTypesFromJson('true', 'typescript');
      expect(result.ok).toBe(false);
    });

    it('rejects a root null', () => {
      const result = generateTypesFromJson('null', 'typescript');
      expect(result.ok).toBe(false);
    });

    it('rejects input over the size limit', () => {
      const huge = `{"a": "${'x'.repeat(MAX_INPUT_LENGTH)}"}`;
      const result = generateTypesFromJson(huge, 'typescript');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/too large/i);
    });

    it('rejects pathologically deep nesting', () => {
      let json = '0';
      for (let i = 0; i < 1000; i += 1) json = `[${json}]`;
      const result = generateTypesFromJson(json, 'typescript');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/nested too deeply/i);
    });
  });

  describe('TypeScript', () => {
    it('generates a flat interface', () => {
      const out = generate('{"name": "Ada", "age": 36, "active": true}', 'typescript');
      expect(out).toContain('export interface Root {');
      expect(out).toContain('name: string;');
      expect(out).toContain('age: number;');
      expect(out).toContain('active: boolean;');
    });

    it('names a nested object type after its field', () => {
      const out = generate('{"address": {"city": "NYC", "zip": "10001"}}', 'typescript');
      expect(out).toContain('export interface Address {');
      expect(out).toContain('city: string;');
      expect(out).toContain('address: Address;');
    });

    it('singularizes an array field name for the element type', () => {
      const out = generate('{"tags": [{"label": "x"}]}', 'typescript');
      expect(out).toContain('export interface Tag {');
      expect(out).toContain('tags: Tag[];');
    });

    it('marks a key missing from some array elements as optional', () => {
      const out = generate('{"items": [{"a": 1, "b": 2}, {"a": 3}]}', 'typescript');
      expect(out).toMatch(/b\?: number;/);
      expect(out).toMatch(/a: number;/);
    });

    it('marks a null-valued field as nullable, not optional', () => {
      const out = generate('{"middleName": null}', 'typescript');
      expect(out).toContain('middleName: unknown | null;');
    });

    it('marks a field that is sometimes null as nullable, not just optional', () => {
      const out = generate('{"items": [{"a": "x"}, {"a": null}]}', 'typescript');
      expect(out).toMatch(/a: string \| null;/);
    });

    it('quotes an object key that is not a valid identifier', () => {
      const out = generate('{"foo-bar": 1, "123abc": 2}', 'typescript');
      expect(out).toContain('"foo-bar": number;');
      expect(out).toContain('"123abc": number;');
    });

    it('renders a root array of primitives as a type alias', () => {
      const out = generate('["a", "b", "c"]', 'typescript');
      expect(out).toContain('export type Root = string[];');
    });

    it('renders a root array of objects as an interface plus alias', () => {
      const out = generate('[{"id": 1}, {"id": 2}]', 'typescript');
      expect(out).toContain('export interface RootItem {');
      expect(out).toContain('id: number;');
      expect(out).toContain('export type Root = RootItem[];');
    });

    it('renders a mixed-type array as a union', () => {
      const out = generate('{"values": [1, "two", true]}', 'typescript');
      expect(out).toMatch(/values: \(number \| string \| boolean\)\[\];/);
    });

    it('deduplicates two structurally identical nested objects into one named type', () => {
      const out = generate(
        '{"billing": {"city": "NYC", "zip": "1"}, "shipping": {"city": "LA", "zip": "2"}}',
        'typescript'
      );
      const interfaceCount = (out.match(/export interface/g) ?? []).length;
      expect(interfaceCount).toBe(2); // Root + one shared address-shaped type
      expect(out).toMatch(/billing: \w+;/);
      expect(out).toMatch(/shipping: \w+;/);
    });

    it('handles an empty object', () => {
      const out = generate('{}', 'typescript');
      expect(out).toContain('export interface Root {}');
    });

    it('handles an empty array', () => {
      const out = generate('[]', 'typescript');
      expect(out).toContain('export type Root = unknown[];');
    });

    it('uses a custom root type name', () => {
      const out = generate('{"a": 1}', 'typescript', 'ApiResponse');
      expect(out).toContain('export interface ApiResponse {');
    });

    it('sanitizes an invalid custom root name', () => {
      const out = generate('{"a": 1}', 'typescript', '123 bad name!');
      expect(out).toMatch(/export interface T?\w+ \{/);
    });

    it('handles unicode string values without affecting field types', () => {
      const out = generate('{"greeting": "こんにちは"}', 'typescript');
      expect(out).toContain('greeting: string;');
    });

    it('falls back to a safe field name for a key with no identifier characters', () => {
      const out = generate('{"!!!": 1}', 'typescript');
      expect(out).toContain('"!!!": number;');
    });
  });

  describe('Go', () => {
    it('generates a package and struct with json tags', () => {
      const out = generate('{"name": "Ada", "age": 36}', 'go');
      expect(out).toContain('package main');
      expect(out).toContain('type Root struct {');
      expect(out).toMatch(/Name string `json:"name"`/);
      expect(out).toMatch(/Age int64 `json:"age"`/);
    });

    it('uses a float type when any sample value is non-integer', () => {
      const out = generate('{"values": [{"score": 1}, {"score": 1.5}]}', 'go');
      expect(out).toMatch(/Score float64 `json:"score"`/);
    });

    it('pointer-wraps and adds omitempty for an optional field', () => {
      const out = generate('{"items": [{"a": 1}, {}]}', 'go');
      expect(out).toMatch(/A \*int64 `json:"a,omitempty"`/);
    });

    it('does not pointer-wrap a nullable slice, since nil already represents it', () => {
      const out = generate('{"tags": null}', 'go');
      expect(out).not.toMatch(/\*\[\]/);
    });

    it('renames a Go field to PascalCase and keeps the original key in the tag', () => {
      const out = generate('{"foo-bar": 1}', 'go');
      expect(out).toMatch(/FooBar int64 `json:"foo-bar"`/);
    });

    it('deduplicates colliding sanitized field names within one struct', () => {
      const out = generate('{"foo-bar": 1, "foo_bar": 2}', 'go');
      expect(out).toMatch(/FooBar int64 `json:"foo-bar"`/);
      expect(out).toMatch(/FooBar2 int64 `json:"foo_bar"`/);
    });

    it('renders a root array as a type alias', () => {
      const out = generate('["a", "b"]', 'go');
      expect(out).toContain('type Root = []string');
    });

    it('handles an empty object', () => {
      const out = generate('{}', 'go');
      expect(out).toContain('type Root struct{}');
    });
  });

  describe('Rust', () => {
    it('generates a struct with serde derives', () => {
      const out = generate('{"name": "Ada", "age": 36}', 'rust');
      expect(out).toContain('use serde::{Deserialize, Serialize};');
      expect(out).toContain('#[derive(Debug, Clone, Serialize, Deserialize)]');
      expect(out).toContain('pub struct Root {');
      expect(out).toMatch(/pub name: String,/);
      expect(out).toMatch(/pub age: i64,/);
    });

    it('wraps an optional field in Option and adds skip_serializing_if', () => {
      const out = generate('{"items": [{"a": 1}, {}]}', 'rust');
      expect(out).toMatch(/#\[serde\(default, skip_serializing_if = "Option::is_none"\)\]\s*\n\s*pub a: Option<i64>,/);
    });

    it('renames a snake_case field and adds a serde rename attribute when the key differs', () => {
      const out = generate('{"fooBar": 1}', 'rust');
      expect(out).toContain('#[serde(rename = "fooBar")]');
      expect(out).toMatch(/pub foo_bar: i64,/);
    });

    it('escapes a Rust keyword used as a JSON key', () => {
      const out = generate('{"type": "x"}', 'rust');
      expect(out).toMatch(/pub type_: String,/);
      expect(out).toContain('#[serde(rename = "type")]');
    });

    it('degrades a mixed-type array to serde_json::Value and imports it', () => {
      const out = generate('{"values": [1, "two"]}', 'rust');
      expect(out).toContain('use serde_json::Value;');
      expect(out).toMatch(/pub values: Vec<serde_json::Value>,/);
    });

    it('does not import serde_json::Value when it is not needed', () => {
      const out = generate('{"name": "Ada"}', 'rust');
      expect(out).not.toContain('serde_json');
    });
  });

  describe('Python', () => {
    it('generates a functional TypedDict', () => {
      const out = generate('{"name": "Ada", "age": 36}', 'python');
      expect(out).toContain('from __future__ import annotations');
      expect(out).toContain('Root = TypedDict(');
      expect(out).toContain('"name": str,');
      expect(out).toContain('"age": int,');
    });

    it('wraps an optional field in NotRequired', () => {
      const out = generate('{"items": [{"a": 1}, {}]}', 'python');
      expect(out).toMatch(/"a": NotRequired\[int\],/);
    });

    it('wraps a nullable field in Optional', () => {
      const out = generate('{"items": [{"a": "x"}, {"a": null}]}', 'python');
      expect(out).toMatch(/"a": Optional\[str\],/);
    });

    it('keeps a non-identifier key as a raw string with no sanitization', () => {
      const out = generate('{"foo-bar": 1, "class": 2}', 'python');
      expect(out).toContain('"foo-bar": int,');
      expect(out).toContain('"class": int,');
    });

    it('renders a root array of objects as a List type alias', () => {
      const out = generate('[{"id": 1}]', 'python');
      expect(out).toContain('RootItem = TypedDict(');
      expect(out).toContain('Root = List[RootItem]');
    });

    it('renders a mixed-type array as Union', () => {
      const out = generate('{"values": [1, "two"]}', 'python');
      expect(out).toMatch(/"values": List\[Union\[int, str\]\],/);
    });
  });

  describe('C#', () => {
    it('generates a class with JsonPropertyName attributes', () => {
      const out = generate('{"name": "Ada", "age": 36}', 'csharp');
      expect(out).toContain('#nullable enable');
      expect(out).toContain('public class Root');
      expect(out).toMatch(/\[JsonPropertyName\("name"\)\]\s*\n\s*public string Name { get; set; } = string.Empty;/);
      expect(out).toMatch(/\[JsonPropertyName\("age"\)\]\s*\n\s*public long Age { get; set; }/);
    });

    it('uses a float type when any sample value is non-integer', () => {
      const out = generate('{"values": [{"score": 1}, {"score": 1.5}]}', 'csharp');
      expect(out).toMatch(/public double Score { get; set; }/);
    });

    it('marks an optional field nullable with ? and no default', () => {
      const out = generate('{"items": [{"a": 1}, {}]}', 'csharp');
      expect(out).toMatch(/public long\? A { get; set; }\s*$/m);
    });

    it('marks a nullable reference field with ? instead of a default', () => {
      const out = generate('{"name": null}', 'csharp');
      expect(out).not.toContain('string.Empty');
    });

    it('defaults a non-nullable nested object and list to new()', () => {
      const out = generate('{"address": {"city": "NYC"}, "tags": ["a"]}', 'csharp');
      expect(out).toMatch(/public Address Address { get; set; } = new\(\);/);
      expect(out).toMatch(/public List<string> Tags { get; set; } = new\(\);/);
    });

    it('degrades a mixed-type array to JsonElement and imports System.Text.Json', () => {
      const out = generate('{"values": [1, "two"]}', 'csharp');
      expect(out).toContain('using System.Text.Json;');
      expect(out).toMatch(/public List<JsonElement> Values { get; set; } = new\(\);/);
    });

    it('does not import System.Text.Json when JsonElement is not needed', () => {
      const out = generate('{"name": "Ada"}', 'csharp');
      expect(out).not.toContain('using System.Text.Json;');
    });

    it('renders a root array of primitives as a using alias', () => {
      const out = generate('["a", "b"]', 'csharp');
      expect(out).toContain('using Root = List<string>;');
    });

    it('handles an empty object', () => {
      const out = generate('{}', 'csharp');
      expect(out).toContain('public class Root\n{\n}');
    });
  });

  describe('Java', () => {
    it('generates a class with a private field, JsonProperty annotation and getter/setter', () => {
      const out = generate('{"name": "Ada", "age": 36}', 'java');
      expect(out).toContain('import com.fasterxml.jackson.annotation.JsonProperty;');
      expect(out).toContain('public class Root {');
      expect(out).toMatch(/@JsonProperty\("name"\)\s*\n\s*private String name;/);
      expect(out).toMatch(/public String getName\(\) {/);
      expect(out).toMatch(/public void setName\(String name\) {/);
    });

    it('uses a float type when any sample value is non-integer', () => {
      const out = generate('{"values": [{"score": 1}, {"score": 1.5}]}', 'java');
      expect(out).toMatch(/private double score;/);
    });

    it('boxes an optional or nullable primitive field', () => {
      const out = generate('{"items": [{"a": 1}, {}]}', 'java');
      expect(out).toMatch(/private Long a;/);
      expect(out).toMatch(/public Long getA\(\) {/);
    });

    it('always boxes primitives inside a List, regardless of nullability', () => {
      const out = generate('{"scores": [1, 2, 3]}', 'java');
      expect(out).toContain('private List<Long> scores;');
    });

    it('uses isXxx() for a boolean field, without doubling an existing is-prefixed name', () => {
      const out = generate('{"active": true, "isActive": true}', 'java');
      expect(out).toMatch(/public boolean isActive\(\) {/);
      expect(out).not.toMatch(/isIsActive/);
    });

    it('renames a Java field to camelCase and keeps the original key in the annotation', () => {
      const out = generate('{"foo-bar": 1}', 'java');
      expect(out).toContain('@JsonProperty("foo-bar")');
      expect(out).toMatch(/private long fooBar;/);
    });

    it('escapes a Java keyword used as a JSON key', () => {
      const out = generate('{"class": "x"}', 'java');
      expect(out).toContain('@JsonProperty("class")');
      expect(out).toMatch(/private String class_;/);
      expect(out).not.toMatch(/getClass\(\)/);
    });

    it('degrades a mixed-type array to JsonNode and imports it', () => {
      const out = generate('{"values": [1, "two"]}', 'java');
      expect(out).toContain('import com.fasterxml.jackson.databind.JsonNode;');
      expect(out).toMatch(/private List<JsonNode> values;/);
    });

    it('does not import JsonNode or List when neither is needed', () => {
      const out = generate('{"name": "Ada"}', 'java');
      expect(out).not.toContain('JsonNode');
      expect(out).not.toContain('java.util.List');
    });

    it('handles an empty object', () => {
      const out = generate('{}', 'java');
      expect(out).toContain('public class Root {\n}');
    });
  });

  describe('Kotlin', () => {
    it('generates a @Serializable data class', () => {
      const out = generate('{"name": "Ada", "age": 36}', 'kotlin');
      expect(out).toContain('import kotlinx.serialization.Serializable');
      expect(out).toContain('@Serializable');
      expect(out).toContain('data class Root(');
      expect(out).toMatch(/val name: String,/);
      expect(out).toMatch(/val age: Long,/);
    });

    it('uses a float type when any sample value is non-integer', () => {
      const out = generate('{"values": [{"score": 1}, {"score": 1.5}]}', 'kotlin');
      expect(out).toMatch(/val score: Double,/);
    });

    it('marks an optional or nullable field with ? and a null default', () => {
      const out = generate('{"items": [{"a": 1}, {"a": null}]}', 'kotlin');
      expect(out).toMatch(/val a: Long\? = null,/);
    });

    it('adds a @SerialName only when the sanitized name differs from the JSON key', () => {
      const out = generate('{"foo-bar": 1, "plain": 2}', 'kotlin');
      expect(out).toContain('@SerialName("foo-bar")');
      expect(out).not.toContain('@SerialName("plain")');
      expect(out).toContain('import kotlinx.serialization.SerialName');
    });

    it('escapes a Kotlin keyword used as a JSON key', () => {
      const out = generate('{"class": "x"}', 'kotlin');
      expect(out).toMatch(/val class_: String,/);
      expect(out).toContain('@SerialName("class")');
    });

    it('degrades a mixed-type array to JsonElement and imports it', () => {
      const out = generate('{"values": [1, "two"]}', 'kotlin');
      expect(out).toContain('import kotlinx.serialization.json.JsonElement');
      expect(out).toMatch(/val values: List<JsonElement>,/);
    });

    it('renders an empty object as a singleton object, not an invalid empty data class', () => {
      const out = generate('{}', 'kotlin');
      expect(out).toContain('object Root');
      expect(out).not.toContain('data class Root(');
    });

    it('renders a root array as a typealias', () => {
      const out = generate('["a", "b"]', 'kotlin');
      expect(out).toContain('typealias Root = List<String>');
    });
  });

  describe('Swift', () => {
    it('generates a Codable struct', () => {
      const out = generate('{"name": "Ada", "age": 36}', 'swift');
      expect(out).toContain('import Foundation');
      expect(out).toContain('struct Root: Codable {');
      expect(out).toMatch(/let name: String/);
      expect(out).toMatch(/let age: Int/);
      expect(out).not.toContain('enum CodingKeys');
    });

    it('uses a float type when any sample value is non-integer', () => {
      const out = generate('{"values": [{"score": 1}, {"score": 1.5}]}', 'swift');
      expect(out).toMatch(/let score: Double/);
    });

    it('marks an optional or nullable field with ? and no CodingKeys entry needed for it alone', () => {
      const out = generate('{"items": [{"a": 1}, {"a": null}]}', 'swift');
      expect(out).toMatch(/let a: Int\?/);
    });

    it('adds a CodingKeys enum only when a property name differs from its JSON key, listing every case', () => {
      const out = generate('{"foo-bar": 1, "plain": 2}', 'swift');
      expect(out).toContain('enum CodingKeys: String, CodingKey {');
      expect(out).toContain('case fooBar = "foo-bar"');
      expect(out).toContain('case plain');
      expect(out).not.toContain('case plain =');
    });

    it('backtick-escapes a Swift keyword used as a JSON key, needing no CodingKeys entry since it still matches', () => {
      const out = generate('{"class": "x"}', 'swift');
      expect(out).toMatch(/let `class`: String/);
      expect(out).not.toContain('enum CodingKeys');
    });

    it('degrades a mixed-type array to the inlined AnyCodable helper', () => {
      const out = generate('{"values": [1, "two"]}', 'swift');
      expect(out).toContain('struct AnyCodable: Codable {');
      expect(out).toMatch(/let values: \[AnyCodable\]/);
    });

    it('does not inline AnyCodable when it is not needed', () => {
      const out = generate('{"name": "Ada"}', 'swift');
      expect(out).not.toContain('AnyCodable');
    });

    it('renders a root array as a typealias', () => {
      const out = generate('["a", "b"]', 'swift');
      expect(out).toContain('typealias Root = [String]');
    });

    it('handles an empty object', () => {
      const out = generate('{}', 'swift');
      expect(out).toContain('struct Root: Codable {}');
    });
  });

  describe('generateTypesFromXml', () => {
    it('rejects empty input', () => {
      const result = generateTypesFromXml('', 'typescript');
      expect(result.ok).toBe(false);
    });

    it('rejects malformed XML with a readable message', () => {
      const result = generateTypesFromXml('<person><name>Ada</person>', 'typescript');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
    });

    it('wraps the document under its root tag, matching the XML<->JSON converter convention', () => {
      const out = generateFromXml('<person><name>Ada</name><age>36</age></person>', 'typescript');
      expect(out).toContain('export interface Person {');
      expect(out).toMatch(/name: string;/);
      expect(out).toMatch(/age: string;/); // XML has no numeric type — everything text is a string.
      expect(out).toContain('export interface Root {');
      expect(out).toMatch(/person: Person;/);
    });

    it('turns an attribute into an "@name" field, matching xmlToJson\'s convention', () => {
      const out = generateFromXml('<person id="1"><name>Ada</name></person>', 'typescript');
      expect(out).toContain('"@id": string;');
    });

    it('collapses repeated sibling tags into an array field', () => {
      const out = generateFromXml('<people><person>Ada</person><person>Grace</person></people>', 'typescript');
      expect(out).toMatch(/person: string\[\];/);
    });

    it('generates Go, Rust, Python, C#, Java, Kotlin and Swift output too, not just TypeScript', () => {
      const xml = '<person><name>Ada</name></person>';
      for (const language of ['go', 'rust', 'python', 'csharp', 'java', 'kotlin', 'swift'] as const) {
        const result = generateTypesFromXml(xml, language);
        expect(result.ok).toBe(true);
      }
    });

    it('uses a custom root type name', () => {
      const out = generateFromXml('<person><name>Ada</name></person>', 'typescript', 'ApiResponse');
      expect(out).toContain('export interface ApiResponse {');
    });
  });
});
