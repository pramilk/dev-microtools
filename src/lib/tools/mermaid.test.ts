import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateMermaidSource,
  MAX_INPUT_LENGTH,
  MERMAID_EXAMPLES,
  DEFAULT_EXAMPLE_ID,
  exampleById,
  svgIntrinsicSize,
  detectDiagramTypeId,
  DIAGRAM_KEYWORDS,
  MERMAID_DOCS_URL,
} from './mermaid';

describe('validateMermaidSource', () => {
  it('accepts non-empty input', () => {
    const result = validateMermaidSource('flowchart TD\nA-->B');
    expect(result).toEqual({ ok: true, value: 'flowchart TD\nA-->B' });
  });

  it('rejects empty input', () => {
    const result = validateMermaidSource('');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/enter mermaid/i);
  });

  it('rejects whitespace-only input', () => {
    const result = validateMermaidSource('   \n  ');
    expect(result.ok).toBe(false);
  });

  it('rejects input past the size limit', () => {
    const huge = 'A'.repeat(MAX_INPUT_LENGTH + 1);
    const result = validateMermaidSource(huge);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/too large/i);
  });

  it('accepts input right at the size limit', () => {
    const exact = 'A'.repeat(MAX_INPUT_LENGTH);
    expect(validateMermaidSource(exact).ok).toBe(true);
  });
});

describe('MERMAID_EXAMPLES', () => {
  it('has a unique id for every example', () => {
    const ids = MERMAID_EXAMPLES.map((example) => example.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every example is itself valid, non-empty Mermaid source', () => {
    for (const example of MERMAID_EXAMPLES) {
      expect(validateMermaidSource(example.code).ok).toBe(true);
    }
  });

  it('includes the default example id', () => {
    expect(MERMAID_EXAMPLES.some((example) => example.id === DEFAULT_EXAMPLE_ID)).toBe(true);
  });

  it("every example's own code is detected as its own type — keyword, detect regex and code never drift apart", () => {
    for (const example of MERMAID_EXAMPLES) {
      expect(example.code.trimStart().startsWith(example.keyword)).toBe(true);
      expect(detectDiagramTypeId(example.code)).toBe(example.id);
    }
  });

  it('every example has at least one snippet, each with non-empty label and insert text', () => {
    for (const example of MERMAID_EXAMPLES) {
      expect(example.snippets.length).toBeGreaterThan(0);
      for (const snippet of example.snippets) {
        expect(snippet.label.trim()).not.toBe('');
        expect(snippet.insert.trim()).not.toBe('');
      }
    }
  });
});

describe('detectDiagramTypeId', () => {
  it('returns null for empty or whitespace-only source', () => {
    expect(detectDiagramTypeId('')).toBeNull();
    expect(detectDiagramTypeId('   \n  ')).toBeNull();
  });

  it('returns null when the first line matches no known diagram-type keyword', () => {
    expect(detectDiagramTypeId('this is not mermaid syntax')).toBeNull();
  });

  it('detects the type from the first non-blank line, ignoring leading blank lines', () => {
    expect(detectDiagramTypeId('\n\n  sequenceDiagram\n  A->>B: hi')).toBe('sequence');
  });

  it('accepts the legacy "graph" alias for a flowchart', () => {
    expect(detectDiagramTypeId('graph TD\nA-->B')).toBe('flowchart');
  });
});

describe('DIAGRAM_KEYWORDS', () => {
  it('lists one keyword per example, in the same order', () => {
    expect(DIAGRAM_KEYWORDS).toEqual(MERMAID_EXAMPLES.map((example) => example.keyword));
  });
});

describe('MERMAID_DOCS_URL', () => {
  it('points at an https URL', () => {
    expect(MERMAID_DOCS_URL).toMatch(/^https:\/\//);
  });
});

describe('exampleById', () => {
  it('finds an example by id', () => {
    expect(exampleById(DEFAULT_EXAMPLE_ID)?.id).toBe(DEFAULT_EXAMPLE_ID);
  });

  it('returns undefined for an unknown id', () => {
    expect(exampleById('not-a-real-example')).toBeUndefined();
  });
});

describe('svgIntrinsicSize', () => {
  it('reads width and height from a viewBox attribute', () => {
    const svg = '<svg viewBox="0 0 320 240" xmlns="http://www.w3.org/2000/svg"></svg>';
    expect(svgIntrinsicSize(svg)).toEqual({ width: 320, height: 240 });
  });

  it('falls back to width/height attributes when there is no viewBox', () => {
    const svg = '<svg width="150" height="90" xmlns="http://www.w3.org/2000/svg"></svg>';
    expect(svgIntrinsicSize(svg)).toEqual({ width: 150, height: 90 });
  });

  it('falls back to a default size when neither is present or usable', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    expect(svgIntrinsicSize(svg)).toEqual({ width: 800, height: 600 });
  });
});

// renderMermaidDiagram drives the real `mermaid` package, which lays out diagrams via d3/dagre
// and measures text with SVG APIs (getBBox) this test environment doesn't implement reliably —
// the same boundary backgroundRemove.test.ts draws around onnxruntime-web. Mocked here to
// exercise this module's own plumbing (validation, caching, error messages); the real render
// pipeline is covered by the Playwright e2e spec against an actual browser.
const { renderMock, initializeMock } = vi.hoisted(() => ({
  renderMock: vi.fn(),
  initializeMock: vi.fn(),
}));
vi.mock('mermaid', () => ({
  default: {
    initialize: initializeMock,
    render: renderMock,
  },
}));

describe('renderMermaidDiagram', () => {
  beforeEach(() => {
    renderMock.mockReset();
    initializeMock.mockReset();
    // The module caches the loaded `mermaid` import at module scope by design (see
    // loadMermaid's comment) — each test needs a fresh module instance, not just fresh
    // mocks, or a later test would silently reuse an earlier test's cached (possibly
    // failed) import promise.
    vi.resetModules();
  });

  it('rejects empty input without ever loading mermaid', async () => {
    const { renderMermaidDiagram } = await import('./mermaid');
    const result = await renderMermaidDiagram('', { theme: 'default' });
    expect(result.ok).toBe(false);
    expect(renderMock).not.toHaveBeenCalled();
  });

  it('initializes with the requested theme and strict security, then returns the rendered svg', async () => {
    renderMock.mockResolvedValue({ svg: '<svg>diagram</svg>' });
    const { renderMermaidDiagram } = await import('./mermaid');

    const result = await renderMermaidDiagram('flowchart TD\nA-->B', { theme: 'dark' });

    expect(result).toEqual({ ok: true, value: '<svg>diagram</svg>' });
    expect(initializeMock).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark', securityLevel: 'strict', startOnLoad: false }));
    expect(renderMock).toHaveBeenCalledWith(expect.stringMatching(/^mermaid-diagram-/), 'flowchart TD\nA-->B');
  });

  it('surfaces a failed parse as a readable error, using mermaid’s own message', async () => {
    renderMock.mockRejectedValue(new Error("Parse error on line 2:\n...unexpected token"));
    const { renderMermaidDiagram } = await import('./mermaid');

    const result = await renderMermaidDiagram('not valid mermaid !!', { theme: 'default' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/parse error on line 2/i);
  });

});
