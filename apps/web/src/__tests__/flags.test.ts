import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FlagName = 'hitl' | 'defcon' | 'sentinel' | 'dualDoorDemo' | 'mcpPanel';

const ENV_BY_FLAG: Record<FlagName, string> = {
  hitl: 'NEXT_PUBLIC_FEATURE_HITL',
  defcon: 'NEXT_PUBLIC_FEATURE_DEFCON',
  sentinel: 'NEXT_PUBLIC_FEATURE_SENTINEL',
  dualDoorDemo: 'NEXT_PUBLIC_FEATURE_DUAL_DOOR_DEMO',
  mcpPanel: 'NEXT_PUBLIC_FEATURE_MCP_PANEL',
};

const FLAG_NAMES = Object.keys(ENV_BY_FLAG) as FlagName[];

async function loadFlags() {
  vi.resetModules();
  return import('../lib/flags');
}

describe('web feature flags', () => {
  beforeEach(() => {
    for (const envName of Object.values(ENV_BY_FLAG)) {
      vi.stubEnv(envName, undefined);
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults every flag to off when no env var is set', async () => {
    const { flags } = await loadFlags();
    for (const name of FLAG_NAMES) {
      expect(flags[name]).toBe(false);
    }
  });

  for (const name of FLAG_NAMES) {
    describe(`${name} (${ENV_BY_FLAG[name]})`, () => {
      it('turns on only for the exact string "true"', async () => {
        vi.stubEnv(ENV_BY_FLAG[name], 'true');
        const { flags } = await loadFlags();
        expect(flags[name]).toBe(true);
        for (const other of FLAG_NAMES.filter((n) => n !== name)) {
          expect(flags[other]).toBe(false);
        }
      });

      it.each(['false', '1', 'TRUE', 'yes', ''])('stays off for %j', async (value) => {
        vi.stubEnv(ENV_BY_FLAG[name], value);
        const { flags } = await loadFlags();
        expect(flags[name]).toBe(false);
      });
    });
  }

  it('featureDisabledResponse returns a 404 feature_disabled JSON body', async () => {
    const { featureDisabledResponse } = await loadFlags();
    const res = featureDisabledResponse();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'feature_disabled' });
  });
});
