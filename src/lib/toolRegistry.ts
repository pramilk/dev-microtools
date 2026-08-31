import type { FunctionComponent } from 'preact';

import JsonFormatter from '../islands/JsonFormatter';
import RegexTester from '../islands/RegexTester';
import BaseConverterTool from '../islands/BaseConverterTool';
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
import CronExplainer from '../islands/CronExplainer';
import DataFormatConverter from '../islands/DataFormatConverter';
import CidrCalculator from '../islands/CidrCalculator';
import SqlFormatter from '../islands/SqlFormatter';
import Minifier from '../islands/Minifier';
import ImageBase64Tool from '../islands/ImageBase64Tool';
import FakeDataGenerator from '../islands/FakeDataGenerator';
import UrlParser from '../islands/UrlParser';
import BcryptTool from '../islands/BcryptTool';
import XmlTool from '../islands/XmlTool';
import ImageCompressor from '../islands/ImageCompressor';
import SvgOptimizer from '../islands/SvgOptimizer';
import CurlCommandBuilder from '../islands/CurlCommandBuilder';
import ImageCropper from '../islands/ImageCropper';
import ImageFormatConverter from '../islands/ImageFormatConverter';
import WordCounter from '../islands/WordCounter';
import CaseConverter from '../islands/CaseConverter';
import DuplicateLineRemover from '../islands/DuplicateLineRemover';
import TokenCounter from '../islands/TokenCounter';
import RobotsTxtGenerator from '../islands/RobotsTxtGenerator';
import BundleSizeChecker from '../islands/BundleSizeChecker';
import LoremIpsumGenerator from '../islands/LoremIpsumGenerator';
import SlugGenerator from '../islands/SlugGenerator';

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
  'base-encode-decode': BaseConverterTool,
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
  'cron-expression-explainer': CronExplainer,
  'data-format-converter': DataFormatConverter,
  'cidr-subnet-calculator': CidrCalculator,
  'sql-formatter': SqlFormatter,
  'html-css-js-minifier': Minifier,
  'image-base64-converter': ImageBase64Tool,
  'fake-data-generator': FakeDataGenerator,
  'url-parser': UrlParser,
  'bcrypt-generator': BcryptTool,
  'xml-formatter': XmlTool,
  'image-compressor': ImageCompressor,
  'svg-optimizer': SvgOptimizer,
  'curl-command-builder': CurlCommandBuilder,
  'image-cropper': ImageCropper,
  'image-format-converter': ImageFormatConverter,
  'word-counter': WordCounter,
  'case-converter': CaseConverter,
  'duplicate-line-remover': DuplicateLineRemover,
  'llm-token-counter': TokenCounter,
  'robots-txt-generator': RobotsTxtGenerator,
  'bundle-size-checker': BundleSizeChecker,
  'lorem-ipsum-generator': LoremIpsumGenerator,
  'slug-generator': SlugGenerator,
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
