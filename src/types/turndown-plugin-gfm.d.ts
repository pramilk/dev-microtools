/**
 * turndown-plugin-gfm ships no type declarations. Each export is a Turndown plugin —
 * a function taking a `TurndownService` and registering rules on it via `.use()` or
 * `.addRule()`. Only the composite `gfm` plugin (tables, strikethrough, task lists,
 * fenced code blocks with a language) is used here.
 */
declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown';

  export function gfm(turndownService: TurndownService): void;
  export function tables(turndownService: TurndownService): void;
  export function strikethrough(turndownService: TurndownService): void;
  export function taskListItems(turndownService: TurndownService): void;
  export function highlightedCodeBlock(turndownService: TurndownService): void;
}
