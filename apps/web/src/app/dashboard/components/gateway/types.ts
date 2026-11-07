export interface AgentTrafficEvent {
  id: string;
  time: string;
  /** ISO timestamp of the event; absent on events that only carry the clock time. */
  timestamp?: string;
  agent: string;
  provider: string;
  targetPath: string;
  method: string;
  /** Upstream HTTP status of the request; null when the event recorded none. */
  status: number | null;
  /** Policy outcome; absent on events that only carry a status, which then decides it. */
  decision?: "blocked" | "allowed";
  identity?: "ua_declared";
  securityCheck: string;
}

export interface DefconLevel {
  level: number;
  name: string;
  color: string;
  bg: string;
  desc: string;
}

export interface ActiveShield {
  id: string;
  name: string;
  status: string;
  desc: string;
}

export interface TelemetryEventsResponse {
  events?: AgentTrafficEvent[];
}
