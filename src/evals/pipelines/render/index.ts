/**
 * The page: the navy document header, the tab bar, one panel per tab (Overview · one per agent ·
 * Calibration), the passing-case blob and the one script. Method and the glossary close the
 * Overview; `#judges`, `#runs` and `#method` still resolve to where that material now lives. Without JavaScript the tabs
 * stack in order and every anchor still resolves; with it, the hash picks the tab and an
 * old anchor (`#<metric>`, `#case-<metric>-<id>`, a section id) opens the tab that holds it.
 */

import type { EvalReport } from '../../types';
import { renderActions, renderTriage } from './actions';
import { renderAgentTab } from './agent';
import { CASE_SCRIPT, newBlob, renderCaseBlob } from './cases';
import { renderCalibrationTab } from './calibration';
import { renderMethodSection } from './method';
import { agentsOf, judgesTrusted, renderOverview } from './overview';
import { STYLE } from './theme';
import { buildViews, escapeHtml, renderRunStrip } from './views';
import type { MetricView, RenderInput } from './views';

export const SCRIPT = `
document.documentElement.classList.add('js');
var tabs = [].slice.call(document.querySelectorAll('.tab'));
var links = [].slice.call(document.querySelectorAll('nav.tabs a'));
function show(tab) {
  tabs.forEach(function (t) { t.classList.toggle('active', t === tab); });
  links.forEach(function (a) {
    if (a.getAttribute('href') === '#' + tab.id.slice(4)) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}
// One filter bar per agent tab, over every case on that tab: verdict, lane lost on,
// dimension lost on, free text.
document.querySelectorAll('[data-filter-bar]').forEach(function (bar) {
  var tab = bar.closest('.tab') || document;
  var chips = bar.querySelectorAll('[data-filter]');
  var lane = bar.querySelector('[data-lane]');
  var dim = bar.querySelector('[data-dim]');
  var input = bar.querySelector('input[type=search]');
  var shown = bar.querySelector('[data-shown]');
  var boxes = tab.querySelectorAll('[data-cases]');
  var filter = 'all';
  // Free text searches the id and everything in the summary row (note, verdicts).
  function text(it) { if (!it.searchText) it.searchText = (it.getAttribute('data-search') + ' ' + it.firstElementChild.textContent).toLowerCase(); return it.searchText; }
  function apply() {
    var q = (input.value || '').toLowerCase().trim();
    var l = lane ? lane.value : '';
    var d = dim ? dim.value : '';
    var total = 0, kept = 0;
    boxes.forEach(function (box) {
      var n = 0;
      box.querySelectorAll('.case').forEach(function (it) {
        var ok = (filter === 'all' || it.getAttribute('data-state') === filter)
          && (!l || (' ' + (it.getAttribute('data-lanes') || '') + ' ').indexOf(' ' + l + ' ') !== -1)
          && (!d || (' ' + (it.getAttribute('data-dims') || '') + ' ').indexOf(' ' + d + ' ') !== -1)
          && (!q || text(it).indexOf(q) !== -1);
        it.hidden = !ok;
        total++;
        if (ok) n++;
      });
      var empty = box.querySelector('.no-match');
      if (empty) empty.hidden = n > 0;
      kept += n;
    });
    if (shown) shown.textContent = kept + ' of ' + total + ' cases shown';
  }
  chips.forEach(function (c) {
    c.addEventListener('click', function () {
      filter = c.getAttribute('data-filter');
      chips.forEach(function (x) { x.setAttribute('aria-pressed', String(x === c)); });
      apply();
    });
  });
  if (lane) lane.addEventListener('change', apply);
  if (dim) dim.addEventListener('change', apply);
  input.addEventListener('input', apply);
  apply();
});
// The hash names a tab, or any element on one: open that tab, every <details> above the
// element and the element itself when it is a case, then scroll there.
function toTop() { window.scrollTo(0, 0); }
function route() {
  var id = decodeURIComponent(location.hash.slice(1));
  var tab = id && document.getElementById('tab-' + id);
  if (tab) {
    show(tab);
    // A tab name may also be a section id (#overview). The browser keeps scrolling to that
    // element until load, so its id is parked until then and the page stays at the top.
    var twin = document.getElementById(id);
    if (twin && document.readyState !== 'complete') {
      twin.removeAttribute('id');
      window.addEventListener('load', function () { twin.id = id; }, { once: true });
    }
    toTop();
    return;
  }
  var el = id && document.getElementById(id);
  if (!el) { show(tabs[0]); return; }
  show(el.closest('.tab') || tabs[0]);
  for (var p = el.parentElement; p; p = p.parentElement) {
    if (p.tagName === 'DETAILS' && !p.open) p.open = true;
  }
  if (el.classList.contains('case')) { el.open = true; el.hidden = false; }
  // A block that folds its own body (#method) opens it when named directly.
  if (el.hasAttribute('data-open-inner')) { var inner = el.querySelector('details'); if (inner) inner.open = true; }
  el.scrollIntoView();
}
window.addEventListener('hashchange', route);
route();
`;

/** Drops the indentation and the spaces around punctuation; strings in the sheet carry neither. */
const minifyCss = (css: string): string => css.replace(/\n\s*/g, '\n').replace(/\s*([{};:,>])\s*/g, '$1');

interface Tab {
  id: string;
  label: string;
  badge?: string;
  body: string;
}

const badge = (text: string, tone: 'bad' | 'good' | ''): string => `<span class="badge ${tone}">${escapeHtml(text)}</span>`;

function agentBadge(views: MetricView[]): string | undefined {
  const failedGates = views.filter((v) => v.gate.kind !== 'ungated' && v.gate.kind !== 'passed').length;
  if (failedGates) return badge(String(failedGates), 'bad');
  const failing = views.reduce((a, v) => a + v.rows.filter((r) => r.grades.some((g) => g.status === 'graded' && !g.isCorrect)).length, 0);
  return failing ? badge(String(failing), '') : undefined;
}

function judgesBadge(report: EvalReport): string | undefined {
  const { trusted, total } = judgesTrusted(report);
  return total ? badge(`${trusted}/${total}`, trusted === total ? 'good' : 'bad') : undefined;
}

const panel = (tab: Tab): string => `<div class="tab" id="tab-${escapeHtml(tab.id)}" data-tab="${escapeHtml(tab.id)}">
  ${tab.body}
</div>`;

export function renderReport(input: RenderInput): string {
  const { report } = input;
  const history = input.history ?? [];
  const calibrationRows = input.calibrationRows ?? [];
  const calibrationCases = input.calibrationCases ?? [];
  const views = buildViews(input);
  const blob = newBlob();
  const failing = views.reduce((a, v) => a + v.rows.filter((r) => r.grades.some((g) => g.status === 'graded' && !g.isCorrect)).length, 0);

  const tabs: Tab[] = [
    {
      id: 'overview',
      label: 'Overview',
      body: `${renderOverview(views, report, history, calibrationRows, input)}
  <details class="review" id="review"><summary>Review queues and every failing verdict${failing ? ` (${failing})` : ''}</summary>
  ${renderTriage(views, report, calibrationRows)}
  </details>
  ${renderActions(views, report, calibrationRows, input)}
  ${renderMethodSection(views, report, input)}`,
    },
    ...agentsOf(views).map((agent) => {
      const mine = views.filter((v) => v.agent === agent);
      return { id: agent.toLowerCase(), label: agent, badge: agentBadge(mine), body: renderAgentTab(agent, mine, report, blob) };
    }),
    { id: 'calibration', label: 'Calibration', badge: judgesBadge(report), body: renderCalibrationTab(views, report, calibrationRows, history, calibrationCases) },
  ];

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent eval dashboard</title>
<style>${minifyCss(STYLE)}</style>
</head>
<body>
<header class="doc-header"><div class="inner">
  <h1>Agent eval dashboard</h1>
  <p class="meta">NYC-DSSG partner portal · offline evaluation</p>
  ${renderRunStrip(views, report)}
  <p class="summary">Each agent runs over hand-written cases with known answers, two ways: the <strong>fallback</strong> (deterministic code, what the gate certifies) and the <strong>model path</strong> (Gemini, reported but never gated). Decisions are checked by exact match; prose is scored by an AI judge whose own accuracy is measured against hand labels. <a href="#glossary">Glossary</a>.</p>
</div></header>
<main class="page">
  <nav class="tabs" aria-label="Sections">${tabs.map((t) => `<a href="#${escapeHtml(t.id)}">${escapeHtml(t.label)}${t.badge ?? ''}</a>`).join('')}</nav>
  <noscript><p class="noscript">Without JavaScript every tab is shown in order; passing cases show their verdicts but not their bodies.</p></noscript>

  ${tabs.map(panel).join('\n\n  ')}
</main>
${renderCaseBlob(blob)}
<script>${CASE_SCRIPT}${SCRIPT}</script>
</body>
</html>
`;
}
