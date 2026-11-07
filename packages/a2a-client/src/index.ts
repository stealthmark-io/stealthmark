import { z } from 'zod';

export interface AgentCard {
  name: string;
  description: string;
  url: string;
  version: string;
  protocol_version?: string;
  authentication?: {
    schemes: string[];
    header?: string;
  };
  capabilities?: string[];
  skills?: Array<{
    id: string;
    name: string;
    description: string;
    pricing?: { unit: string; amount: number };
  }>;
}

export interface A2ATask {
  capability: string;
  input: Record<string, unknown>;
  sessionId?: string;
}

export interface A2ATaskResult {
  taskId: string;
  status: 'completed' | 'failed' | 'running';
  capability?: string;
  trace_id?: string;
  output?: Record<string, unknown>;
  cost_usd?: number;
  error?: string;
}

export interface A2AClientOptions {
  apiKey?: string;
  timeoutMs?: number;
}

const agentCardSchema = z.object({
  name: z.string(),
  description: z.string(),
  url: z.string(),
  version: z.string(),
  protocol_version: z.string().optional(),
  authentication: z.object({ schemes: z.array(z.string()), header: z.string().optional() }).optional(),
  capabilities: z.array(z.string()).optional(),
  skills: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        description: z.string(),
        pricing: z.object({ unit: z.string(), amount: z.number() }).optional(),
      })
    )
    .optional(),
});

const taskStatusSchema = z.enum(['completed', 'failed', 'running']);

const taskFieldsSchema = {
  capability: z.string().optional(),
  trace_id: z.string().optional(),
  output: z.record(z.string(), z.unknown()).optional(),
  cost_usd: z.number().optional(),
};

const rpcResponseSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  error: z.union([z.string(), z.object({ message: z.string().optional() })]).optional(),
  result: z
    .object({
      task_id: z.string().optional(),
      status: taskStatusSchema.optional(),
      ...taskFieldsSchema,
    })
    .optional(),
});

const taskResultSchema = z.object({
  taskId: z.string(),
  status: taskStatusSchema,
  error: z.string().optional(),
  ...taskFieldsSchema,
});

export class A2AClient {
  private apiKey?: string;
  private timeoutMs: number;

  constructor(options: A2AClientOptions = {}) {
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs || 10000;
  }

  /**
   * Fetches the A2A Agent Card from the standard discovery path /.well-known/agent.json
   */
  async discoverAgent(agentUrl: string): Promise<AgentCard> {
    const base = agentUrl.replace(/\/+$/, '');
    const url = `${base}/.well-known/agent.json`;

    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      throw new Error(`Failed to discover agent at ${url}: ${res.status} ${res.statusText}`);
    }

    const card = agentCardSchema.safeParse(await res.json());
    if (!card.success) {
      throw new Error(`Agent at ${url} returned an invalid Agent Card`);
    }
    return card.data;
  }

  /**
   * Submits a task to the agent's /a2a/tasks endpoint via JSON-RPC/A2A protocol
   */
  async submitTask(agentUrl: string, task: A2ATask): Promise<A2ATaskResult> {
    const base = agentUrl.replace(/\/+$/, '');
    const url = `${base}/a2a/tasks`;

    const payload = {
      jsonrpc: '2.0',
      id: `a2a_req_${Date.now()}`,
      method: 'tasks/send',
      params: {
        capability: task.capability,
        input: task.input,
        sessionId: task.sessionId,
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      throw new Error(`A2A task execution failed at ${url}: ${res.status} ${res.statusText}`);
    }

    const parsed = rpcResponseSchema.safeParse(await res.json());
    if (!parsed.success) {
      throw new Error(`A2A task response from ${url} is not a valid JSON-RPC response`);
    }

    const { id, error, result } = parsed.data;
    if (error !== undefined) {
      return {
        taskId: id === undefined ? 'unknown' : String(id),
        status: 'failed',
        error: typeof error === 'string' ? error : error.message || 'A2A task failed',
      };
    }

    const taskId = result?.task_id ?? (id === undefined ? undefined : String(id));
    if (!result || !result.status || taskId === undefined) {
      throw new Error(`A2A task response from ${url} carries neither an error nor a task id and status`);
    }

    return {
      taskId,
      status: result.status,
      capability: result.capability || task.capability,
      trace_id: result.trace_id,
      output: result.output,
      cost_usd: result.cost_usd,
    };
  }

  /**
   * Checks the status of a long-running asynchronous A2A task
   */
  async getTaskStatus(agentUrl: string, taskId: string): Promise<A2ATaskResult> {
    const base = agentUrl.replace(/\/+$/, '');
    const url = `${base}/a2a/tasks/${encodeURIComponent(taskId)}`;

    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      throw new Error(`Failed to query task ${taskId} at ${url}: ${res.status}`);
    }

    const status = taskResultSchema.safeParse(await res.json());
    if (!status.success) {
      throw new Error(`Task ${taskId} at ${url} returned an invalid status payload`);
    }
    return status.data;
  }
}
