/**
 * Parses and validates Claude's response into a structured FixResponse.
 *
 * Claude is instructed to return raw JSON, but models sometimes wrap it
 * in markdown fences or add commentary. This parser handles those cases
 * and validates the structural integrity of the result.
 */
import type {
  CodePatch,
  FixResponse,
  TestCase,
} from './types.js';

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly rawResponse: string,
  ) {
    super(message);
    this.name = 'ParseError';
  }
}

/**
 * Parse raw model output into a validated FixResponse.
 *
 * @throws {ParseError} if the response cannot be parsed or fails validation.
 */
export function parseResponse(raw: string): FixResponse {
  const jsonStr = extractJSON(raw);
  if (jsonStr === null) {
    throw new ParseError(
      'Could not extract JSON from model response. Expected a JSON object.',
      raw,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    throw new ParseError(
      `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      raw,
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ParseError('Expected a JSON object at the top level.', raw);
  }

  const obj = parsed as Record<string, unknown>;
  return validateAndBuild(obj, raw);
}

// ---------------------------------------------------------------------------
// JSON extraction
// ---------------------------------------------------------------------------

/**
 * Extract JSON from potentially wrapped text.
 *
 * Handles:
 * 1. Raw JSON (starts with `{`)
 * 2. Markdown-fenced JSON (```json ... ```)
 * 3. JSON embedded in prose (first `{` to last `}`)
 */
function extractJSON(raw: string): string | null {
  const trimmed = raw.trim();

  // Case 1: raw JSON
  if (trimmed.startsWith('{')) {
    return trimmed;
  }

  // Case 2: markdown fences
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  // Case 3: find the outermost { ... }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateAndBuild(
  obj: Record<string, unknown>,
  raw: string,
): FixResponse {
  // diagnosis
  if (typeof obj.diagnosis !== 'string' || obj.diagnosis.length === 0) {
    throw new ParseError('Missing or empty "diagnosis" field.', raw);
  }

  // confidence
  if (typeof obj.confidence !== 'number' || obj.confidence < 0 || obj.confidence > 1) {
    throw new ParseError(
      `"confidence" must be a number between 0 and 1, got ${JSON.stringify(obj.confidence)}.`,
      raw,
    );
  }

  // patches
  if (!Array.isArray(obj.patches)) {
    throw new ParseError('"patches" must be an array.', raw);
  }
  const patches = obj.patches.map((p: unknown, i: number) => validatePatch(p, i, raw));

  // testCases
  if (!Array.isArray(obj.testCases)) {
    throw new ParseError('"testCases" must be an array.', raw);
  }
  const testCases = obj.testCases.map((t: unknown, i: number) => validateTestCase(t, i, raw));

  // rollbackPlan
  if (typeof obj.rollbackPlan !== 'string' || obj.rollbackPlan.length === 0) {
    throw new ParseError('Missing or empty "rollbackPlan" field.', raw);
  }

  return {
    diagnosis: obj.diagnosis,
    confidence: obj.confidence,
    patches,
    testCases,
    rollbackPlan: obj.rollbackPlan,
    rawModelResponse: raw,
  };
}

function validatePatch(value: unknown, index: number, raw: string): CodePatch {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ParseError(`patches[${index}] must be an object.`, raw);
  }

  const p = value as Record<string, unknown>;

  const requiredStrings: Array<[string, keyof CodePatch]> = [
    ['filePath', 'filePath'],
    ['originalCode', 'originalCode'],
    ['newCode', 'newCode'],
    ['description', 'description'],
  ];

  for (const [field] of requiredStrings) {
    if (typeof p[field] !== 'string' || (p[field] as string).length === 0) {
      throw new ParseError(`patches[${index}].${field} must be a non-empty string.`, raw);
    }
  }

  if (p.originalCode === p.newCode) {
    throw new ParseError(
      `patches[${index}].originalCode and newCode are identical — this is a no-op patch.`,
      raw,
    );
  }

  return {
    filePath: p.filePath as string,
    originalCode: p.originalCode as string,
    newCode: p.newCode as string,
    description: p.description as string,
  };
}

function validateTestCase(value: unknown, index: number, raw: string): TestCase {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ParseError(`testCases[${index}] must be an object.`, raw);
  }

  const t = value as Record<string, unknown>;

  const requiredStrings: Array<[string, keyof TestCase]> = [
    ['name', 'name'],
    ['filePath', 'filePath'],
    ['code', 'code'],
    ['description', 'description'],
  ];

  for (const [field] of requiredStrings) {
    if (typeof t[field] !== 'string' || (t[field] as string).length === 0) {
      throw new ParseError(`testCases[${index}].${field} must be a non-empty string.`, raw);
    }
  }

  return {
    name: t.name as string,
    filePath: t.filePath as string,
    code: t.code as string,
    description: t.description as string,
  };
}
