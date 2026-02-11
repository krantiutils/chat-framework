import { describe, it, expect } from 'vitest';

import { buildMessages } from '../prompt-builder.js';
import type { FixRequest, ResolvedConfig } from '../types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    apiKey: 'test-key',
    model: 'claude-sonnet-4-5-20250929',
    maxTokens: 8192,
    autoDeployThreshold: 0.8,
    maxRetries: 2,
    includeScreenshot: true,
    ...overrides,
  };
}

function makeRequest(overrides: Partial<FixRequest> = {}): FixRequest {
  return {
    error: {
      message: 'Element not found: .compose-button',
      stack: 'Error: Element not found\n    at findElement (selectors.ts:42)',
      category: 'selector_not_found',
    },
    context: {
      screenshot: Buffer.from('fake-png-data'),
      dom: '<html><body><div class="new-compose-btn">Send</div></body></html>',
      networkLogs: [
        {
          url: 'https://www.instagram.com/direct/inbox/',
          method: 'GET',
          status: 200,
        },
      ],
      lastWorkingCode:
        "async function clickCompose(page) {\n  await page.click('.compose-button');\n}",
      recentChanges: {
        removedSelectors: ['.compose-button'],
        addedSelectors: ['.new-compose-btn'],
        changedSelectors: [],
      },
      consoleErrors: ['TypeError: Cannot read property "click" of null'],
    },
    platform: 'instagram',
    affectedFunction: 'clickCompose',
    sourceFile:
      "import { Page } from 'puppeteer';\n\nasync function clickCompose(page: Page) {\n  await page.click('.compose-button');\n}",
    sourceFilePath: 'packages/adapters/src/instagram/actions.ts',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildMessages', () => {
  it('returns system prompt and user messages', () => {
    const result = buildMessages(makeRequest(), makeConfig());

    expect(result.system).toContain('senior browser automation engineer');
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe('user');
  });

  it('includes failure summary in first content block', () => {
    const result = buildMessages(makeRequest(), makeConfig());
    const content = result.messages[0].content as Array<{ type: string; text?: string }>;
    const firstText = content.find((b) => b.type === 'text' && b.text?.includes('Failure summary'));

    expect(firstText).toBeDefined();
    expect(firstText!.text).toContain('instagram');
    expect(firstText!.text).toContain('selector_not_found');
    expect(firstText!.text).toContain('clickCompose');
  });

  it('includes screenshot as base64 image when enabled', () => {
    const result = buildMessages(makeRequest(), makeConfig({ includeScreenshot: true }));
    const content = result.messages[0].content as Array<{ type: string; source?: { type: string } }>;
    const imageBlock = content.find((b) => b.type === 'image');

    expect(imageBlock).toBeDefined();
    expect(imageBlock!.source!.type).toBe('base64');
  });

  it('omits screenshot when disabled', () => {
    const result = buildMessages(makeRequest(), makeConfig({ includeScreenshot: false }));
    const content = result.messages[0].content as Array<{ type: string }>;
    const imageBlock = content.find((b) => b.type === 'image');

    expect(imageBlock).toBeUndefined();
  });

  it('omits screenshot when not provided in request', () => {
    const request = makeRequest();
    request.context.screenshot = undefined;
    const result = buildMessages(request, makeConfig());
    const content = result.messages[0].content as Array<{ type: string }>;
    const imageBlock = content.find((b) => b.type === 'image');

    expect(imageBlock).toBeUndefined();
  });

  it('includes DOM snapshot', () => {
    const result = buildMessages(makeRequest(), makeConfig());
    const content = result.messages[0].content as Array<{ type: string; text?: string }>;
    const domBlock = content.find((b) => b.type === 'text' && b.text?.includes('DOM snapshot'));

    expect(domBlock).toBeDefined();
    expect(domBlock!.text).toContain('new-compose-btn');
  });

  it('omits DOM section when dom is undefined', () => {
    const request = makeRequest();
    request.context.dom = undefined;
    const result = buildMessages(request, makeConfig());
    const content = result.messages[0].content as Array<{ type: string; text?: string }>;
    const domBlock = content.find((b) => b.type === 'text' && b.text?.includes('DOM snapshot'));

    expect(domBlock).toBeUndefined();
  });

  it('includes DOM diff section', () => {
    const result = buildMessages(makeRequest(), makeConfig());
    const content = result.messages[0].content as Array<{ type: string; text?: string }>;
    const diffBlock = content.find(
      (b) => b.type === 'text' && b.text?.includes('DOM changes'),
    );

    expect(diffBlock).toBeDefined();
    expect(diffBlock!.text).toContain('.compose-button');
    expect(diffBlock!.text).toContain('.new-compose-btn');
    expect(diffBlock!.text).toContain('Removed selectors');
    expect(diffBlock!.text).toContain('Added selectors');
  });

  it('includes network logs section', () => {
    const result = buildMessages(makeRequest(), makeConfig());
    const content = result.messages[0].content as Array<{ type: string; text?: string }>;
    const netBlock = content.find(
      (b) => b.type === 'text' && b.text?.includes('Network logs'),
    );

    expect(netBlock).toBeDefined();
    expect(netBlock!.text).toContain('instagram.com');
  });

  it('prioritizes failed network requests', () => {
    const request = makeRequest();
    request.context.networkLogs = [
      { url: 'https://ok.com', method: 'GET', status: 200 },
      { url: 'https://fail.com', method: 'POST', status: 500 },
    ];
    const result = buildMessages(request, makeConfig());
    const content = result.messages[0].content as Array<{ type: string; text?: string }>;
    const netBlock = content.find(
      (b) => b.type === 'text' && b.text?.includes('Network logs'),
    );

    expect(netBlock!.text).toContain('fail.com');
  });

  it('omits network section when empty', () => {
    const request = makeRequest();
    request.context.networkLogs = [];
    const result = buildMessages(request, makeConfig());
    const content = result.messages[0].content as Array<{ type: string; text?: string }>;
    const netBlock = content.find(
      (b) => b.type === 'text' && b.text?.includes('Network logs'),
    );

    expect(netBlock).toBeUndefined();
  });

  it('includes console errors', () => {
    const result = buildMessages(makeRequest(), makeConfig());
    const content = result.messages[0].content as Array<{ type: string; text?: string }>;
    const errBlock = content.find(
      (b) => b.type === 'text' && b.text?.includes('Console errors'),
    );

    expect(errBlock).toBeDefined();
    expect(errBlock!.text).toContain('Cannot read property');
  });

  it('includes source code sections', () => {
    const result = buildMessages(makeRequest(), makeConfig());
    const content = result.messages[0].content as Array<{ type: string; text?: string }>;
    const sourceBlock = content.find(
      (b) => b.type === 'text' && b.text?.includes('Source code'),
    );

    expect(sourceBlock).toBeDefined();
    expect(sourceBlock!.text).toContain('clickCompose');
    expect(sourceBlock!.text).toContain('Full source file');
    expect(sourceBlock!.text).toContain('Last working version');
  });

  it('includes the stack trace in failure summary', () => {
    const result = buildMessages(makeRequest(), makeConfig());
    const content = result.messages[0].content as Array<{ type: string; text?: string }>;
    const summary = content.find(
      (b) => b.type === 'text' && b.text?.includes('Failure summary'),
    );

    expect(summary!.text).toContain('selectors.ts:42');
  });

  it('handles request without optional fields gracefully', () => {
    const minimal: FixRequest = {
      error: {
        message: 'Timeout',
        category: 'timeout',
      },
      context: {
        networkLogs: [],
        lastWorkingCode: 'function doThing() { /* ... */ }',
      },
      platform: 'facebook',
      affectedFunction: 'doThing',
    };

    const result = buildMessages(minimal, makeConfig());
    expect(result.messages).toHaveLength(1);

    // Should have at least: summary, source code, final instruction
    const content = result.messages[0].content as Array<{ type: string; text?: string }>;
    const textBlocks = content.filter((b) => b.type === 'text');
    expect(textBlocks.length).toBeGreaterThanOrEqual(3);
  });

  it('system prompt instructs JSON-only output', () => {
    const result = buildMessages(makeRequest(), makeConfig());
    expect(result.system).toContain('single JSON object');
    expect(result.system).toContain('no markdown fences');
  });

  it('final instruction asks for JSON output', () => {
    const result = buildMessages(makeRequest(), makeConfig());
    const content = result.messages[0].content as Array<{ type: string; text?: string }>;
    const lastText = content[content.length - 1];

    expect(lastText.type).toBe('text');
    expect(lastText.text).toContain('JSON');
  });
});
