/**
 * Slugs that use an on-device AI model somewhere in the tool (see each tool's own content
 * page for which model, and the About page's "AI models" section for licence/attribution) —
 * used only to show a small "AI" indicator on the homepage tool cards, purely a display
 * concern like `toolIcons.ts`, not anything a tool's own logic reads.
 *
 * For Background Remover and Face & Plate Blur, the AI model *is* the tool's entire
 * function. Case Converter and Word Counter are different in degree, not kind: the model
 * only backs their shared "Sentence case (beta)" button — every other case-conversion
 * button is a plain deterministic string transform — so their own tool pages additionally
 * carry a small inline `.badge--ai` (see tool.css) next to that one button specifically,
 * rather than implying the AI badge below to a visitor.
 */
export const AI_POWERED_TOOL_SLUGS = new Set(['background-remover', 'face-plate-blur', 'case-converter', 'word-counter']);
