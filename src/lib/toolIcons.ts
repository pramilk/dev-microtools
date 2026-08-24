/**
 * Slug -> short label shown next to a tool in navigation UI (the sidebar list, the
 * homepage directory). Purely a display concern, not tool content — kept out of the
 * content schema so it doesn't force every .mdx file to carry an icon field.
 *
 * Deliberately monospace text abbreviations, not icon glyphs or emoji: emoji render in
 * their own fixed colours regardless of CSS `color`, clashing with the site's
 * single-accent-colour design system, and several single-character symbol glyphs
 * (◐, •••) rendered visibly smaller than the text abbreviations at the same font size —
 * plain text is the only option here that is both on-brand and visually consistent
 * across every tool.
 */
export const TOOL_ICONS: Record<string, string> = {
  'json-formatter': '{}',
  'regex-tester': 'RX',
  'base64-encode-decode': 'B64',
  'uuid-generator': 'ID',
  'jwt-decoder': 'JWT',
  'hash-generator': '#',
  'url-encode-decode': 'URL',
  'timestamp-converter': 'TS',
  'color-converter': 'RGB',
  'diff-checker': 'DIF',
  'password-generator': 'PWD',
  'qr-code-generator': 'QR',
  'css-gradient-generator': 'GRD',
  'css-box-shadow-generator': 'SHD',
  'user-agent-parser': 'UA',
  'cron-expression-explainer': 'CRON',
  'data-format-converter': 'CNV',
  'cidr-subnet-calculator': '/24',
  'sql-formatter': 'SQL',
  'html-css-js-minifier': 'MIN',
  'image-base64-converter': 'IMG',
  'fake-data-generator': 'RND',
  'base32-encode-decode': 'B32',
  'base58-encode-decode': 'B58',
  'url-parser': '?=',
  'bcrypt-generator': 'BCR',
  'xml-formatter': 'XML',
  'image-compressor': 'CMP',
  'svg-optimizer': 'SVG',
  'curl-command-builder': 'CURL',
  'image-cropper': 'CROP',
  'image-format-converter': 'FMT',
};

export const DEFAULT_TOOL_ICON = '▪';
