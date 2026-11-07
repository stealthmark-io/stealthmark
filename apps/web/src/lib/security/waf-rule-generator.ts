export interface SecurityTelemetryEvent {
  id: string;
  created_at: string;
  workspace_id: string;
  client_ip: string;
  ja4_fingerprint: string | null;
  canonical_path: string;
  raw_host: string;
  threat_score: number;
  classification: 'LEGIT_AGENT_OR_USER' | 'SUSPICIOUS_SCRAPER' | 'MALICIOUS_AGENT_BOTNET';
  matched_flags: string[];
  risk_weight_applied: number;
  was_blocked: boolean;
}

export interface WafExportBundle {
  actorCount: number;
  ja4List: string[];
  ipList: string[];
  cloudArmorCel: string;
  gcloudCommand: string;
  cloudArmorTerraform: string;
  cloudflareExpression: string;
  cloudflareApiPayload: string;
}

const VALID_JA4_REGEX = /^[a-z0-9]{10}_[a-f0-9]{12}_[a-f0-9]{12}$/i;
const VALID_IPV4_REGEX = /^(?:\d{1,3}\.){3}\d{1,3}$/;

export function buildWafRulesFromEvents(
  events: SecurityTelemetryEvent[],
  minThreatScore = 80,
  policyName = 'stealthmark-edge-armor-policy'
): WafExportBundle {
  const highRiskEvents = events.filter((e) => e.threat_score >= minThreatScore);

  const ja4Set = new Set<string>();
  const ipSet = new Set<string>();

  for (const ev of highRiskEvents) {
    if (ev.ja4_fingerprint && VALID_JA4_REGEX.test(ev.ja4_fingerprint.trim())) {
      ja4Set.add(ev.ja4_fingerprint.trim());
    }
    if (ev.client_ip && VALID_IPV4_REGEX.test(ev.client_ip.trim())) {
      ipSet.add(ev.client_ip.trim());
    }
  }

  const ja4List = Array.from(ja4Set).slice(0, 50);
  const ipList = Array.from(ipSet).slice(0, 50);

  const celParts: string[] = [];
  if (ja4List.length > 0) {
    const formattedJa4s = ja4List.map((j) => `'${j}'`).join(', ');
    celParts.push(`origin.ja4_fingerprint in [${formattedJa4s}]`);
  }
  if (ipList.length > 0) {
    const formattedIps = ipList.map((ip) => `'${ip}/32'`).join(', ');
    celParts.push(`inIpRange(origin.ip, [${formattedIps}])`);
  }
  celParts.push(
    `request.path.matches('(?i)^/(_next/mcp|api/v1/chat/react-agent|api/v1/validate/code|shell_run|\\.env|\\.git)')`
  );

  const cloudArmorCel = celParts.join(' ||\n  ');

  const gcloudCommand = `gcloud compute security-policies rules create 1000 \\\n  --security-policy="${policyName}" \\\n  --expression="${celParts.join(' || ')}" \\\n  --action="deny-403" \\\n  --description="StealthMark Auto-Block: Offensive AI Agents & CVE Probes (ThreatScore >= ${minThreatScore})"`;

  const cloudArmorTerraform = `resource "google_compute_security_policy_rule" "stealthmark_perimeter_block" {
  security_policy = "${policyName}"
  priority        = 1000
  action          = "deny(403)"
  description     = "StealthMark Auto-Block: JA4 & IP Botnet Shield (Score >= ${minThreatScore})"

  match {
    expr {
      expression = <<-EOT
        ${cloudArmorCel}
      EOT
    }
  }
}`;

  const cfParts: string[] = [];
  if (ja4List.length > 0) {
    cfParts.push(`(cf.bot_management.ja4 in {${ja4List.map((j) => `"${j}"`).join(' ')}})`);
  }
  if (ipList.length > 0) {
    cfParts.push(`(ip.src in {${ipList.join(' ')}})`);
  }
  cfParts.push(
    `(http.request.uri.path contains "/_next/mcp" or http.request.uri.path contains "/api/v1/chat/react-agent" or http.request.uri.path contains "/.env")`
  );

  const cloudflareExpression = cfParts.join(' or\n');

  const cloudflareApiPayload = JSON.stringify(
    {
      description: `StealthMark Perimeter Shield Block (Score >= ${minThreatScore})`,
      expression: cfParts.join(' or '),
      action: 'block',
      enabled: true,
    },
    null,
    2
  );

  return {
    actorCount: ja4List.length + ipList.length,
    ja4List,
    ipList,
    cloudArmorCel,
    gcloudCommand,
    cloudArmorTerraform,
    cloudflareExpression,
    cloudflareApiPayload,
  };
}
