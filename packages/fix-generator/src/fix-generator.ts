/**
 * FixGenerator — orchestrates the full fix generation pipeline.
 *
 * Receives a FixRequest from the diagnosis engine, calls Claude to
 * generate a fix, parses and validates the response, and returns
 * a FixResponse ready for the deploy pipeline.
 */
import Anthropic from '@anthropic-ai/sdk';

import type {
  FixGeneratorConfig,
  FixRequest,
  FixResponse,
  ResolvedConfig,
} from './types.js';
import { buildMessages } from './prompt-builder.js';
import { parseResponse, ParseError } from './response-parser.js';

const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_AUTO_DEPLOY_THRESHOLD = 0.8;
const DEFAULT_MAX_RETRIES = 2;

export class FixGenerationError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'FixGenerationError';
  }
}

export class FixGenerator {
  private readonly config: ResolvedConfig;
  private readonly client: Anthropic;

  constructor(config: FixGeneratorConfig) {
    if (!config.apiKey) {
      throw new Error('apiKey is required for FixGenerator');
    }

    this.config = resolveConfig(config);
    this.client = new Anthropic({ apiKey: this.config.apiKey });
  }

  /**
   * Generate a fix for the given request.
   *
   * Retries on transient API errors up to config.maxRetries times.
   * Parse errors from malformed model output are NOT retried — they
   * indicate a prompt issue, not a transient failure.
   */
  async generateFix(request: FixRequest): Promise<FixResponse> {
    validateRequest(request);

    const { system, messages } = buildMessages(request, this.config);
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const response = await this.client.messages.create({
          model: this.config.model,
          max_tokens: this.config.maxTokens,
          system,
          messages,
        });

        const rawText = extractTextFromResponse(response);
        const fix = parseResponse(rawText);
        validatePatchesAgainstSource(fix, request);
        return fix;
      } catch (err) {
        if (err instanceof ParseError) {
          // Don't retry parse errors — the model produced unparseable output.
          throw new FixGenerationError(
            `Failed to parse model response: ${err.message}`,
            err,
          );
        }

        if (err instanceof FixGenerationError) {
          throw err;
        }

        lastError = err instanceof Error ? err : new Error(String(err));

        // Only retry on transient errors (rate limit, overloaded, network)
        if (!isTransientError(err) || attempt === this.config.maxRetries) {
          throw new FixGenerationError(
            `API call failed after ${attempt + 1} attempt(s): ${lastError.message}`,
            lastError,
          );
        }

        // Exponential backoff: 1s, 2s, 4s...
        const delayMs = 1000 * Math.pow(2, attempt);
        await sleep(delayMs);
      }
    }

    // Should be unreachable, but TypeScript doesn't know that
    throw new FixGenerationError(
      `Exhausted retries: ${lastError?.message ?? 'unknown error'}`,
      lastError,
    );
  }

  /**
   * Convenience: generate a fix and return it with a deployment decision.
   */
  async generateFixWithDecision(
    request: FixRequest,
  ): Promise<{ fix: FixResponse; shouldAutoDeploy: boolean }> {
    const fix = await this.generateFix(request);
    const shouldAutoDeploy =
      fix.confidence >= this.config.autoDeployThreshold &&
      fix.patches.length > 0;

    return { fix, shouldAutoDeploy };
  }

  /** Expose resolved config for testing/inspection. */
  getConfig(): Readonly<ResolvedConfig> {
    return this.config;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveConfig(config: FixGeneratorConfig): ResolvedConfig {
  return {
    apiKey: config.apiKey,
    model: config.model ?? DEFAULT_MODEL,
    maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
    autoDeployThreshold: config.autoDeployThreshold ?? DEFAULT_AUTO_DEPLOY_THRESHOLD,
    maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
    includeScreenshot: config.includeScreenshot ?? true,
  };
}

function validateRequest(request: FixRequest): void {
  if (!request.error?.message) {
    throw new FixGenerationError('FixRequest.error.message is required');
  }
  if (!request.error?.category) {
    throw new FixGenerationError('FixRequest.error.category is required');
  }
  if (!request.platform) {
    throw new FixGenerationError('FixRequest.platform is required');
  }
  if (!request.affectedFunction) {
    throw new FixGenerationError('FixRequest.affectedFunction is required');
  }
  if (!request.context?.lastWorkingCode) {
    throw new FixGenerationError('FixRequest.context.lastWorkingCode is required');
  }
}

function extractTextFromResponse(response: Anthropic.Messages.Message): string {
  const textBlocks = response.content.filter(
    (block): block is Anthropic.Messages.TextBlock => block.type === 'text',
  );

  if (textBlocks.length === 0) {
    throw new FixGenerationError('Model returned no text content blocks');
  }

  return textBlocks.map((b) => b.text).join('\n');
}

/**
 * Validate that patches reference code that actually exists in the source.
 *
 * This is a best-effort check — we can only verify if the source file
 * content was provided in the request. Patches targeting other files
 * are allowed but logged as warnings in the response.
 */
function validatePatchesAgainstSource(fix: FixResponse, request: FixRequest): void {
  if (!request.sourceFile) return;

  for (const patch of fix.patches) {
    // Only validate patches targeting the same file as the request
    if (request.sourceFilePath && patch.filePath === request.sourceFilePath) {
      if (!request.sourceFile.includes(patch.originalCode)) {
        // Downgrade confidence rather than rejecting — the model may have
        // been close but not exact in its matching
        fix.confidence = Math.min(fix.confidence, 0.3);
        fix.diagnosis +=
          '\n\n[WARNING: Patch originalCode does not match source file exactly. ' +
          'Manual review required.]';
      }
    }
  }
}

function isTransientError(err: unknown): boolean {
  if (err instanceof Anthropic.RateLimitError) return true;
  if (err instanceof Anthropic.InternalServerError) return true;
  if (err instanceof Anthropic.APIConnectionError) return true;
  // Overloaded
  if (
    err instanceof Anthropic.APIError &&
    err.status === 529
  ) {
    return true;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
