import type { FunctionComponent } from 'preact';

import JsonFormatter from '../islands/JsonFormatter';
import RegexTester from '../islands/RegexTester';
import Base64Tool from '../islands/Base64Tool';
import UuidGenerator from '../islands/UuidGenerator';
import JwtDebugger from '../islands/JwtDebugger';
import HashGenerator from '../islands/HashGenerator';
import UrlTool from '../islands/UrlTool';
import TimestampConverter from '../islands/TimestampConverter';
import ColorConverter from '../islands/ColorConverter';
import DiffChecker from '../islands/DiffChecker';
import PasswordGenerator from '../islands/PasswordGenerator';
import QrCodeGenerator from '../islands/QrCodeGenerator';
import CssGradientGenerator from '../islands/CssGradientGenerator';
import CssBoxShadowGenerator from '../islands/CssBoxShadowGenerator';
import UserAgentParser from '../islands/UserAgentParser';

/**
 * Maps a content-collection slug to the island that renders that tool.
 *
 * This is the one place adding a tool touches shared code. Everything else about a
 * tool lives in its own three files (logic, island, content), so tools stay isolated
 * from each other.
 */
const REGISTRY: Record<string, FunctionComponent> = {
  'json-formatter': JsonFormatter,
  'regex-tester': RegexTester,
  'base64-encode-decode': Base64Tool,
  'uuid-generator': UuidGenerator,
  'jwt-decoder': JwtDebugger,
  'hash-generator': HashGenerator,
  'url-encode-decode': UrlTool,
  'timestamp-converter': TimestampConverter,
  'color-converter': ColorConverter,
  'diff-checker': DiffChecker,
  'password-generator': PasswordGenerator,
  'qr-code-generator': QrCodeGenerator,
  'css-gradient-generator': CssGradientGenerator,
  'css-box-shadow-generator': CssBoxShadowGenerator,
  'user-agent-parser': UserAgentParser,
};

/**
 * Looks up a tool's island.
 *
 * Throws at build time rather than rendering a blank page: a content file with no
 * matching island is a mistake we want to hear about during `astro build`, not from
 * a visitor staring at an empty tool.
 */
export function islandFor(slug: string): FunctionComponent {
  const component = REGISTRY[slug];
  if (!component) {
    throw new Error(
      `No island registered for tool "${slug}". Add it to src/lib/toolRegistry.ts.`
    );
  }
  return component;
}

export const registeredSlugs = (): string[] => Object.keys(REGISTRY);
