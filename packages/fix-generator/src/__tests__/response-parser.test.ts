import { describe, it, expect } from 'vitest';

import { parseResponse, ParseError } from '../response-parser.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validJSON(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    diagnosis: 'Instagram changed the DM compose button selector from .x1 to .x2',
    confidence: 0.92,
    patches: [
      {
        filePath: 'packages/adapters/src/instagram/selectors.ts',
        originalCode: "const COMPOSE_BTN = '.x1a2b3c';",
        newCode: "const COMPOSE_BTN = '.x2d4e5f';",
        description: 'Update compose button selector to match new Instagram UI',
      },
    ],
    testCases: [
      {
        name: 'should find compose button with new selector',
        filePath: 'packages/adapters/src/instagram/__tests__/selectors.test.ts',
        code: "import { describe, it, expect } from 'vitest';\n\ndescribe('selectors', () => {\n  it('should match compose button', () => {\n    expect('.x2d4e5f').toBeTruthy();\n  });\n});",
        description: 'Validates the updated compose button selector',
      },
    ],
    rollbackPlan: 'Revert selectors.ts to previous commit: git checkout HEAD~1 -- packages/adapters/src/instagram/selectors.ts',
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('parseResponse', () => {
  describe('valid responses', () => {
    it('parses a well-formed JSON response', () => {
      const result = parseResponse(validJSON());

      expect(result.diagnosis).toContain('Instagram changed');
      expect(result.confidence).toBe(0.92);
      expect(result.patches).toHaveLength(1);
      expect(result.patches[0].filePath).toBe('packages/adapters/src/instagram/selectors.ts');
      expect(result.patches[0].originalCode).toBe("const COMPOSE_BTN = '.x1a2b3c';");
      expect(result.patches[0].newCode).toBe("const COMPOSE_BTN = '.x2d4e5f';");
      expect(result.testCases).toHaveLength(1);
      expect(result.testCases[0].name).toBe('should find compose button with new selector');
      expect(result.rollbackPlan).toContain('git checkout');
      expect(result.rawModelResponse).toBeDefined();
    });

    it('parses JSON wrapped in markdown code fences', () => {
      const wrapped = '```json\n' + validJSON() + '\n```';
      const result = parseResponse(wrapped);

      expect(result.confidence).toBe(0.92);
      expect(result.patches).toHaveLength(1);
    });

    it('parses JSON wrapped in plain code fences', () => {
      const wrapped = '```\n' + validJSON() + '\n```';
      const result = parseResponse(wrapped);

      expect(result.confidence).toBe(0.92);
    });

    it('parses JSON with surrounding prose', () => {
      const wrapped = 'Here is my analysis:\n\n' + validJSON() + '\n\nLet me know if you need more.';
      const result = parseResponse(wrapped);

      expect(result.confidence).toBe(0.92);
    });

    it('handles multiple patches', () => {
      const json = validJSON({
        patches: [
          {
            filePath: 'a.ts',
            originalCode: 'old1',
            newCode: 'new1',
            description: 'first patch',
          },
          {
            filePath: 'b.ts',
            originalCode: 'old2',
            newCode: 'new2',
            description: 'second patch',
          },
        ],
      });

      const result = parseResponse(json);
      expect(result.patches).toHaveLength(2);
      expect(result.patches[0].filePath).toBe('a.ts');
      expect(result.patches[1].filePath).toBe('b.ts');
    });

    it('handles zero test cases', () => {
      const json = validJSON({ testCases: [] });
      const result = parseResponse(json);
      expect(result.testCases).toHaveLength(0);
    });

    it('handles zero patches', () => {
      const json = validJSON({ patches: [] });
      const result = parseResponse(json);
      expect(result.patches).toHaveLength(0);
    });

    it('handles confidence at boundary values', () => {
      expect(parseResponse(validJSON({ confidence: 0 })).confidence).toBe(0);
      expect(parseResponse(validJSON({ confidence: 1 })).confidence).toBe(1);
      expect(parseResponse(validJSON({ confidence: 0.5 })).confidence).toBe(0.5);
    });
  });

  // ---------------------------------------------------------------------------
  // Error cases: JSON extraction
  // ---------------------------------------------------------------------------

  describe('JSON extraction failures', () => {
    it('throws ParseError for empty string', () => {
      expect(() => parseResponse('')).toThrow(ParseError);
      expect(() => parseResponse('')).toThrow('Could not extract JSON');
    });

    it('throws ParseError for non-JSON text', () => {
      expect(() => parseResponse('I cannot help with that.')).toThrow(ParseError);
    });

    it('throws ParseError for invalid JSON', () => {
      expect(() => parseResponse('{invalid json}')).toThrow(ParseError);
      expect(() => parseResponse('{invalid json}')).toThrow('Invalid JSON');
    });

    it('throws ParseError for JSON array', () => {
      expect(() => parseResponse('[1, 2, 3]')).toThrow(ParseError);
      expect(() => parseResponse('[1, 2, 3]')).toThrow('Expected a JSON object');
    });

    it('throws ParseError for JSON primitive', () => {
      expect(() => parseResponse('"just a string"')).toThrow(ParseError);
    });
  });

  // ---------------------------------------------------------------------------
  // Error cases: validation
  // ---------------------------------------------------------------------------

  describe('validation failures', () => {
    it('rejects missing diagnosis', () => {
      expect(() => parseResponse(validJSON({ diagnosis: '' }))).toThrow('diagnosis');
    });

    it('rejects non-string diagnosis', () => {
      expect(() => parseResponse(validJSON({ diagnosis: 123 }))).toThrow('diagnosis');
    });

    it('rejects confidence out of range', () => {
      expect(() => parseResponse(validJSON({ confidence: -0.1 }))).toThrow('confidence');
      expect(() => parseResponse(validJSON({ confidence: 1.1 }))).toThrow('confidence');
    });

    it('rejects non-number confidence', () => {
      expect(() => parseResponse(validJSON({ confidence: 'high' }))).toThrow('confidence');
    });

    it('rejects non-array patches', () => {
      expect(() => parseResponse(validJSON({ patches: 'not an array' }))).toThrow('patches');
    });

    it('rejects patch missing filePath', () => {
      const json = validJSON({
        patches: [{ originalCode: 'a', newCode: 'b', description: 'c' }],
      });
      expect(() => parseResponse(json)).toThrow('filePath');
    });

    it('rejects patch with empty originalCode', () => {
      const json = validJSON({
        patches: [{ filePath: 'a.ts', originalCode: '', newCode: 'b', description: 'c' }],
      });
      expect(() => parseResponse(json)).toThrow('originalCode');
    });

    it('rejects no-op patch (original === new)', () => {
      const json = validJSON({
        patches: [{ filePath: 'a.ts', originalCode: 'same', newCode: 'same', description: 'c' }],
      });
      expect(() => parseResponse(json)).toThrow('no-op');
    });

    it('rejects non-array testCases', () => {
      expect(() => parseResponse(validJSON({ testCases: {} }))).toThrow('testCases');
    });

    it('rejects test case missing name', () => {
      const json = validJSON({
        testCases: [{ filePath: 'test.ts', code: 'code', description: 'desc' }],
      });
      expect(() => parseResponse(json)).toThrow('name');
    });

    it('rejects test case with empty code', () => {
      const json = validJSON({
        testCases: [{ name: 'test', filePath: 'test.ts', code: '', description: 'desc' }],
      });
      expect(() => parseResponse(json)).toThrow('code');
    });

    it('rejects missing rollbackPlan', () => {
      expect(() => parseResponse(validJSON({ rollbackPlan: '' }))).toThrow('rollbackPlan');
    });

    it('rejects non-string rollbackPlan', () => {
      expect(() => parseResponse(validJSON({ rollbackPlan: 42 }))).toThrow('rollbackPlan');
    });
  });

  // ---------------------------------------------------------------------------
  // ParseError metadata
  // ---------------------------------------------------------------------------

  describe('ParseError', () => {
    it('includes the raw response for debugging', () => {
      try {
        parseResponse('garbage');
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ParseError);
        expect((err as ParseError).rawResponse).toBe('garbage');
      }
    });

    it('has name ParseError', () => {
      const e = new ParseError('test', 'raw');
      expect(e.name).toBe('ParseError');
    });
  });
});
