import { describe, expect, it } from 'vitest';
import { routeScoutIntake } from '../../../agents/scout/routing';
import type { ScoutRoutingInput } from '../../../types';
import { METRICS } from '../../registry';
import type { EvalCase, GradedRow, GraderResult } from '../../types';
import { NOT_SAVED, buildReviewRows, csvField, metricsByFixture, passCell, renderOutput, toCsv } from '../review';
import { loadFixtures } from '../run';

const scoutMetrics = [METRICS.scoutRouting, METRICS.scoutRationale];
const scoutCases = loadFixtures(METRICS.scoutRouting).slice(0, 2);

function result(over: Partial<GraderResult> & Pick<GraderResult, 'caseId' | 'metric' | 'grader'>): GraderResult {
  return { status: 'graded', isCorrect: true, score: 1, reasoning: '', dimensions: {}, ...over };
}

/** The cell under `column` in the row for `caseId`. */
function cell(table: ReturnType<typeof buildReviewRows>, caseId: string, column: string): string {
  const col = table.columns.indexOf(column);
  expect(col, `column ${column}`).toBeGreaterThanOrEqual(0);
  const row = table.rows.find((r) => r[0] === caseId);
  expect(row, `row ${caseId}`).toBeDefined();
  return row![col];
}

describe('csvField / toCsv', () => {
  it('leaves plain fields bare and quotes commas, quotes, CR and LF (RFC 4180)', () => {
    expect(csvField('plain text')).toBe('plain text');
    expect(csvField('a, b')).toBe('"a, b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line 1\nline 2')).toBe('"line 1\nline 2"');
    expect(csvField('cr\rhere')).toBe('"cr\rhere"');
    expect(csvField('')).toBe('');
  });

  it('writes a header then one record per row, CRLF-terminated', () => {
    const csv = toCsv({ columns: ['id', 'text'], rows: [['a', 'x,y'], ['b', 'two\nlines']] });
    expect(csv).toBe('id,text\r\na,"x,y"\r\nb,"two\nlines"\r\n');
  });
});

describe('passCell', () => {
  it('is PASS, FAIL, ERRORED: <code>, or blank when the grader did not run', () => {
    const base = { caseId: 'c', metric: 'm', grader: 'judge' as const };
    expect(passCell(result(base))).toBe('PASS');
    expect(passCell(result({ ...base, isCorrect: false }))).toBe('FAIL');
    expect(passCell(result({ ...base, status: 'errored', error: 'model_timeout', isCorrect: false }))).toBe(
      'ERRORED: model_timeout',
    );
    expect(passCell(undefined)).toBe('');
  });
});

describe('buildReviewRows', () => {
  const [first, second] = scoutCases;

  it('one row per case, with every metric on the fixture merged onto it in registry order', () => {
    const graded: GradedRow[] = [
      {
        caseId: first.id,
        metric: 'scoutRouting',
        grades: [
          result({ caseId: first.id, metric: 'scoutRouting', grader: 'heuristic', reasoning: 'h-ok' }),
          result({ caseId: first.id, metric: 'scoutRouting', grader: 'model', isCorrect: false, score: 0 }),
        ],
      },
      {
        caseId: first.id,
        metric: 'scoutRationale',
        grades: [
          result({ caseId: first.id, metric: 'scoutRationale', grader: 'judge', source: 'template', score: 0.875 }),
          result({ caseId: first.id, metric: 'scoutRationale', grader: 'judge', source: 'model', reasoning: 'm-ok' }),
        ],
      },
    ];
    const table = buildReviewRows(scoutCases, scoutMetrics, graded);

    expect(table.rows).toHaveLength(scoutCases.length);
    expect(table.rows.every((r) => r.length === table.columns.length)).toBe(true);
    expect(table.columns.slice(0, 2)).toEqual(['case_id', 'note']);
    expect(table.columns).toContain('input.problem_description');
    expect(table.columns).toContain('expected.bucket');
    expect(table.columns.indexOf('scoutRouting.heuristic_pass')).toBeLessThan(
      table.columns.indexOf('scoutRationale.judge_template_pass'),
    );
    expect(table.columns.slice(-4)).toEqual(['template_output', 'model_output', 'human_verdict', 'human_notes']);

    expect(cell(table, first.id, 'input.problem_description')).toBe(first.input.problem_description);
    expect(cell(table, first.id, 'scoutRouting.heuristic_pass')).toBe('PASS');
    expect(cell(table, first.id, 'scoutRouting.heuristic_reason')).toBe('h-ok');
    expect(cell(table, first.id, 'scoutRouting.model_pass')).toBe('FAIL');
    expect(cell(table, first.id, 'scoutRationale.judge_template_score')).toBe('0.88');
    expect(cell(table, first.id, 'scoutRationale.judge_model_reasoning')).toBe('m-ok');
    expect(cell(table, first.id, 'human_verdict')).toBe('');
  });

  it('a heuristic-only metric gets no model or judge columns', () => {
    const table = buildReviewRows(scoutCases, [METRICS.scoutRouting], []);
    expect(table.columns.some((c) => c.includes('judge_'))).toBe(false);
    expect(table.columns).toContain('scoutRouting.model_pass');

    const scoring = METRICS.architectScoring;
    const scoringTable = buildReviewRows(loadFixtures(scoring).slice(0, 1), [scoring], []);
    expect(scoringTable.columns).not.toContain('template_output');
    expect(scoringTable.columns.filter((c) => c.startsWith('architectScoring.'))).toEqual([
      'architectScoring.heuristic_pass',
      'architectScoring.heuristic_reason',
    ]);
  });

  it('an errored grader reads ERRORED with no score; a grader that did not run is blank', () => {
    const graded: GradedRow[] = [
      {
        caseId: first.id,
        metric: 'scoutRationale',
        grades: [
          result({
            caseId: first.id,
            metric: 'scoutRationale',
            grader: 'judge',
            source: 'template',
            status: 'errored',
            error: 'judge_missing_verdict',
            isCorrect: false,
            score: 0,
          }),
        ],
      },
    ];
    const table = buildReviewRows(scoutCases, scoutMetrics, graded);

    expect(cell(table, first.id, 'scoutRationale.judge_template_pass')).toBe('ERRORED: judge_missing_verdict');
    expect(cell(table, first.id, 'scoutRationale.judge_template_score')).toBe('');
    // Not run at all: the model judge on this case, and every grader on the other case.
    expect(cell(table, first.id, 'scoutRationale.judge_model_pass')).toBe('');
    expect(cell(table, second.id, 'scoutRouting.heuristic_pass')).toBe('');
    expect(cell(table, second.id, 'model_output')).toBe('');
  });

  it('renders the saved outputs when the run persisted them', () => {
    const modelOutput = { ...routeScoutIntake(first.input as unknown as ScoutRoutingInput), rationale: 'MODEL says so.' };
    const graded: GradedRow[] = [
      {
        caseId: first.id,
        metric: 'scoutRationale',
        grades: [
          result({
            caseId: first.id,
            metric: 'scoutRationale',
            grader: 'judge',
            source: 'template',
            output: { ...modelOutput, rationale: 'TEMPLATE says so.' },
          }),
          result({ caseId: first.id, metric: 'scoutRationale', grader: 'judge', source: 'model', output: modelOutput }),
        ],
      },
    ];
    const table = buildReviewRows(scoutCases, scoutMetrics, graded);

    expect(cell(table, first.id, 'template_output')).toContain('rationale: TEMPLATE says so.');
    expect(cell(table, first.id, 'model_output')).toContain('rationale: MODEL says so.');
    expect(cell(table, first.id, 'model_output')).toContain(`bucket: ${modelOutput.bucket}`);
  });

  it('falls back for an old run: regenerates the template output, marks the model output not saved', () => {
    const graded: GradedRow[] = [
      {
        caseId: first.id,
        metric: 'scoutRouting',
        grades: [result({ caseId: first.id, metric: 'scoutRouting', grader: 'model' })],
      },
    ];
    const table = buildReviewRows(scoutCases, scoutMetrics, graded);
    const template = routeScoutIntake(first.input as unknown as ScoutRoutingInput);

    expect(cell(table, first.id, 'template_output')).toContain(`rationale: ${template.rationale}`);
    expect(cell(table, first.id, 'model_output')).toBe(NOT_SAVED);
  });

  it('says why there is no model output when every model row errored', () => {
    const graded: GradedRow[] = [
      {
        caseId: first.id,
        metric: 'scoutRouting',
        grades: [
          result({
            caseId: first.id,
            metric: 'scoutRouting',
            grader: 'model',
            status: 'errored',
            error: 'model_timeout',
            isCorrect: false,
            score: 0,
          }),
        ],
      },
    ];
    const table = buildReviewRows(scoutCases, scoutMetrics, graded);
    expect(cell(table, first.id, 'model_output')).toBe('(no output — model path errored: model_timeout)');
  });

  it('the whole table round-trips through toCsv with one record per case', () => {
    const csv = toCsv(buildReviewRows(scoutCases, scoutMetrics, []));
    // Embedded newlines live inside quotes, so count unquoted CRLFs only.
    expect(csv.split('\r\n').filter((line) => line.length > 0)).toHaveLength(scoutCases.length + 1);
  });
});

describe('renderOutput', () => {
  it('renders known agent shapes as text and anything else as JSON', () => {
    expect(renderOutput({ subject: 'Hello', body: 'Body text.' })).toBe('Subject: Hello\n\nBody text.');
    expect(renderOutput({ headline: 'H', narrative: 'N', outcomes: ['o1'], readiness: 'ready' })).toContain('- o1');
    expect(renderOutput({ other: 1 })).toBe('{\n  "other": 1\n}');
    expect(renderOutput(undefined)).toBe('');
  });

  it('renders an architect draft compactly', () => {
    const architect = METRICS.architectCharter;
    const [charterCase]: EvalCase[] = loadFixtures(architect);
    const text = renderOutput(new architect.judgeCls!().template(charterCase));
    expect(text).toMatch(/^Title: /);
    expect(text).toContain('Phases:');
    expect(text).toContain('Days 1–30');
  });
});

describe('metricsByFixture', () => {
  it('groups metrics that share a fixture, in registry order', () => {
    const groups = metricsByFixture(METRICS);
    expect(groups.get('scoutRouting')?.map((m) => m.name)).toEqual(['scoutRouting', 'scoutRationale', 'scoutGrounding']);
    expect(groups.get('architectCharter')?.map((m) => m.name)).toEqual(['architectPlanStructure', 'architectCharter', 'architectGrounding']);
  });
});
