import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayRequest } from '../../../model/types';

// The gateway is mocked: judges and the agents' model paths both call `callModel()`, so
// one fake sees every request and answers by agent + promptVersion. No key, no network.
const gateway = vi.hoisted(() => ({
  requests: [] as GatewayRequest[],
  respond: (() => {
    throw new Error('respond not set');
  }) as (req: GatewayRequest) => unknown,
}));

vi.mock('../../../model/gateway', () => ({
  hasModelKey: () => true,
  callModel: vi.fn(async (req: GatewayRequest) => {
    gateway.requests.push(req);
    return { object: gateway.respond(req), runId: null };
  }),
}));

const { gradeCase, gradeMetric, loadFixtures } = await import('../run');
const { METRICS } = await import('../../registry');
const { summarize } = await import('../../metrics/passRate');
const { resetScheduler } = await import('../../scheduler');
const { GatewayError } = await import('../../../model/errors');

/** The case ids a batched judge prompt carries, from its `### Item <id>` headings. */
const itemIds = (req: GatewayRequest) => [...(req.prompt ?? '').matchAll(/^### Item (\S+)$/gm)].map((m) => m[1]);
/** A batch reply with one verdict per item in the prompt. */
/** Every judge's dimension names; applyRubric keeps the judge's own and drops the rest. */
const ALL_DIMENSIONS = ['accurate', 'grounded', 'clear', 'proportionate', 'consistent', 'appropriate'];
const verdicts = (req: GatewayRequest, over: { isCorrect?: boolean; score?: number } = {}) => ({
  verdicts: itemIds(req).map((caseId) => ({
    caseId,
    isCorrect: true,
    score: 0.9,
    reasoning: 'ok',
    dimensions: ALL_DIMENSIONS.map((name) => ({ name, value: over.isCorrect === false ? 0 : 1 })),
    ...over,
  })),
});
const MODEL_SUBJECT = 'MODEL-WRITTEN SUBJECT 7f3a';
const isJudge = (req: GatewayRequest) => req.promptVersion?.startsWith('judge:') ?? false;
const judgePrompts = () => gateway.requests.filter(isJudge).map((r) => r.prompt ?? '');

beforeEach(() => {
  resetScheduler({ minIntervalMs: 0, maxRetries: 0, baseBackoffMs: 0, sleep: async () => {}, now: () => 0 });
  gateway.requests = [];
  gateway.respond = (req) =>
    isJudge(req) ? verdicts(req) : { subject: MODEL_SUBJECT, body: 'Model body text for the draft.' };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadFixtures', () => {
  it('follows a fixture redirect: scoutRationale grades the scoutRouting cases', () => {
    const rationale = loadFixtures(METRICS.scoutRationale);
    const routing = loadFixtures(METRICS.scoutRouting);
    expect(rationale.length).toBeGreaterThan(0);
    expect(rationale.map((c) => c.id)).toEqual(routing.map((c) => c.id));
  });

  it('a metric without a redirect loads its own file', () => {
    expect(loadFixtures(METRICS.envoyDraft).length).toBeGreaterThan(0);
  });
});

describe('gradeCase', () => {
  const envoy = METRICS.envoyDraft;
  const [envoyCase] = loadFixtures(envoy);

  it('runs no judge and no model path when neither is enabled', async () => {
    const rows = await gradeCase(envoy, envoyCase, { judgesRan: false, modelRan: false });
    expect(rows).toEqual([]);
    expect(gateway.requests).toHaveLength(0);
  });

  it('judges the template output, then the model output, tagged by source', async () => {
    const rows = await gradeCase(envoy, envoyCase, { judgesRan: true, modelRan: true });

    expect(rows.map((r) => [r.grader, r.source, r.status])).toEqual([
      ['judge', 'template', 'graded'],
      ['judge', 'model', 'graded'],
    ]);
    const [templatePrompt, modelPrompt] = judgePrompts();
    // The model-output judge sees the model's prose; the template judge does not.
    expect(modelPrompt).toContain(MODEL_SUBJECT);
    expect(templatePrompt).not.toContain(MODEL_SUBJECT);
    // Both carry the golden facts from `expected`.
    for (const prompt of [templatePrompt, modelPrompt]) {
      expect(prompt).toContain('Facts the output should reflect');
    }
    // Each judge row carries the output it judged, for the review export.
    expect(rows[0].output).toEqual(new envoy.judgeCls!().template(envoyCase));
    expect(rows[1].output).toMatchObject({ subject: MODEL_SUBJECT });
  });

  it('judges only the template output when the model path is off', async () => {
    const rows = await gradeCase(envoy, envoyCase, { judgesRan: true, modelRan: false });
    expect(rows.map((r) => r.source)).toEqual(['template']);
  });

  it('a model-path failure is an errored model row, and the template judge still grades', async () => {
    gateway.respond = (req) => {
      if (isJudge(req)) return verdicts(req);
      throw new GatewayError('model_timeout', 504, 'timed out');
    };
    const rows = await gradeCase(envoy, envoyCase, { judgesRan: true, modelRan: true });

    expect(rows[0]).toMatchObject({ source: 'template', status: 'graded' });
    expect(rows[1]).toMatchObject({ source: 'model', status: 'errored', error: 'model:model_timeout' });
    // Nothing was produced, so nothing is saved as the judged output.
    expect(rows[1].output).toBeUndefined();
    // No output, so no judge call for the model row.
    expect(judgePrompts()).toHaveLength(1);
  });

  it('a metric with no modelOutput producer gets the template judge only', async () => {
    // Every registered judge metric now has a producer; strip one to test the branch.
    const charter = { ...METRICS.architectCharter, modelOutput: undefined };
    const [charterCase] = loadFixtures(charter);
    const rows = await gradeCase(charter, charterCase, { judgesRan: true, modelRan: true });
    expect(rows.map((r) => r.source)).toEqual(['template']);
  });

  it("architectCharter judges Architect's model output beside the template", async () => {
    const charter = METRICS.architectCharter;
    const [charterCase] = loadFixtures(charter);
    gateway.respond = (req) =>
      isJudge(req) ? verdicts(req) : { background: MODEL_SUBJECT, scopeStatement: 'Model scope.' };
    const rows = await gradeCase(charter, charterCase, { judgesRan: true, modelRan: true });

    expect(rows.map((r) => [r.source, r.status])).toEqual([
      ['template', 'graded'],
      ['model', 'graded'],
    ]);
    const [templatePrompt, modelPrompt] = judgePrompts();
    expect(modelPrompt).toContain(MODEL_SUBJECT);
    expect(templatePrompt).not.toContain(MODEL_SUBJECT);
  });

  it('architectPlanStructure grades the model path on the same cases; a failure is errored', async () => {
    const structure = METRICS.architectPlanStructure;
    const [structureCase] = loadFixtures(structure);
    expect(structureCase.id).toBe(loadFixtures(METRICS.architectCharter)[0].id);

    // A model that tries to change the structure: the merge drops it, the case passes.
    gateway.respond = () => ({ shape: 'accelerate', workstreams: [], background: 'Model prose.' });
    const rows = await gradeCase(structure, structureCase, { judgesRan: true, modelRan: true });
    expect(rows.map((r) => [r.grader, r.status, r.isCorrect])).toEqual([
      ['heuristic', 'graded', true],
      ['model', 'graded', true],
    ]);
    // The heuristic row's output is regenerable, so not saved; the model row's is.
    expect(rows[0].output).toBeUndefined();
    expect(rows[1].output).toMatchObject({ charter: expect.any(Object), plan: { shape: expect.any(String) } });

    gateway.respond = () => {
      throw new GatewayError('model_timeout', 504, 'timed out');
    };
    // A new run: within one run the case's model output is shared, so it would be reused.
    resetScheduler({ minIntervalMs: 0, maxRetries: 0, baseBackoffMs: 0, sleep: async () => {}, now: () => 0 });
    const failed = await gradeCase(structure, structureCase, { judgesRan: true, modelRan: true });
    expect(failed[1]).toMatchObject({ grader: 'model', status: 'errored' });
    expect(failed[1].output).toBeUndefined();
  });

  it('scoutRationale judges a scoutRouting case with the reference routing as facts', async () => {
    const rationale = METRICS.scoutRationale;
    const [scoutCase] = loadFixtures(rationale);
    gateway.respond = (req) => (isJudge(req) ? verdicts(req) : modelScoutRouting());
    const rows = await gradeCase(rationale, scoutCase, { judgesRan: true, modelRan: true });

    expect(rows.map((r) => [r.source, r.status])).toEqual([
      ['template', 'graded'],
      ['model', 'graded'],
    ]);
    const expected = scoutCase.expected as { bucket: string };
    for (const prompt of judgePrompts()) expect(prompt).toContain(expected.bucket);
  });
});

describe('summarize splits template and model judges', () => {
  it('reports model-output judge rows apart from the gated template rate', async () => {
    const envoy = METRICS.envoyDraft;
    const [envoyCase] = loadFixtures(envoy);
    gateway.respond = (req) =>
      isJudge(req)
        ? req.prompt?.includes(MODEL_SUBJECT)
          ? verdicts(req, { isCorrect: false, score: 0.2 })
          : verdicts(req)
        : { subject: MODEL_SUBJECT, body: 'Model body text for the draft.' };
    const rows = await gradeCase(envoy, envoyCase, { judgesRan: true, modelRan: true });
    const s = summarize('envoyDraft', rows);

    expect(s.nJudge).toBe(1);
    expect(s.judgePassRate).toBe(1);
    expect(s.nModelJudge).toBe(1);
    expect(s.modelJudgePassRate).toBe(0);
    expect(s.modelJudgeMeanScore).toBeCloseTo(0.2);
  });
});

/** A plausible model reply for Scout's schema — fields only the model owns. */
function modelScoutRouting(): unknown {
  return {
    bucket: 'ML / Predictive',
    confidence: 'High',
    rationale: 'MODEL rationale for routing.',
    flags: [],
    poc_score: 3,
    clarity_score: 3,
    foothold_score: 3,
  };
}

describe('gradeMetric batches the judge', () => {
  const envoy = METRICS.envoyDraft;
  const cases = loadFixtures(envoy);

  it('judges every case in groups of EVAL_JUDGE_BATCH_SIZE, one verdict each, in case order', async () => {
    vi.stubEnv('EVAL_JUDGE_BATCH_SIZE', '4');
    const rows = await gradeMetric(envoy, cases, { judgesRan: true, modelRan: true });

    const groups = Math.ceil(cases.length / 4);
    // Template and model outputs are judged separately: two sets of groups.
    expect(gateway.requests.filter(isJudge)).toHaveLength(2 * groups);
    expect(rows.map((r) => r.map((g) => [g.caseId, g.source, g.status]))).toEqual(
      cases.map((c) => [
        [c.id, 'template', 'graded'],
        [c.id, 'model', 'graded'],
      ]),
    );
    vi.unstubAllEnvs();
  });

  it('a case the batch reply omits is errored judge_missing_verdict; the rest still grade', async () => {
    const [missing] = cases;
    gateway.respond = (req) => {
      if (!isJudge(req)) return { subject: MODEL_SUBJECT, body: 'Model body text for the draft.' };
      const reply = verdicts(req);
      return { verdicts: reply.verdicts.filter((v) => v.caseId !== missing.id) };
    };
    const rows = await gradeMetric(envoy, cases, { judgesRan: true, modelRan: false });

    expect(rows[0][0]).toMatchObject({ status: 'errored', error: 'judge_missing_verdict' });
    // The output was judged-for even though no verdict came back; keep it for review.
    expect(rows[0][0].output).toMatchObject({ subject: expect.any(String) });
    expect(rows.slice(1).every(([g]) => g.status === 'graded')).toBe(true);
  });

  it('a failed judge call errors every case in its group, with the gateway code', async () => {
    gateway.respond = () => {
      throw new GatewayError('model_unavailable', 503, 'high demand');
    };
    const rows = await gradeMetric(envoy, cases, { judgesRan: true, modelRan: false });
    expect(rows.every(([g]) => g.status === 'errored' && g.error === 'model_unavailable')).toBe(true);
  });
});

describe('EVAL_MODEL_SAMPLES: the model path is sampled, the template is not', () => {
  it('calls the model once per sample per case, tags every row, and keys the share on the sample', async () => {
    let n = 0;
    // Each Scout call answers with a different rationale, so a second sample is a fresh call
    // whose output is visible as its own.
    gateway.respond = (req) =>
      isJudge(req) ? verdicts(req) : { ...(modelScoutRouting() as object), rationale: `MODEL rationale ${n++}.` };
    const cases = loadFixtures(METRICS.scoutRouting).slice(0, 2);
    const options = { judgesRan: true, modelRan: true, samples: 3 };

    const routingRows = await gradeMetric(METRICS.scoutRouting, cases, options);
    const rationaleRows = await gradeMetric(METRICS.scoutRationale, cases, options);

    // Two cases, three samples, one Scout call each — and both metrics share them.
    const scoutCalls = gateway.requests.filter((r) => !isJudge(r) && r.agent === 'scout');
    expect(scoutCalls).toHaveLength(6);

    for (const rows of routingRows) {
      const model = rows.filter((g) => g.grader === 'model');
      expect(model.map((g) => g.sample)).toEqual([0, 1, 2]);
      expect(rows.filter((g) => g.grader === 'heuristic').map((g) => g.sample)).toEqual([undefined]);
    }
    for (const rows of rationaleRows) {
      const modelJudge = rows.filter((g) => g.source === 'model');
      expect(modelJudge.map((g) => g.sample)).toEqual([0, 1, 2]);
      // The judge saw the producer's output for that sample, not sample 0's.
      const outputs = modelJudge.map((g) => (g.output as { rationale: string }).rationale);
      expect(new Set(outputs).size).toBe(3);
      expect(rows.filter((g) => g.source === 'template').map((g) => g.sample)).toEqual([undefined]);
    }
    // The model row and the model judge row for the same sample share the one output.
    const modelOut = routingRows[0].filter((g) => g.grader === 'model').map((g) => g.output);
    const judgedOut = rationaleRows[0].filter((g) => g.source === 'model').map((g) => g.output);
    expect(judgedOut).toEqual(modelOut);
  });

  it('defaults to one sample, with no sample index on the rows', async () => {
    gateway.respond = (req) => (isJudge(req) ? verdicts(req) : modelScoutRouting());
    const cases = loadFixtures(METRICS.scoutRouting).slice(0, 1);
    const [rows] = await gradeMetric(METRICS.scoutRouting, cases, { judgesRan: false, modelRan: true });
    expect(rows.filter((g) => g.grader === 'model')).toHaveLength(1);
  });

  it('summarizes a sampled run from sample 0 and reports agreement', async () => {
    let n = 0;
    const cases = loadFixtures(METRICS.scoutRouting).filter((c) => c.expected.bucket === 'ML / Predictive').slice(0, 2);
    // Sample 0 is produced for every case before sample 1: the first two calls match the
    // fixture's bucket, the next two route to a wrong one.
    gateway.respond = (req) => {
      if (isJudge(req)) return verdicts(req);
      const sample0 = n++ < cases.length;
      return { ...(modelScoutRouting() as object), bucket: sample0 ? 'ML / Predictive' : 'Advisory / Strategy' };
    };
    const rows = await gradeMetric(METRICS.scoutRouting, cases, { judgesRan: false, modelRan: true, samples: 2 });
    const s = summarize('scoutRouting', rows.flat());
    expect(s.nModel).toBe(2);
    expect(s.modelPassRate).toBe(1);
    expect(s.agreement?.nSamples).toBe(2);
    expect(s.agreement?.model).toBe(0);
    expect(s.agreement?.modelJudge).toBeNull();
  });
});

describe('agent model output is shared across metrics', () => {
  it('scoutRouting and scoutRationale make one Scout model call per case between them', async () => {
    gateway.respond = (req) => (isJudge(req) ? verdicts(req) : modelScoutRouting());
    const cases = loadFixtures(METRICS.scoutRouting).slice(0, 3);
    const options = { judgesRan: true, modelRan: true };

    const [routingRows] = await gradeMetric(METRICS.scoutRouting, cases, options);
    const [rationaleRows] = await gradeMetric(METRICS.scoutRationale, cases, options);

    const scoutCalls = gateway.requests.filter((r) => !isJudge(r) && r.agent === 'scout');
    expect(scoutCalls).toHaveLength(cases.length);
    // Both metrics save the one shared model output: the model-path row and the model judge row.
    const modelRow = routingRows.find((g) => g.grader === 'model');
    const modelJudgeRow = rationaleRows.find((g) => g.source === 'model');
    expect(modelRow?.output).toMatchObject({ rationale: 'MODEL rationale for routing.' });
    expect(modelJudgeRow?.output).toEqual(modelRow?.output);
  });
});
