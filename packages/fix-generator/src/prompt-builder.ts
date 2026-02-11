/**
 * Assembles FixRequest context into structured Claude API messages.
 *
 * The prompt is structured to give Claude maximum context while staying
 * focused on producing parseable output. We use a system prompt that
 * defines the output schema and a user message that provides all evidence.
 */
import type Anthropic from '@anthropic-ai/sdk';

import type {
  FixRequest,
  ResolvedConfig,
} from './types.js';

const SYSTEM_PROMPT = `You are a senior browser automation engineer specializing in web scraper maintenance.

Your job: given a failing scraper function and diagnostic evidence, produce a precise code fix.

## Output format

You MUST respond with a single JSON object (no markdown fences, no commentary outside the JSON).
The JSON must conform to this schema exactly:

{
  "diagnosis": "<root cause explanation — 2-3 sentences>",
  "confidence": <number 0.0 to 1.0>,
  "patches": [
    {
      "filePath": "<relative path from project root>",
      "originalCode": "<exact string to find and replace>",
      "newCode": "<replacement string>",
      "description": "<what this patch does>"
    }
  ],
  "testCases": [
    {
      "name": "<descriptive test name>",
      "filePath": "<relative test file path>",
      "code": "<complete test source code>",
      "description": "<what this test validates>"
    }
  ],
  "rollbackPlan": "<step-by-step revert instructions>"
}

## Rules

1. patches[].originalCode must be an EXACT substring of the source file. If you cannot match exactly, set confidence below 0.3 and explain in diagnosis.
2. Keep patches minimal — change only what is necessary to fix the issue.
3. Generate at least one test case that would have caught this failure.
4. Test code should use the project's test framework (vitest with TypeScript).
5. confidence reflects how certain you are the fix resolves the issue:
   - 0.9-1.0: Confident — clear selector change with obvious mapping
   - 0.7-0.89: Likely — evidence points strongly but some ambiguity
   - 0.4-0.69: Uncertain — best guess based on available evidence
   - 0.0-0.39: Low — insufficient evidence, speculative fix
6. Do NOT invent new dependencies or imports that don't exist in the project.
7. Preserve existing code style and conventions.`;

/**
 * Build the messages array for a Claude API call.
 */
export function buildMessages(
  request: FixRequest,
  config: ResolvedConfig,
): {
  system: string;
  messages: Anthropic.Messages.MessageParam[];
} {
  const contentBlocks: Anthropic.Messages.ContentBlockParam[] = [];

  // Lead with a structured summary of the failure
  contentBlocks.push({
    type: 'text',
    text: buildFailureSummary(request),
  });

  // Screenshot (vision) if available and enabled
  if (config.includeScreenshot && request.context.screenshot) {
    contentBlocks.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: request.context.screenshot.toString('base64'),
      },
    });
    contentBlocks.push({
      type: 'text',
      text: 'Above: screenshot of the page at time of failure.',
    });
  }

  // DOM context
  if (request.context.dom) {
    const domSnippet = truncate(request.context.dom, 30_000);
    contentBlocks.push({
      type: 'text',
      text: `## Current DOM snapshot (may be truncated)\n\n\`\`\`html\n${domSnippet}\n\`\`\``,
    });
  }

  // DOM diff
  if (request.context.recentChanges) {
    contentBlocks.push({
      type: 'text',
      text: buildDOMDiffSection(request),
    });
  }

  // Network logs
  if (request.context.networkLogs.length > 0) {
    contentBlocks.push({
      type: 'text',
      text: buildNetworkLogsSection(request),
    });
  }

  // Console errors
  if (request.context.consoleErrors && request.context.consoleErrors.length > 0) {
    contentBlocks.push({
      type: 'text',
      text: `## Console errors\n\n${request.context.consoleErrors.join('\n')}`,
    });
  }

  // Source code
  contentBlocks.push({
    type: 'text',
    text: buildSourceCodeSection(request),
  });

  // Final instruction
  contentBlocks.push({
    type: 'text',
    text: 'Analyze all evidence above and produce the JSON fix response. Remember: output ONLY the JSON object, nothing else.',
  });

  return {
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: contentBlocks }],
  };
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildFailureSummary(request: FixRequest): string {
  const lines = [
    '## Failure summary',
    '',
    `**Platform:** ${request.platform}`,
    `**Error category:** ${request.error.category}`,
    `**Error message:** ${request.error.message}`,
    `**Affected function:** ${request.affectedFunction}`,
  ];

  if (request.sourceFilePath) {
    lines.push(`**Source file:** ${request.sourceFilePath}`);
  }

  if (request.error.stack) {
    lines.push('', '**Stack trace:**', '```', request.error.stack, '```');
  }

  return lines.join('\n');
}

function buildDOMDiffSection(request: FixRequest): string {
  const diff = request.context.recentChanges!;
  const lines = ['## DOM changes since last working state', ''];

  if (diff.removedSelectors.length > 0) {
    lines.push('**Removed selectors:**');
    for (const sel of diff.removedSelectors) {
      lines.push(`- \`${sel}\``);
    }
    lines.push('');
  }

  if (diff.addedSelectors.length > 0) {
    lines.push('**Added selectors:**');
    for (const sel of diff.addedSelectors) {
      lines.push(`- \`${sel}\``);
    }
    lines.push('');
  }

  if (diff.changedSelectors.length > 0) {
    lines.push('**Changed selectors:**');
    for (const change of diff.changedSelectors) {
      lines.push(`- \`${change.selector}\``);
      lines.push(`  - Before: \`${truncate(change.before, 200)}\``);
      lines.push(`  - After: \`${truncate(change.after, 200)}\``);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function buildNetworkLogsSection(request: FixRequest): string {
  // Only include failed or interesting requests to save tokens
  const relevant = request.context.networkLogs.filter(
    (log) => log.status >= 400 || log.status === 0,
  );
  const logs = relevant.length > 0 ? relevant : request.context.networkLogs.slice(0, 10);

  const lines = ['## Network logs (failures and recent)', ''];
  for (const log of logs) {
    lines.push(`- ${log.method} ${log.url} → ${log.status}`);
    if (log.timing) {
      lines.push(`  Duration: ${log.timing.durationMs}ms`);
    }
  }

  return lines.join('\n');
}

function buildSourceCodeSection(request: FixRequest): string {
  const lines = ['## Source code', ''];

  if (request.sourceFile) {
    lines.push(
      `### Full source file${request.sourceFilePath ? ` (${request.sourceFilePath})` : ''}`,
      '',
      '```typescript',
      truncate(request.sourceFile, 50_000),
      '```',
    );
  }

  lines.push(
    '',
    '### Last working version of the affected code',
    '',
    '```typescript',
    truncate(request.context.lastWorkingCode, 20_000),
    '```',
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const truncated = text.slice(0, maxLength);
  return truncated + `\n\n... [truncated, ${text.length - maxLength} characters omitted]`;
}
