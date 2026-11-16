import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyClientCap,
  createClientEventCap,
  DEFAULT_MAX_AGENT_EVENTS_PER_CLIENT_PER_HOUR,
  MAX_CAPPED_REPORTS_PER_WINDOW,
  MAX_TRACKED_CLIENTS,
  resolveClientCapLimit,
  SHARED_BUCKET_MULTIPLIER,
} from '../client-cap.js';
import { createStealthMark } from '../create.js';

const HOUR_MS = 3_600_000;
const T0 = 1_800_000_000_000;

function decideTimes(cap: ReturnType<typeof createClientEventCap>, key: string | undefined, times: number, now = T0) {
  const decisions: string[] = [];
  for (let i = 0; i < times; i += 1) decisions.push(cap!.decide(key, now));
  return decisions;
}

describe('createClientEventCap', () => {
  it('is off when the cap is 0', () => {
    expect(createClientEventCap(0)).toBeNull();
  });

  it('bills up to the cap, then reports capped events, then drops', () => {
    const cap = createClientEventCap(2);
    const decisions = decideTimes(cap, '203.0.113.7', 2 + MAX_CAPPED_REPORTS_PER_WINDOW + 1);

    expect(decisions.slice(0, 2)).toEqual(['billable', 'billable']);
    expect(new Set(decisions.slice(2, -1))).toEqual(new Set(['capped']));
    expect(decisions.at(-1)).toBe('drop');
  });

  it('counts every client on its own', () => {
    const cap = createClientEventCap(1);
    expect(decideTimes(cap, '203.0.113.7', 2)).toEqual(['billable', 'capped']);
    expect(decideTimes(cap, '203.0.113.8', 1)).toEqual(['billable']);
  });

  it('starts a new window after one hour', () => {
    const cap = createClientEventCap(1);
    expect(decideTimes(cap, '203.0.113.7', 2)).toEqual(['billable', 'capped']);
    expect(cap!.decide('203.0.113.7', T0 + HOUR_MS - 1)).toBe('capped');
    expect(cap!.decide('203.0.113.7', T0 + HOUR_MS)).toBe('billable');
  });

  it('puts requests without a client address in one shared bucket with a larger cap', () => {
    const cap = createClientEventCap(1);
    const decisions = decideTimes(cap, undefined, SHARED_BUCKET_MULTIPLIER + 1);

    expect(decisions.slice(0, -1).every((decision) => decision === 'billable')).toBe(true);
    expect(decisions.at(-1)).toBe('capped');
  });

  it('never tracks more than MAX_TRACKED_CLIENTS: the overflow shares the shared bucket', () => {
    const cap = createClientEventCap(1);
    for (let i = 0; i < MAX_TRACKED_CLIENTS; i += 1) cap!.decide(`client-${i}`, T0);

    const overflow = decideTimes(cap, 'late-client', SHARED_BUCKET_MULTIPLIER + 1);
    expect(overflow.at(-1)).toBe('capped');
    expect(decideTimes(cap, 'another-late-client', 1)).toEqual(['capped']);
  });

  it('forgets clients whose window ended once the table is full', () => {
    const cap = createClientEventCap(1);
    for (let i = 0; i < MAX_TRACKED_CLIENTS; i += 1) cap!.decide(`client-${i}`, T0);

    const later = T0 + HOUR_MS;
    expect(cap!.decide('late-client', later)).toBe('billable');
    expect(cap!.decide('late-client', later)).toBe('capped');
  });
});

describe('resolveClientCapLimit', () => {
  it('keeps a usable number, floored, and reads 0 as off', () => {
    expect(resolveClientCapLimit(50)).toBe(50);
    expect(resolveClientCapLimit(50.9)).toBe(50);
    expect(resolveClientCapLimit(0)).toBe(0);
  });

  it('falls back to the default for a missing, negative or non-numeric value', () => {
    for (const value of [undefined, -1, Number.NaN, Number.POSITIVE_INFINITY, '600' as unknown as number]) {
      expect(resolveClientCapLimit(value)).toBe(DEFAULT_MAX_AGENT_EVENTS_PER_CLIENT_PER_HOUR);
    }
  });
});

describe('applyClientCap', () => {
  it('leaves free events alone and does not count them', () => {
    const cap = createClientEventCap(1)!;
    const blocked = { event_type: 'agent_blocked' as const };

    expect(applyClientCap(cap, blocked, '203.0.113.7')).toBe(blocked);
    expect(cap.decide('203.0.113.7', Date.now())).toBe('billable');
  });

  it('counts an event without a type as a billable agent_request', () => {
    const cap = createClientEventCap(1)!;
    expect(applyClientCap(cap, {}, '203.0.113.7')).toEqual({});
    expect(applyClientCap(cap, {}, '203.0.113.7')?.event_type).toBe('agent_capped');
  });

  it('turns an event over the cap into a zero-unit agent_capped event', () => {
    const cap = createClientEventCap(1)!;
    const event = { event_type: 'agent_manifest' as const, metadata: { path: '/.well-known/agent.json' } };
    applyClientCap(cap, event, '203.0.113.7');

    expect(applyClientCap(cap, event, '203.0.113.7')).toEqual({
      event_type: 'agent_capped',
      units: 0,
      metadata: { path: '/.well-known/agent.json' },
    });
  });

  it('returns null once the report allowance of the window is spent', () => {
    const cap = createClientEventCap(1)!;
    for (let i = 0; i < 1 + MAX_CAPPED_REPORTS_PER_WINDOW; i += 1) applyClientCap(cap, {}, '203.0.113.7');

    expect(applyClientCap(cap, {}, '203.0.113.7')).toBeNull();
  });
});

describe('createStealthMark per-client cap', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn(async () => new Response('{"accepted":1,"rejected":0}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function sentEvents(): Promise<Array<Record<string, unknown>>> {
    await vi.advanceTimersByTimeAsync(1000);
    return fetchMock.mock.calls.flatMap(
      (call) => (JSON.parse((call[1] as { body: string }).body) as { events: Array<Record<string, unknown>> }).events
    );
  }

  const base = { siteName: 'Site', apiKey: 'sk_live_test', usageEndpoint: 'https://api.test' };

  it('defaults to 600 billable events per client per hour', () => {
    expect(DEFAULT_MAX_AGENT_EVENTS_PER_CLIENT_PER_HOUR).toBe(600);
  });

  it('reports events over the cap as zero-unit agent_capped events', async () => {
    const sm = createStealthMark({ ...base, maxAgentEventsPerClientPerHour: 2 });
    for (let i = 0; i < 3; i += 1) sm.recordAgentEvent({ event_type: 'agent_request' }, '203.0.113.7');
    sm.recordAgentEvent({ event_type: 'agent_request' }, '203.0.113.8');

    const events = await sentEvents();
    expect(events.map((event) => event.event_type)).toEqual([
      'agent_request',
      'agent_request',
      'agent_capped',
      'agent_request',
    ]);
    expect(events.map((event) => event.units)).toEqual([1, 1, 0, 1]);
  });

  it('never caps when the cap is 0', async () => {
    const sm = createStealthMark({ ...base, maxAgentEventsPerClientPerHour: 0 });
    for (let i = 0; i < 5; i += 1) sm.recordAgentEvent({ event_type: 'agent_request' }, '203.0.113.7');

    expect((await sentEvents()).every((event) => event.event_type === 'agent_request')).toBe(true);
  });

  it('exposes trustForwardedFor, false unless configured', () => {
    expect(createStealthMark(base).trustForwardedFor).toBe(false);
    expect(createStealthMark({ ...base, trustForwardedFor: true }).trustForwardedFor).toBe(true);
  });
});
