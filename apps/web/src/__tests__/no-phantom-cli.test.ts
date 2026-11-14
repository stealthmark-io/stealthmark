import { describe, expect, it } from 'vitest';
import { GET as cursorRulesGet } from '../app/.cursorrules/route';
import { GET as mcpManifestGet } from '../app/mcp.json/route';

// No npm package is named `stealthmark.io`; the published CLI is @stealthmark/cli.
const PHANTOM_CLI = /npx\s+stealthmark\.io/;

describe('agent-facing documents', () => {
  it('never tell agents to run the nonexistent `npx stealthmark.io` package', async () => {
    expect(await (await cursorRulesGet()).text()).not.toMatch(PHANTOM_CLI);
    expect(await (await mcpManifestGet()).text()).not.toMatch(PHANTOM_CLI);
  });
});
