export interface TraceStep {
  step: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

export interface ExecutionTrace {
  trace_id: string;
  taskId: string;
  steps: TraceStep[];
}

// In-memory trace store for quick retrieval and debugging
const traceStore = new Map<string, TraceStep[]>();

export function createTraceId(): string {
  return `tr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export function recordTraceStep(traceId: string, step: string, data?: Record<string, unknown>): void {
  const steps = traceStore.get(traceId) || [];
  steps.push({
    step,
    timestamp: new Date().toISOString(),
    data,
  });
  traceStore.set(traceId, steps);
}

export function getExecutionTrace(traceId: string, taskId: string): ExecutionTrace {
  const steps = traceStore.get(traceId) || [
    {
      step: 'task.created',
      timestamp: new Date().toISOString(),
      data: { taskId, note: 'Synthesized initial trace' },
    },
  ];

  return {
    trace_id: traceId,
    taskId,
    steps,
  };
}
