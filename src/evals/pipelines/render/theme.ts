/**
 * The page's stylesheet: the shared system-analysis template (navy header, off-white page,
 * white section cards with a teal rule), light only, no external fonts. Series colours are
 * the same tokens: fallback navy, model teal; red, amber and green are reserved for
 * fail / warn / pass and never used for a series.
 */

export const STYLE = `
:root {
  --navy: #1e3a5f; --teal: #028090; --amber: #f59e0b; --green: #059669; --red: #dc2626; --purple: #7c3aed;
  --offwhite: #f8fafc; --slate: #e2e8f0; --mid: #64748b; --dark: #1e293b;
  --warn-text: #b45309; --teal-soft: #e0f4f7; --amber-soft: #fef3c7; --red-soft: #fee2e2; --green-soft: #d1fae5; --purple-soft: #ede9fe;
  --track: #e2e8f0; --none: #94a3b8;
}
* { box-sizing: border-box; }
body { margin: 0; background: #f1f5f9; color: var(--dark); font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
a { color: var(--teal); text-decoration: none; } a:hover { text-decoration: underline; }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .86em; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--offwhite); border: 1px solid var(--slate); border-radius: 6px; padding: 10px; margin: 6px 0 0; max-height: 28rem; overflow: auto; }
h1, h2, h3, h4 { margin: 0; } h3 { font-size: 1rem; color: var(--navy); } h4 { font-size: .9rem; margin: 0 0 6px; color: var(--navy); }
p { margin: 0 0 10px; }
.muted { color: var(--mid); font-size: 13px; } .small { font-size: .85rem; }
.t-good { color: var(--green); } .t-warn { color: var(--warn-text); } .t-bad { color: var(--red); } .t-none { color: var(--mid); } .t-err { color: var(--purple); }
.t-bg-good { background: var(--green); } .t-bg-warn { background: var(--amber); } .t-bg-bad { background: var(--red); } .t-bg-none { background: var(--none); }
.t-fill-good { fill: var(--green); } .t-fill-warn { fill: var(--amber); } .t-fill-bad { fill: var(--red); } .t-fill-none { fill: var(--none); }
.t-stroke-good { stroke: var(--green); } .t-stroke-warn { stroke: var(--amber); } .t-stroke-bad { stroke: var(--red); } .t-stroke-none { stroke: var(--none); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
[hidden] { display: none !important; }
/* --- Shell: header, page, tabs --- */
.doc-header { background: var(--navy); color: #fff; padding: 36px 0 32px; }
.doc-header .inner { max-width: 1100px; margin: 0 auto; padding: 0 32px; }
.doc-header h1 { font-size: 26px; font-weight: 700; margin: 0 0 8px; }
.doc-header .meta { color: #93c5fd; font-size: 13px; margin: 0 0 12px; }
.doc-header .summary { color: #bfdbfe; font-size: 14px; max-width: 720px; line-height: 1.55; margin: 0; }
.doc-header .run { display: flex; flex-wrap: wrap; gap: 4px 18px; margin: 0 0 12px; font-size: 13px; }
.doc-header .kv > span:first-child { color: #93c5fd; } .doc-header .kv { color: #fff; } .doc-header code { color: #fff; }
.doc-header .hint { color: #fcd34d; font-size: 13px; margin: 10px 0 0; } .doc-header .hint code { color: #fde68a; }
.page { max-width: 1100px; margin: 0 auto; padding: 24px 32px 48px; }
nav.tabs { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 20px; padding: 10px; background: #fff; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
nav.tabs a { display: inline-block; padding: 6px 10px; border-radius: 6px; color: var(--navy); font-size: 13px; font-weight: 600; white-space: nowrap; }
nav.tabs a:hover, nav.tabs a[aria-current="page"] { background: var(--teal-soft); color: var(--teal); text-decoration: none; }
nav.tabs a .badge { display: inline-block; min-width: 1.1rem; margin-left: 4px; padding: 0 5px; border-radius: 999px; font-size: 11px; text-align: center; background: var(--slate); color: var(--mid); }
nav.tabs a .badge.bad { background: var(--red-soft); color: var(--red); } nav.tabs a .badge.good { background: var(--green-soft); color: var(--green); }
.js .tab { display: none; } .js .tab.active { display: block; }
.noscript { background: var(--amber-soft); border-left: 4px solid var(--amber); border-radius: 6px; padding: 8px 12px; font-size: .85rem; margin: 0 0 14px; }
/* --- Section cards --- */
.section-block { background: #fff; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.08); padding: 20px 24px; margin: 0 0 24px; min-width: 0; scroll-margin-top: 60px; }
.section-header { border-left: 5px solid var(--teal); padding: 10px 0 10px 18px; margin: 0 0 20px; }
.section-header .num { font-size: 11px; text-transform: uppercase; letter-spacing: .1em; color: var(--teal); font-weight: 600; }
.section-header h2 { font-size: 20px; font-weight: 700; color: var(--navy); margin: 4px 0 6px; }
.section-header .lead { color: var(--mid); font-size: 14px; margin: 0; max-width: 90ch; }
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 0 0 20px; }
.grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin: 0 0 20px; }
.card { background: #fff; border: 1px solid var(--slate); border-radius: 8px; padding: 16px 18px; margin: 0 0 16px; min-width: 0; }
.card h3 { font-size: 12px; font-weight: 700; color: var(--navy); margin: 0 0 6px; text-transform: uppercase; letter-spacing: .05em; }
.sub-hdr { font-size: 12px; font-weight: 700; color: var(--navy); margin: 24px 0 12px; text-transform: uppercase; letter-spacing: .05em; }
.stat-card { display: block; background: #fff; border: 1px solid var(--slate); border-radius: 8px; padding: 18px; text-align: center; color: inherit; border-top: 3px solid var(--none); }
.stat-card:hover { text-decoration: none; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
.stat-card.tone-good { border-top-color: var(--green); } .stat-card.tone-warn { border-top-color: var(--amber); } .stat-card.tone-bad { border-top-color: var(--red); }
.stat-card .num { font-size: 30px; font-weight: 800; color: var(--navy); line-height: 1.15; font-variant-numeric: tabular-nums; }
.stat-card .num small { font-size: 15px; font-weight: 500; color: var(--mid); }
.stat-card .label { font-size: 11px; color: var(--mid); margin-top: 4px; text-transform: uppercase; letter-spacing: .06em; }
.stat-card .sub { font-size: 12px; color: var(--teal); margin-top: 2px; }
.callout { border-radius: 6px; padding: 14px 18px; margin: 0 0 18px; font-size: 13px; line-height: 1.45; border-left: 4px solid var(--teal); background: var(--teal-soft); }
.callout.amber { background: var(--amber-soft); border-left-color: var(--amber); }
.callout.teal { background: var(--teal-soft); border-left-color: var(--teal); }
.callout.red { background: var(--red-soft); border-left-color: var(--red); }
.callout.green { background: var(--green-soft); border-left-color: var(--green); }
.callout strong { font-weight: 700; } .callout p { margin: 0 0 6px; } .callout p:last-child { margin: 0; }
.callout ul { margin: 6px 0 0; padding-left: 18px; } .callout h3 { font-size: 13px; margin: 0 0 4px; }
.footer-note { color: var(--mid); font-size: 12px; margin: 20px 0 0; padding-top: 10px; border-top: 1px solid var(--slate); }
.chart-note, .legend { color: var(--mid); font-size: 12px; margin: 8px 0 0; max-width: 100ch; }
.pointer { font-size: 13px; color: var(--mid); margin: 0 0 16px; }
/* --- Tables --- */
.fields-wrap { overflow-x: auto; }
.fields { border-collapse: collapse; width: 100%; font-size: 13px; margin: 0 0 12px; }
.fields th, .fields td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--slate); overflow-wrap: anywhere; vertical-align: top; }
.fields thead th { background: var(--navy); color: #fff; font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; border-bottom: 0; white-space: nowrap; }
.fields tbody th { overflow-wrap: normal; word-break: normal; white-space: nowrap; font-weight: 600; color: var(--navy); }
.fields tbody tr:hover td { background: var(--offwhite); }
.fields tr.group th { background: var(--offwhite); color: var(--navy); font-size: 14px; padding: 10px 10px 6px; border-top: 2px solid var(--slate); white-space: normal; }
.fields tr.group th a { color: var(--navy); }
.fields tr.failing th { box-shadow: inset 3px 0 0 var(--red); }
.fields tr.mismatch td, .fields tr.mismatch th { background: var(--red-soft); color: var(--red); font-weight: 600; }
.fields tr.match td:last-child { color: var(--green); }
.fields td.why { color: var(--mid); font-size: 12px; min-width: 14rem; max-width: 36ch; }
.fields td.num { text-align: center; white-space: nowrap; font-variant-numeric: tabular-nums; }
.fields code { font-size: 12px; } .fields td code { white-space: normal; }
.role { color: var(--mid); font-size: 12px; font-weight: 400; margin-left: 10px; }
.mname { color: var(--mid); font-weight: 400; font-size: .74em; margin-left: 2px; }
.ladder tbody th { white-space: normal; min-width: 11rem; } .ladder td:last-child, .actions td:nth-child(2) { white-space: nowrap; } .ladder tbody th small { display: block; color: var(--mid); font-weight: 400; font-size: 12px; line-height: 1.3; }
.ladder tr.blocker th, .ladder tr.blocker td { background: var(--amber-soft); } .ladder tr.blocker th { box-shadow: inset 3px 0 0 var(--amber); }
.rung { font-size: 11px; font-weight: 700; border-radius: 999px; padding: 1px 8px; white-space: nowrap; }
.rung.done { background: var(--green-soft); color: var(--green); } .rung.partial { background: var(--amber-soft); color: var(--warn-text); } .rung.todo { background: var(--slate); color: var(--mid); }
.queues tbody th { white-space: normal; }
.actions tr.p1 td:first-child { box-shadow: inset 3px 0 0 var(--red); } .actions tr.p2 td:first-child { box-shadow: inset 3px 0 0 var(--amber); }
.overview-table th, .overview-table td, .score-table th, .score-table td, .trend-table th, .trend-table td, .cal-table th, .cal-table td { vertical-align: middle; }
.overview-table tbody th, .score-table tbody th, .trend-table tbody th, .cal-table tbody th, .roster tbody th { white-space: normal; min-width: 11rem; }
.roster td.why { max-width: 16rem; font-size: 12px; line-height: 1.4; }
.roster td:nth-child(6) { white-space: nowrap; }
.overview-table tbody th small, .score-table tbody th small, .trend-table tbody th small, .roster tbody th small { display: block; color: var(--mid); font-weight: 400; font-size: 12px; line-height: 1.3; }
.ov { white-space: nowrap; min-width: 6rem; } .ov b { font-size: 15px; } .ov .n { color: var(--mid); font-size: 12px; font-weight: 500; }
.ov small { display: block; font-size: 11px; color: var(--mid); } .ov.none { color: var(--mid); font-style: italic; text-align: center; } .ov.thin b { color: var(--mid); }
.ov.chart { padding-top: 4px; padding-bottom: 4px; }
.score { text-align: center; min-width: 7rem; } .score b { font-size: 16px; display: block; line-height: 1.2; }
.score small, .trend-table td small { display: block; font-size: 11px; color: var(--mid); font-weight: 500; }
.score.none, .trend-table td.none, .cal-table td.none, td.none { color: var(--mid); font-style: italic; text-align: center; }
.gate-cell { white-space: nowrap; }
.fx { text-decoration: none; cursor: help; color: var(--warn-text); font-weight: 700; margin-left: 2px; }
.trend-table thead th { vertical-align: bottom; min-width: 6.5rem; } .trend-table thead th time { display: block; font-weight: 600; }
.trend-table thead th small { display: block; font-weight: 400; font-size: 11px; line-height: 1.3; max-width: 9rem; text-transform: none; letter-spacing: 0; }
.trend-table thead th .now { color: #67e8f9; font-weight: 600; } .trend-table thead th .t-bad { color: #fca5a5; }
.trend-table td { text-align: center; } .trend-table td b { font-size: 15px; }
.trend-table th.current, .trend-table td.current, .cal-table td.current { background: var(--teal-soft); }
.cal-table { margin-top: 12px; } .cal-table td { text-align: center; } .cal-table td.dims-cell { text-align: left; font-size: 12px; } .cal-table td b { font-size: 15px; }
.check-table td.check { min-width: 11rem; } .check-table td.check .bar-row { grid-template-columns: 1fr 3.5rem; } .check-table td.check small { color: var(--mid); font-size: 11px; }
.profile .pv { display: inline-block; margin: 0 8px 2px 0; white-space: nowrap; } .profile .pv small { color: var(--mid); }
.sample-card { background: var(--offwhite); border-radius: 8px; padding: 12px 16px; margin: 14px 0 0; font-size: 13px; } .sample-card p { color: var(--mid); max-width: 90ch; }
.sample-card tr.thin th { box-shadow: inset 3px 0 0 var(--amber); }
/* --- Pills, gates, chips --- */
.gate { font-size: 11px; font-weight: 700; border-radius: 999px; padding: 1px 8px; white-space: nowrap; border: 1px solid transparent; } .gate small { font-weight: 500; }
.gate-passed { background: var(--green-soft); color: var(--green); } .gate-failed { background: var(--red-soft); color: var(--red); border-color: var(--red); }
.gate-ungated, .gate-unmeasured { background: var(--slate); color: var(--mid); }
.pill { font-size: 11px; font-weight: 700; border-radius: 999px; padding: 1px 8px; white-space: nowrap; }
.pill.pass { background: var(--green-soft); color: var(--green); } .pill.fail { background: var(--red-soft); color: var(--red); }
.pill.errored { background: var(--purple-soft); color: var(--purple); } .pill.absent { background: var(--slate); color: var(--mid); font-weight: 500; }
.pill.borderline { background: var(--amber-soft); color: var(--warn-text); }
.tag { font-size: 10px; border: 1px solid var(--slate); border-radius: 4px; padding: 0 4px; margin-left: 2px; color: var(--mid); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { font: inherit; font-size: 12px; font-weight: 600; color: var(--navy); background: var(--slate); border: 0; border-radius: 10px; padding: 3px 10px; cursor: pointer; }
.chip[aria-pressed="true"] { background: var(--navy); color: #fff; }
/* --- Triage, queues, review --- */
.review > summary { font-weight: 600; color: var(--navy); padding: 12px 18px; background: #fff; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.08); margin: 0 0 24px; }
.review[open] > summary { margin-bottom: 16px; }
.triage { border: 1px solid var(--slate); border-left: 4px solid var(--none); border-radius: 8px; padding: 12px 16px; margin: 12px 0; }
.triage.tone-bad { border-left-color: var(--red); } .triage.tone-warn { border-left-color: var(--amber); }
.triage h3 { font-size: 15px; margin: 0 0 2px; } .count { font-size: 12px; font-weight: 700; background: var(--slate); border-radius: 999px; padding: 0 8px; margin-left: 6px; color: var(--navy); }
.means { margin: 0 0 8px; font-size: 13px; color: var(--mid); max-width: 80ch; }
.metric-table > summary { font-weight: 600; color: var(--navy); margin: 10px 0 8px; font-size: 14px; }
details > summary { cursor: pointer; }
/* --- Agent tab: metric cards, lane stats, bars, cases --- */
.metric { background: #fff; border: 1px solid var(--slate); border-radius: 8px; padding: 16px 18px; margin: 0 0 16px; scroll-margin-top: 60px; min-width: 0; }
.metric-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 6px; } .metric-head h3 { font-size: 16px; }
.checks { margin: 0 0 12px; font-size: 13px; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
.stat { background: var(--offwhite); border-radius: 8px; padding: 10px 12px; border-left: 4px solid var(--none); min-width: 0; }
.stat.tone-good { border-left-color: var(--green); } .stat.tone-warn { border-left-color: var(--amber); } .stat.tone-bad { border-left-color: var(--red); }
.stat-label { font-size: 12px; color: var(--mid); } .stat-value { font-size: 24px; font-weight: 800; line-height: 1.2; } .stat-sub { font-size: 12px; color: var(--mid); }
.how { font-size: 13px; margin: 12px 0 6px; }
.rubric { font-size: 13px; margin: 6px 0 0; } .rubric > summary { color: var(--mid); }
.cmp { display: grid; gap: 4px; }
.cmp-row { display: grid; grid-template-columns: minmax(150px, 15rem) 1fr; gap: 6px 16px; align-items: center; padding: 8px 0; border-top: 1px solid var(--slate); }
.cmp-label { display: flex; flex-direction: column; min-width: 0; } .cmp-label a { font-weight: 600; overflow-wrap: anywhere; } .cmp-label small { color: var(--mid); }
.cmp-bars { display: grid; gap: 4px; min-width: 0; }
.bar-row { display: grid; grid-template-columns: 5.5rem 1fr 5.5rem; align-items: center; gap: 10px; font-size: 13px; }
.bar-tag { color: var(--mid); } .bar-row b { text-align: right; }
.none-note { grid-column: 2 / 4; color: var(--mid); font-style: italic; font-size: 12px; }
.track { position: relative; height: 14px; background: var(--track); border-radius: 4px; overflow: visible; } .track.thin { height: 6px; margin: 6px 0; }
.track .fill { height: 100%; border-radius: 4px; }
.track.skipped { background: repeating-linear-gradient(45deg, var(--track), var(--track) 5px, transparent 5px, transparent 10px); }
.target { position: absolute; top: -3px; bottom: -3px; width: 2px; margin-left: -1px; background: var(--dark); opacity: .7; }
.filter-bar { position: sticky; top: 54px; z-index: 1; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 10px 12px; margin: 0 0 12px; background: #fff; border: 1px solid var(--slate); border-radius: 8px; }
.filter-bar label { font-size: 12px; color: var(--mid); display: inline-flex; align-items: center; gap: 6px; }
.filter-bar select, .filter-bar input { font: inherit; font-size: 13px; padding: 4px 8px; border: 1px solid var(--slate); border-radius: 6px; background: #fff; color: var(--dark); }
.filter-bar select { max-width: 14rem; } .filter-bar input { min-width: 0; flex: 0 1 15rem; }
.filter-bar .shown { margin-left: auto; font-size: 12px; color: var(--mid); }
.cases-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 12px; margin: 16px 0 8px; } .cases-head h3 { margin: 0; } .cases-head .mname { font-size: 12px; }
.case-list { display: grid; gap: 6px; }
.case { border: 1px solid var(--slate); border-left: 4px solid var(--none); border-radius: 8px; background: #fff; min-width: 0; }
.case.s-fail { border-left-color: var(--red); } .case.s-pass { border-left-color: var(--green); } .case.s-errored { border-left-color: var(--purple); }
.case > summary { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: flex-start; justify-content: space-between; padding: 8px 12px; list-style: none; }
.case > summary::-webkit-details-marker { display: none; }
.case > summary::before { content: "▸"; color: var(--mid); margin-right: -4px; } .case[open] > summary::before { content: "▾"; }
.case-id { flex: 1 1 22rem; min-width: 0; display: flex; flex-direction: column; } .case-id code { font-weight: 600; overflow-wrap: anywhere; }
.note { color: var(--mid); font-size: 12px; }
.case:not([open]) .note { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.pills { display: flex; flex-wrap: wrap; gap: 4px; }
.case-body { padding: 4px 12px 12px; display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); } .case-body > * { min-width: 0; }
.expected dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 10px; margin: 0; font-size: 13px; }
.expected dt { color: var(--mid); } .expected dd { margin: 0; overflow-wrap: anywhere; }
.grade { background: var(--offwhite); border-radius: 8px; padding: 10px; font-size: 13px; }
.grade.fail { box-shadow: inset 3px 0 0 var(--red); } .grade.pass { box-shadow: inset 3px 0 0 var(--green); } .grade.errored { box-shadow: inset 3px 0 0 var(--purple); }
.grade p { margin: 4px 0 0; } .reasoning { overflow-wrap: anywhere; }
.dims { list-style: none; margin: 0 0 6px; padding: 0; display: grid; gap: 3px; }
.dims li { display: grid; grid-template-columns: 8rem 1fr 2.5rem; gap: 8px; align-items: center; font-size: 12px; }
.dims li b { text-align: right; } .dims li.miss { color: var(--red); } .dims li.partial { color: var(--warn-text); }
.mini { height: 6px; background: var(--track); border-radius: 3px; overflow: hidden; display: block; } .mini > span { display: block; height: 100%; }
.output { margin-top: 6px; } .output > summary { color: var(--teal); font-size: 12px; }
.cal-list { list-style: none; padding: 0; margin: 0 0 12px; display: grid; gap: 8px; font-size: 13px; }
.cal-list li { border: 1px solid var(--slate); border-left: 4px solid var(--red); border-radius: 8px; padding: 8px 12px; }
.cal-list li.cal-harsh { border-left-color: var(--amber); } .cal-list li.cal-errored { border-left-color: var(--purple); }
.cal-list .reasoning { margin: 4px 0 0; color: var(--mid); font-size: 12px; }
/* --- Method and glossary --- */
.section-header.sub { border-left-width: 3px; margin: 20px 0 14px; } .section-header.sub h3 { font-size: 16px; font-weight: 700; color: var(--navy); margin: 4px 0 6px; }
.method-body > summary { font-weight: 600; color: var(--navy); cursor: pointer; margin: 0 0 12px; } .method-body[open] > summary { margin-bottom: 16px; }
.method-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin: 0 0 8px; }
.method-grid .card { margin: 0; } .method-grid ul, .method-grid ol { margin: 0; padding-left: 18px; font-size: 13px; } .method-grid li { margin: 2px 0; }
.states { display: grid; grid-template-columns: max-content 1fr; gap: 4px 10px; font-size: 13px; margin: 0; } .states dd { margin: 0; color: var(--mid); }
.glossary { background: #fff; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.08); padding: 16px 24px; margin: 0 0 24px; }
.glossary > summary { font-weight: 600; color: var(--navy); } .glossary[open] > summary { margin-bottom: 12px; }
.glossary-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.glossary-card { border: 1px solid var(--slate); border-radius: 8px; padding: 12px 14px; background: var(--offwhite); }
.glossary-card b { color: var(--navy); display: block; margin-bottom: 4px; } .glossary-card p { color: var(--mid); font-size: 12px; line-height: 1.4; margin: 0; }
.run { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 13px; margin: 0 0 8px; } .kv > span:first-child { color: var(--mid); }
/* --- Charts --- */
.gbars, .linechart { width: 100%; height: auto; display: block; }
.gbars .grid, .linechart .grid { stroke: var(--slate); stroke-width: 1; }
.gbars .label { font-size: 11px; fill: var(--dark); text-anchor: end; } .gbars .label:hover { fill: var(--teal); }
.gbars .tip { font-size: 10px; fill: var(--dark); } .gbars .tip .n, .gbars .tip.none { fill: var(--mid); }
.gbars .target-line { stroke: var(--dark); stroke-width: 1.5; stroke-dasharray: 3 2; } .gbars .gb-row:hover .gb { fill-opacity: .75; }
.s-0 { fill: var(--navy); } .s-1 { fill: var(--teal); } .s-2 { fill: #7c9cc0; } .s-3 { fill: #6ec1cc; }
.linechart .line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.linechart .line.s-0 { stroke: var(--navy); } .linechart .line.s-1 { stroke: var(--teal); } .linechart .line.s-2 { stroke: #7c9cc0; } .linechart .line.s-3 { stroke: #6ec1cc; }
.linechart .pt { stroke: #fff; stroke-width: 2; } .linechart .tick { font-size: 10px; fill: var(--mid); text-anchor: end; } .linechart .tick.x { text-anchor: middle; }
.linechart .change { stroke: var(--amber); stroke-width: 1; stroke-dasharray: 2 2; } .linechart .end-label { font-size: 10px; fill: var(--dark); }
.legend-row { list-style: none; display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 4px 0 0; padding: 0; font-size: 12px; color: var(--mid); }
.legend-row .sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }
.sw.s-0 { background: var(--navy); } .sw.s-1 { background: var(--teal); } .sw.s-2 { background: #7c9cc0; } .sw.s-3 { background: #6ec1cc; }
figure { margin: 0; min-width: 0; } figcaption { font-size: 13px; font-weight: 600; color: var(--navy); margin-bottom: 4px; }
.dim-chart { margin: 10px 0 4px; } .dim-chart svg { width: 100%; max-width: 640px; height: auto; display: block; } .dim-why { font-size: 12px; color: var(--mid); margin: 4px 0 0; max-width: 100ch; }
/* Agent tab: verdict line, metric cards, compact checks, the scenario explorer. */
.agent .section-header h2 { font-size: 20px; } .agent .lead .still { color: var(--dark); font-weight: 600; }
.agent.verdict-attention .section-header { box-shadow: inset 4px 0 0 var(--red); padding-left: 12px; } .agent.verdict-passed .section-header { box-shadow: inset 4px 0 0 var(--green); padding-left: 12px; }
.group-h { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--mid); margin: 18px 0 8px; }
.metric-verdict { font-size: 22px; font-weight: 800; margin: 2px 0 4px; line-height: 1.2; } .metric-verdict .muted, .metric-verdict span { font-size: 14px; font-weight: 500; }
.metric .checks { font-size: 13px; color: var(--dark); margin: 0 0 8px; max-width: 100ch; }
.check-rows { margin: 6px 0 4px; } .checks-compact { max-width: 560px; margin-bottom: 4px; } .checks-compact tbody th { white-space: normal; font-weight: 500; color: var(--dark); } .checks-compact td.num { width: 7rem; font-weight: 700; }
.checks-compact thead th { font-size: 10px; padding: 5px 10px; } .checks-compact td, .checks-compact th { padding: 5px 10px; }
.technical { font-size: 13px; margin: 6px 0 0; } .technical > summary { color: var(--mid); font-size: 12px; } .technical[open] > summary { margin-bottom: 8px; }
.case-id .title { font-weight: 600; color: var(--navy); overflow-wrap: anywhere; } .case-id .note code { font-weight: 500; }
.group-tag { display: inline-block; background: var(--slate); color: var(--navy); border-radius: 4px; padding: 0 6px; font-size: 11px; font-weight: 600; }
.pill-group { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 2px 6px; border: 1px solid var(--slate); border-radius: 8px; } .pill-group small { color: var(--mid); font-size: 11px; margin-right: 2px; }
.intake { grid-column: 1 / -1; } .intake dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 10px; margin: 0; font-size: 13px; } .intake dt { color: var(--mid); } .intake dd { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.case-body h4 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--mid); margin: 0 0 4px; }
.metric-block { grid-column: 1 / -1; display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); } .metric-block > .mb-h { grid-column: 1 / -1; margin: 6px 0 0; color: var(--navy); font-size: 12px; }
.anchor { display: block; height: 0; }
.all-clear { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; background: var(--green-soft); border-radius: 8px; padding: 10px 12px; margin: 0 0 10px; font-size: 14px; font-weight: 600; }
.output[open] > summary { margin-bottom: 6px; } .output .prose, .output pre.prose { white-space: pre-wrap; font-family: inherit; font-size: 13px; line-height: 1.5; }
.artifact { background: #fff; border: 1px solid var(--slate); border-radius: 8px; padding: 10px 12px; margin: 0 0 8px; font-size: 13px; }
.artifact h5 { font-size: 14px; color: var(--navy); margin: 0 0 4px; } .artifact h6 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--mid); margin: 8px 0 2px; }
.artifact ul, .artifact ol { margin: 0; padding-left: 18px; } .artifact p { margin: 4px 0; } .artifact .subject { margin: 0 0 6px; }
.artifact.routing dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 10px; margin: 0 0 6px; } .artifact.routing dt { color: var(--mid); } .artifact.routing dd { margin: 0; }
.timeline { list-style: none; padding: 0 0 0 14px; margin: 0; border-left: 2px solid var(--teal); } .timeline > li { position: relative; padding: 0 0 10px; }
.timeline > li::before { content: ""; position: absolute; left: -19px; top: 4px; width: 8px; height: 8px; border-radius: 50%; background: var(--teal); }
.timeline .window { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--teal); } .timeline ul { padding-left: 16px; }
.dumbbell { width: 150px; height: 20px; display: block; } .dumbbell.key { display: inline-block; vertical-align: middle; width: 90px; height: 14px; }
.dumbbell .rail { stroke: var(--track); stroke-width: 3; stroke-linecap: round; } .dumbbell .gap { stroke: var(--none); stroke-width: 2; }
.dumbbell .bar { stroke: var(--dark); stroke-width: 2; } .dumbbell .bar.soft { stroke: var(--mid); stroke-dasharray: 2 2; } .dumbbell .dot.model { fill: #fff; stroke-width: 2; }
.spark { width: 96px; height: 22px; display: block; }
.spark .line { fill: none; stroke-width: 1.5; stroke-linejoin: round; } .spark .line.template { stroke: var(--navy); } .spark .line.model { stroke: var(--teal); stroke-dasharray: 3 2; }
.spark .end.template { fill: var(--navy); } .spark .end.model { fill: var(--teal); } .spark .break { stroke: var(--amber); stroke-width: 1; }
.judge-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 14px; margin: 8px 0 4px; }
.judge-card { background: #fff; border: 1px solid var(--slate); border-radius: 8px; padding: 14px 16px; border-top: 3px solid var(--none); min-width: 0; }
.judge-card.tone-good { border-top-color: var(--green); } .judge-card.tone-warn { border-top-color: var(--amber); } .judge-card.tone-bad { border-top-color: var(--red); }
.judge-card h3 { font-size: 13px; font-weight: 700; color: var(--navy); margin: 0 0 8px; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.judge-card .agree { display: flex; align-items: baseline; gap: 8px; margin: 0 0 4px; } .judge-card .agree .num { font-size: 26px; font-weight: 800; line-height: 1.1; font-variant-numeric: tabular-nums; }
.judge-card .agree .label { font-size: 11px; color: var(--mid); text-transform: uppercase; letter-spacing: .06em; }
.judge-card .fill.good { background: var(--green); } .judge-card .fill.warn { background: var(--amber); } .judge-card .fill.bad { background: var(--red); } .judge-card .fill.none { background: var(--mid); }
.judge-card .counts { font-size: 12px; color: var(--mid); margin: 6px 0 4px; } .judge-card .note { font-size: 12px; color: var(--dark); margin: 4px 0 0; line-height: 1.4; }
.stripplot { width: 100%; max-width: 360px; margin: 6px 0 0; } .stripplot svg { width: 100%; height: auto; display: block; }
.stripplot .rail { stroke: var(--track); stroke-width: 3; stroke-linecap: round; } .stripplot .pass-line { stroke: var(--dark); stroke-width: 1.5; stroke-dasharray: 3 2; }
.stripplot .dot { fill-opacity: .9; } .stripplot .dot.label-pass { fill: var(--green); } .stripplot .dot.label-fail { fill: var(--red); }
.stripplot .dot.lenient, .stripplot .dot.harsh { stroke: var(--dark); stroke-width: 1.5; } .stripplot .tick, .stripplot .lane { font-size: 9px; fill: var(--mid); }
.runs { margin-top: 20px; } .runs > h3 { font-size: 15px; color: var(--navy); margin: 0 0 8px; }
.fold > summary { font-size: 14px; } .fold[open] > summary { margin-bottom: 8px; } .fold > .section-block { box-shadow: none; padding-top: 4px; }
.scatters { display: flex; flex-wrap: wrap; gap: 12px 20px; }
.scatter { width: 200px; } .scatter svg { width: 100%; height: auto; display: block; } .scatter figcaption small { display: block; color: var(--mid); font-weight: 400; }
.scatter .plot { fill: var(--offwhite); stroke: var(--slate); } .scatter .diag { stroke: var(--mid); stroke-dasharray: 3 3; }
.scatter .pt { fill-opacity: .85; } .scatter .pt.better { fill: var(--green); } .scatter .pt.worse { fill: var(--red); } .scatter .pt.tie { fill: var(--none); }
.scatter .n { font-size: 8px; fill: #fff; text-anchor: middle; font-weight: 700; pointer-events: none; }
.scatter .tick, .scatter .axis { font-size: 9px; fill: var(--mid); } .scatter .axis { fill: var(--dark); }
.latency-chart { margin: 12px 0; } .latency-chart svg { width: 100%; max-width: 760px; height: auto; display: block; }
.latency-chart .label { font-size: 11px; fill: var(--dark); } .latency-chart .val { font-size: 10px; fill: var(--mid); }
.latency-chart .p50.agent { fill: var(--navy); } .latency-chart .p50.judge { fill: var(--teal); } .latency-chart .p95 { stroke: var(--dark); stroke-width: 2; }
@media (max-width: 900px) { .grid-2, .method-grid { grid-template-columns: 1fr; } .grid-4 { grid-template-columns: repeat(2, 1fr); } .glossary-grid { grid-template-columns: 1fr; } }
@media (max-width: 640px) {
  body { font-size: 14px; } .page, .doc-header .inner { padding-left: 16px; padding-right: 16px; }
  .cmp-row { grid-template-columns: 1fr; } .bar-row { grid-template-columns: 4.5rem 1fr 4.5rem; }
  .expected dl, .intake dl { grid-template-columns: 1fr; } .dims li { grid-template-columns: 6.5rem 1fr 2.2rem; }
  .filter-bar { position: static; } .filter-bar input { flex: 1 1 100%; } nav.tabs { position: static; }
}
`;
