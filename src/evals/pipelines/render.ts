/**
 * Composition root for the eval report. The page itself lives in ./render/ — one module
 * per tab plus the theme, the chart helpers and the per-case JSON blob — and this file
 * keeps the public surface stable for report.ts and the tests.
 */
export { renderReport } from './render/index';
export type { RenderInput, ReadinessFacts } from './render/views';
export { escapeHtml } from './render/views';
export { parseComparisons } from './render/cases';
