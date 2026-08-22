import { google } from '@ai-sdk/google';
import { generateObject } from 'ai';
import type { GatewayRequest, GatewayResponse } from './types';
import { GatewayError, classifyModelError } from './errors';
import { recordRun } from '../observability/recorder';

const MODEL_KEY = 'GOOGLE_GENERATIVE_AI_API_KEY';
const DEFAULT_MODEL = 'gemini-2.5-flash';

function requireModelKey(): string | null {
  const value = process.env[MODEL_KEY];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function callModel<T>(
  request: GatewayRequest<T>,
): Promise<GatewayResponse<T>> {
  if (!requireModelKey()) {
    throw new GatewayError('model_key_missing', 503, 'No model key configured');
  }

  const modelId = request.model ?? process.env.GATEWAY_MODEL ?? DEFAULT_MODEL;
  const start = Date.now();
  let output: T;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (generateObject as any)({
      model: google(modelId),
      schema: request.schema,
      prompt: request.prompt,
    });
    output = result.object as T;
  } catch (err) {
    const durationMs = Date.now() - start;
    const gwErr = classifyModelError(err);

    const runId = await recordRun({
      agent: request.agent,
      organizationId: request.organizationId,
      engagementId: request.engagementId,
      model: modelId,
      promptVersion: request.promptVersion,
      input: { prompt: request.prompt },
      output: null,
      error: { code: gwErr.code, message: gwErr.message },
      durationMs,
    });

    console.error(`gateway [${request.agent}]: ${gwErr.code}`, gwErr.cause);
    (gwErr as GatewayError & { runId?: string }).runId = runId;
    throw gwErr;
  }

  const durationMs = Date.now() - start;
  const runId = await recordRun({
    agent: request.agent,
    organizationId: request.organizationId,
    engagementId: request.engagementId,
    model: modelId,
    promptVersion: request.promptVersion,
    input: { prompt: request.prompt },
    output: output as unknown as Record<string, unknown>,
    error: null,
    durationMs,
  });

  return { object: output, runId };
}
