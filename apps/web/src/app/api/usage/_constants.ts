/**
 * Values the usage routes and the console both need. Kept free of runtime imports so client components can read them
 * without pulling the route helpers (which use Node APIs) into the browser bundle.
 */
export const BLOCKED_EVENT_TYPE = 'agent_blocked';
export const UNKNOWN_AGENT = 'unknown';
/** Most events the agents route scans per request; a scan that fills it may have left older events out. */
export const AGENT_MAX_ROWS = 5000;
