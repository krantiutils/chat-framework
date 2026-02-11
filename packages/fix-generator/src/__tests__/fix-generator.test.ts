import { describe, it, expect, vi, beforeEach } from 'vitest';

import { FixGenerator, FixGenerationError } from '../fix-generator.js';
import type { FixRequest, FixResponse } from '../types.js';

// ---------------------------------------------------------------------------
// Mock the Anthropic SDK
// ---------------------------------------------------------------------------

const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = 'APIError';
    }
  }

  class RateLimitError extends APIError {
    constructor(message = 'Rate limited') {
      super(429, message);
      this.name = 'RateLimitError';
    }
  }

  class InternalServerError extends APIError {
    constructor(message = 'Internal server error') {
      super(500, message);
      this.name = 'InternalServerError';
    }
  }

  class APIConnectionError extends Error {
    constructor(message = 'Connection failed') {
      super(message);
      this.name = 'APIConnectionError';
    }
  }

  // Anthropic SDK exposes error classes as static properties on the default export
  class MockAnthropic {
    messages = { create: mockCreate };
    constructor() {}

    static RateLimitError = RateLimitError;
    static InternalServerError = InternalServerError;
    static APIConnectionError = APIConnectionError;
    static APIError = APIError;
  }

  return {
    default: MockAnthropic,
    RateLimitError,
    InternalServerError,
    APIConnectionError,
    APIError,
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRequest(overrides: Partial<FixRequest> = {}): FixRequest {
  return {
    error: {
      message: 'Element not found: .compose-button',
      category: 'selector_not_found',
    },
    context: {
      networkLogs: [],
      lastWorkingCode: "await page.click('.compose-button');",
    },
    platform: 'instagram',
    affectedFunction: 'clickCompose',
    ...overrides,
  };
}

function makeAPIResponse(text: string) {
  return {
    content: [{ type: 'text', text }],
  };
}

function validFixJSON(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    diagnosis: 'Selector changed from .compose-button to .new-compose-btn',
    confidence: 0.9,
    patches: [
      {
        filePath: 'src/selectors.ts',
        originalCode: ".compose-button",
        newCode: ".new-compose-btn",
        description: 'Update selector',
      },
    ],
    testCases: [
      {
        name: 'test selector',
        filePath: 'src/__tests__/selectors.test.ts',
        code: 'test("selector", () => { expect(true).toBe(true); });',
        description: 'Validates selector update',
      },
    ],
    rollbackPlan: 'git revert HEAD',
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FixGenerator', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  describe('constructor', () => {
    it('throws if apiKey is missing', () => {
      expect(() => new FixGenerator({ apiKey: '' })).toThrow('apiKey is required');
    });

    it('applies default config values', () => {
      const gen = new FixGenerator({ apiKey: 'test-key' });
      const config = gen.getConfig();

      expect(config.model).toBe('claude-sonnet-4-5-20250929');
      expect(config.maxTokens).toBe(8192);
      expect(config.autoDeployThreshold).toBe(0.8);
      expect(config.maxRetries).toBe(2);
      expect(config.includeScreenshot).toBe(true);
    });

    it('respects custom config values', () => {
      const gen = new FixGenerator({
        apiKey: 'key',
        model: 'claude-opus-4-6',
        maxTokens: 4096,
        autoDeployThreshold: 0.9,
        maxRetries: 5,
        includeScreenshot: false,
      });
      const config = gen.getConfig();

      expect(config.model).toBe('claude-opus-4-6');
      expect(config.maxTokens).toBe(4096);
      expect(config.autoDeployThreshold).toBe(0.9);
      expect(config.maxRetries).toBe(5);
      expect(config.includeScreenshot).toBe(false);
    });
  });

  describe('generateFix', () => {
    it('calls Claude and returns parsed FixResponse', async () => {
      mockCreate.mockResolvedValueOnce(makeAPIResponse(validFixJSON()));

      const gen = new FixGenerator({ apiKey: 'test-key' });
      const result = await gen.generateFix(makeRequest());

      expect(result.diagnosis).toContain('Selector changed');
      expect(result.confidence).toBe(0.9);
      expect(result.patches).toHaveLength(1);
      expect(result.testCases).toHaveLength(1);
      expect(result.rollbackPlan).toBe('git revert HEAD');
      expect(result.rawModelResponse).toBeDefined();

      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 8192,
        }),
      );
    });

    it('validates originalCode against sourceFile when provided', async () => {
      mockCreate.mockResolvedValueOnce(
        makeAPIResponse(
          validFixJSON({
            patches: [
              {
                filePath: 'src/actions.ts',
                originalCode: 'code-that-does-not-exist',
                newCode: 'new code',
                description: 'bogus patch',
              },
            ],
          }),
        ),
      );

      const gen = new FixGenerator({ apiKey: 'test-key' });
      const result = await gen.generateFix(
        makeRequest({
          sourceFile: 'function doThing() { real code here }',
          sourceFilePath: 'src/actions.ts',
        }),
      );

      // Confidence should be downgraded
      expect(result.confidence).toBeLessThanOrEqual(0.3);
      expect(result.diagnosis).toContain('WARNING');
    });

    it('does not downgrade confidence when patch matches source', async () => {
      mockCreate.mockResolvedValueOnce(
        makeAPIResponse(
          validFixJSON({
            patches: [
              {
                filePath: 'src/actions.ts',
                originalCode: 'real code',
                newCode: 'new code',
                description: 'valid patch',
              },
            ],
          }),
        ),
      );

      const gen = new FixGenerator({ apiKey: 'test-key' });
      const result = await gen.generateFix(
        makeRequest({
          sourceFile: 'function doThing() { real code here }',
          sourceFilePath: 'src/actions.ts',
        }),
      );

      expect(result.confidence).toBe(0.9);
    });
  });

  describe('request validation', () => {
    it('rejects missing error message', async () => {
      const gen = new FixGenerator({ apiKey: 'key' });
      const bad = makeRequest();
      bad.error.message = '';

      await expect(gen.generateFix(bad)).rejects.toThrow(FixGenerationError);
      await expect(gen.generateFix(bad)).rejects.toThrow('error.message');
    });

    it('rejects missing error category', async () => {
      const gen = new FixGenerator({ apiKey: 'key' });
      const bad = makeRequest();
      (bad.error as Record<string, unknown>).category = '';

      await expect(gen.generateFix(bad)).rejects.toThrow('error.category');
    });

    it('rejects missing platform', async () => {
      const gen = new FixGenerator({ apiKey: 'key' });
      const bad = makeRequest();
      (bad as unknown as Record<string, unknown>).platform = '';

      await expect(gen.generateFix(bad)).rejects.toThrow('platform');
    });

    it('rejects missing affectedFunction', async () => {
      const gen = new FixGenerator({ apiKey: 'key' });
      const bad = makeRequest();
      bad.affectedFunction = '';

      await expect(gen.generateFix(bad)).rejects.toThrow('affectedFunction');
    });

    it('rejects missing lastWorkingCode', async () => {
      const gen = new FixGenerator({ apiKey: 'key' });
      const bad = makeRequest();
      bad.context.lastWorkingCode = '';

      await expect(gen.generateFix(bad)).rejects.toThrow('lastWorkingCode');
    });
  });

  describe('error handling', () => {
    it('wraps parse errors in FixGenerationError without retrying', async () => {
      mockCreate.mockResolvedValue(makeAPIResponse('not valid json at all'));

      const gen = new FixGenerator({ apiKey: 'key', maxRetries: 2 });
      const err = await gen.generateFix(makeRequest()).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(FixGenerationError);
      expect((err as FixGenerationError).message).toContain('parse');

      // Parse errors should NOT trigger retries — only 1 API call despite maxRetries=2
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('throws FixGenerationError for non-retryable API errors', async () => {
      mockCreate.mockRejectedValueOnce(new Error('Bad request'));

      const gen = new FixGenerator({ apiKey: 'key', maxRetries: 0 });
      await expect(gen.generateFix(makeRequest())).rejects.toThrow(FixGenerationError);
    });

    it('throws FixGenerationError when model returns no text blocks', async () => {
      mockCreate.mockResolvedValueOnce({ content: [] });

      const gen = new FixGenerator({ apiKey: 'key', maxRetries: 0 });
      await expect(gen.generateFix(makeRequest())).rejects.toThrow('no text content');
    });
  });

  describe('generateFixWithDecision', () => {
    it('returns shouldAutoDeploy=true for high-confidence fix with patches', async () => {
      mockCreate.mockResolvedValueOnce(makeAPIResponse(validFixJSON({ confidence: 0.95 })));

      const gen = new FixGenerator({ apiKey: 'key' });
      const { fix, shouldAutoDeploy } = await gen.generateFixWithDecision(makeRequest());

      expect(fix.confidence).toBe(0.95);
      expect(shouldAutoDeploy).toBe(true);
    });

    it('returns shouldAutoDeploy=false for low-confidence fix', async () => {
      mockCreate.mockResolvedValueOnce(makeAPIResponse(validFixJSON({ confidence: 0.5 })));

      const gen = new FixGenerator({ apiKey: 'key' });
      const { shouldAutoDeploy } = await gen.generateFixWithDecision(makeRequest());

      expect(shouldAutoDeploy).toBe(false);
    });

    it('returns shouldAutoDeploy=false when no patches', async () => {
      mockCreate.mockResolvedValueOnce(
        makeAPIResponse(validFixJSON({ confidence: 0.95, patches: [] })),
      );

      const gen = new FixGenerator({ apiKey: 'key' });
      const { shouldAutoDeploy } = await gen.generateFixWithDecision(makeRequest());

      expect(shouldAutoDeploy).toBe(false);
    });

    it('respects custom autoDeployThreshold', async () => {
      mockCreate.mockResolvedValueOnce(makeAPIResponse(validFixJSON({ confidence: 0.85 })));

      const gen = new FixGenerator({ apiKey: 'key', autoDeployThreshold: 0.9 });
      const { shouldAutoDeploy } = await gen.generateFixWithDecision(makeRequest());

      expect(shouldAutoDeploy).toBe(false);
    });
  });
});
