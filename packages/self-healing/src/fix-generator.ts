import Anthropic from "@anthropic-ai/sdk";

import {
  FixRequest,
  FixResponse,
  CodePatch,
  TestCase,
  DiagnosisResult,
} from "./types.js";

// ─── Prompt Construction ────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert scraper-maintenance engineer. Your job is to diagnose web scraper breakages and produce minimal, correct patches.

You will receive:
1. The error that occurred
2. A diagnosis summary (error category, broken selectors, severity)
3. A DOM snapshot of the current page
4. Network request logs
5. The last working version of the broken function
6. A structured diff of DOM changes since the last working state

Your response MUST be valid JSON matching this schema exactly:

{
  "diagnosis": "<one-paragraph root-cause explanation>",
  "confidence": <0.0-1.0>,
  "suggestedFix": [
    {
      "filePath": "<repo-relative path>",
      "startLine": <number>,
      "endLine": <number>,
      "originalCode": "<exact code being replaced>",
      "replacementCode": "<new code>"
    }
  ],
  "testCases": [
    {
      "name": "<test name>",
      "description": "<what this test verifies>",
      "code": "<complete vitest test source>",
      "filePath": "<where to write the test>"
    }
  ],
  "rollbackPlan": "<steps to revert if the fix causes regressions>"
}

Rules:
- Patches must be minimal — change only what is broken.
- Prefer updating selectors to match the new DOM over structural rewrites.
- Every patch must have at least one corresponding test case.
- Test cases must be self-contained and runnable with vitest.
- Set confidence < 0.5 if the diagnosis is uncertain.
- Set confidence < 0.3 if you cannot determine the root cause.
- The rollbackPlan must be specific: list exact git commands or code reversions.
- Do NOT wrap the JSON in markdown code fences.`;

function buildUserPrompt(
  request: FixRequest,
  diagnosis: DiagnosisResult,
): string {
  const networkSummary = request.context.networkLogs
    .map(
      (log) =>
        `${log.method} ${log.url} → ${log.status}${log.responseBody ? ` (body: ${log.responseBody.slice(0, 200)}...)` : ""}`,
    )
    .join("\n");

  const domChangeSummary = request.context.recentChanges.changes
    .map(
      (c) =>
        `[${c.type}] ${c.selector}${c.oldValue ? ` old="${c.oldValue}"` : ""}${c.newValue ? ` new="${c.newValue}"` : ""}`,
    )
    .join("\n");

  // Truncate DOM to avoid blowing context — 30k chars keeps us well within limits
  const domTruncated =
    request.context.dom.length > 30_000
      ? request.context.dom.slice(0, 30_000) + "\n... [truncated]"
      : request.context.dom;

  return `## Error
Name: ${request.error.name}
Message: ${request.error.message}
Stack: ${request.error.stack ?? "(no stack)"}

## Diagnosis
Category: ${diagnosis.category}
Severity: ${diagnosis.severity}
Summary: ${diagnosis.summary}
Broken selectors: ${diagnosis.brokenSelectors.join(", ") || "(none extracted)"}
Likely detection: ${diagnosis.likelyDetection}

## Platform
${request.platform}

## Affected Function
${request.affectedFunction}

## Last Working Code
\`\`\`typescript
${request.context.lastWorkingCode}
\`\`\`

## Current DOM (may be truncated)
\`\`\`html
${domTruncated}
\`\`\`

## Network Logs
${networkSummary || "(none)"}

## DOM Changes Since Last Working State
Total changed: ${request.context.recentChanges.totalChanged} (${(request.context.recentChanges.changeRatio * 100).toFixed(1)}%)
${domChangeSummary || "(no changes detected)"}

Produce the fix JSON now.`;
}

// ─── Response Parsing ───────────────────────────────────────────────────────

/** Validate and parse the raw JSON from Claude into a typed FixResponse. */
function parseFixResponse(raw: string): FixResponse {
  // Strip markdown fences if the model added them despite instructions
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(
      `Fix generator returned invalid JSON: ${e instanceof Error ? e.message : String(e)}\nRaw response (first 500 chars): ${raw.slice(0, 500)}`,
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Fix generator returned a non-object JSON value.");
  }

  const obj = parsed as Record<string, unknown>;

  // ── diagnosis ──
  if (typeof obj.diagnosis !== "string" || obj.diagnosis.length === 0) {
    throw new Error("Fix response missing or empty 'diagnosis' field.");
  }

  // ── confidence ──
  if (typeof obj.confidence !== "number" || obj.confidence < 0 || obj.confidence > 1) {
    throw new Error(
      `Fix response 'confidence' must be a number in [0, 1], got: ${obj.confidence}`,
    );
  }

  // ── suggestedFix ──
  if (!Array.isArray(obj.suggestedFix)) {
    throw new Error("Fix response 'suggestedFix' must be an array.");
  }
  const suggestedFix: CodePatch[] = obj.suggestedFix.map(
    (patch: unknown, i: number) => {
      if (typeof patch !== "object" || patch === null) {
        throw new Error(`suggestedFix[${i}] is not an object.`);
      }
      const p = patch as Record<string, unknown>;
      if (typeof p.filePath !== "string") {
        throw new Error(`suggestedFix[${i}].filePath must be a string.`);
      }
      if (typeof p.startLine !== "number" || typeof p.endLine !== "number") {
        throw new Error(
          `suggestedFix[${i}].startLine and endLine must be numbers.`,
        );
      }
      if (
        typeof p.originalCode !== "string" ||
        typeof p.replacementCode !== "string"
      ) {
        throw new Error(
          `suggestedFix[${i}].originalCode and replacementCode must be strings.`,
        );
      }
      return {
        filePath: p.filePath,
        startLine: p.startLine,
        endLine: p.endLine,
        originalCode: p.originalCode,
        replacementCode: p.replacementCode,
      };
    },
  );

  // ── testCases ──
  if (!Array.isArray(obj.testCases)) {
    throw new Error("Fix response 'testCases' must be an array.");
  }
  const testCases: TestCase[] = obj.testCases.map(
    (tc: unknown, i: number) => {
      if (typeof tc !== "object" || tc === null) {
        throw new Error(`testCases[${i}] is not an object.`);
      }
      const t = tc as Record<string, unknown>;
      if (typeof t.name !== "string") {
        throw new Error(`testCases[${i}].name must be a string.`);
      }
      if (typeof t.description !== "string") {
        throw new Error(`testCases[${i}].description must be a string.`);
      }
      if (typeof t.code !== "string") {
        throw new Error(`testCases[${i}].code must be a string.`);
      }
      if (typeof t.filePath !== "string") {
        throw new Error(`testCases[${i}].filePath must be a string.`);
      }
      return {
        name: t.name,
        description: t.description,
        code: t.code,
        filePath: t.filePath,
      };
    },
  );

  // ── rollbackPlan ──
  if (typeof obj.rollbackPlan !== "string" || obj.rollbackPlan.length === 0) {
    throw new Error("Fix response missing or empty 'rollbackPlan' field.");
  }

  return {
    diagnosis: obj.diagnosis,
    confidence: obj.confidence,
    suggestedFix,
    testCases,
    rollbackPlan: obj.rollbackPlan,
  };
}

// ─── Fix Generator ──────────────────────────────────────────────────────────

export interface FixGeneratorConfig {
  /** Anthropic API key. */
  readonly apiKey: string;
  /** Model ID. Defaults to claude-sonnet-4-5-20250929. */
  readonly model?: string;
  /** Max output tokens. Defaults to 4096. */
  readonly maxTokens?: number;
}

/**
 * Calls Claude to generate a code patch and test cases for a scraper breakage.
 *
 * This is the expensive step — it makes an LLM API call. The diagnosis is
 * passed in so the LLM has structured context alongside the raw error.
 */
export class FixGenerator {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(config: FixGeneratorConfig) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.model = config.model ?? "claude-sonnet-4-5-20250929";
    this.maxTokens = config.maxTokens ?? 4096;
  }

  async generate(
    request: FixRequest,
    diagnosis: DiagnosisResult,
  ): Promise<FixResponse> {
    const userPrompt = buildUserPrompt(request, diagnosis);

    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            // Include the screenshot as a vision input so Claude can see the page
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: request.context.screenshot.toString("base64"),
              },
            },
            {
              type: "text",
              text: userPrompt,
            },
          ],
        },
      ],
    });

    // Extract text content from the response
    const textBlock = message.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error(
        "Claude response contained no text block. " +
          `Stop reason: ${message.stop_reason}`,
      );
    }

    return parseFixResponse(textBlock.text);
  }
}

// Re-export for testing convenience
export { buildUserPrompt as _buildUserPrompt, parseFixResponse as _parseFixResponse };
