import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { A2AClient } from '../index.js';

describe('A2AClient', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('discoverAgent fetches and parses Agent Card from /.well-known/agent.json', async () => {
    const mockAgentCard = {
      name: 'StealthMark Agent',
      description: 'Web Intelligence Provider',
      url: 'https://a2a.stealthmark.io',
      version: '1.0.0',
      capabilities: ['web-vision'],
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockAgentCard,
    });

    const client = new A2AClient({ apiKey: 'test-key' });
    const card = await client.discoverAgent('https://a2a.stealthmark.io');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://a2a.stealthmark.io/.well-known/agent.json',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
        }),
      })
    );
    expect(card.name).toBe('StealthMark Agent');
    expect(card.capabilities).toContain('web-vision');
  });

  it('submitTask sends valid JSON-RPC payload and parses result', async () => {
    const mockResponse = {
      jsonrpc: '2.0',
      id: 'req_123',
      result: {
        task_id: 'task_abc',
        status: 'completed',
        capability: 'web-vision',
        output: { title: 'Test Result' },
        cost_usd: 0.05,
      },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    const client = new A2AClient();
    const result = await client.submitTask('https://a2a.stealthmark.io', {
      capability: 'web-vision',
      input: { url: 'https://example.com' },
    });

    expect(result.status).toBe('completed');
    expect(result.taskId).toBe('task_abc');
    expect(result.cost_usd).toBe(0.05);
  });

  function respondWith(body: unknown) {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => body,
    });
  }

  const task = { capability: 'web-vision', input: { url: 'https://example.com' } };

  it('discoverAgent rejects a body that is not an Agent Card', async () => {
    respondWith({ name: 'No url or version' });

    await expect(new A2AClient().discoverAgent('https://a2a.stealthmark.io')).rejects.toThrow(
      'returned an invalid Agent Card'
    );
  });

  it('submitTask maps a JSON-RPC error to a failed result with its message', async () => {
    respondWith({ jsonrpc: '2.0', id: 'req_9', error: { code: -32000, message: 'capability unavailable' } });

    const result = await new A2AClient().submitTask('https://a2a.stealthmark.io', task);

    expect(result).toEqual({ taskId: 'req_9', status: 'failed', error: 'capability unavailable' });
  });

  it('submitTask accepts a string error and a numeric request id', async () => {
    respondWith({ jsonrpc: '2.0', id: 7, error: 'rate limited' });

    const result = await new A2AClient().submitTask('https://a2a.stealthmark.io', task);

    expect(result).toEqual({ taskId: '7', status: 'failed', error: 'rate limited' });
  });

  it('submitTask never reports completion when the response has no result', async () => {
    respondWith({ jsonrpc: '2.0', id: 'req_1' });

    await expect(new A2AClient().submitTask('https://a2a.stealthmark.io', task)).rejects.toThrow(
      'carries neither an error nor a task id and status'
    );
  });

  it('submitTask never defaults a missing status to completed', async () => {
    respondWith({ jsonrpc: '2.0', id: 'req_2', result: { task_id: 'task_1', output: { ok: true } } });

    await expect(new A2AClient().submitTask('https://a2a.stealthmark.io', task)).rejects.toThrow(
      'carries neither an error nor a task id and status'
    );
  });

  it('submitTask rejects an unknown status value', async () => {
    respondWith({ jsonrpc: '2.0', id: 'req_3', result: { task_id: 'task_1', status: 'done' } });

    await expect(new A2AClient().submitTask('https://a2a.stealthmark.io', task)).rejects.toThrow(
      'not a valid JSON-RPC response'
    );
  });

  it('submitTask falls back to the request id and the submitted capability', async () => {
    respondWith({ jsonrpc: '2.0', id: 'req_4', result: { status: 'running' } });

    const result = await new A2AClient().submitTask('https://a2a.stealthmark.io', task);

    expect(result).toMatchObject({ taskId: 'req_4', status: 'running', capability: 'web-vision' });
  });

  it('getTaskStatus encodes the task id in the path and returns the validated result', async () => {
    respondWith({ taskId: 'a/b', status: 'running' });

    const result = await new A2AClient().getTaskStatus('https://a2a.stealthmark.io/', 'a/b');

    expect(global.fetch).toHaveBeenCalledWith('https://a2a.stealthmark.io/a2a/tasks/a%2Fb', expect.anything());
    expect(result).toEqual({ taskId: 'a/b', status: 'running' });
  });

  it('getTaskStatus rejects a payload without a valid status', async () => {
    respondWith({ taskId: 'task_1', status: 'weird' });

    await expect(new A2AClient().getTaskStatus('https://a2a.stealthmark.io', 'task_1')).rejects.toThrow(
      'returned an invalid status payload'
    );
  });
});
