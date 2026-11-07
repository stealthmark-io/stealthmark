#!/usr/bin/env python3
"""
StealthMark Automated Defensive Security Audit & DevSecOps Runner
================================================================
Executes non-destructive defensive DAST checks, HTTP perimeter security audits,
and boundary sanity checks against local and staging endpoints.

Zero Mocks: Performs real HTTP requests with timeout isolation and strict parsing.
"""

from __future__ import annotations

import argparse
import datetime
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


class Severity(str, Enum):
    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"
    INFO = "INFO"


@dataclass
class Finding:
    module: str
    target: str
    severity: Severity
    title: str
    description: str
    recommendation: str
    evidence: Optional[str] = None


@dataclass
class AuditReport:
    timestamp: str
    duration_seconds: float
    targets: List[str]
    total_checks: int
    findings: List[Finding] = field(default_factory=list)
    overall_status: str = "PASS"
    risk_level: str = "LOW"

    def summary_counts(self) -> Dict[str, int]:
        counts = {s.value: 0 for s in Severity}
        for f in self.findings:
            counts[f.severity.value] += 1
        return counts


class DefensiveSecurityAuditor:
    def __init__(
        self,
        timeout: float = 10.0,
        policy_path: Optional[Path] = None,
        verbose: bool = False,
    ):
        self.timeout = timeout
        self.verbose = verbose
        self.policy = self._load_policy(policy_path)

    def _load_policy(self, path: Optional[Path]) -> Dict[str, Any]:
        default_policy = {
            "web": {
                "required": {
                    "strict-transport-security": {"required": True, "min_max_age": 31536000},
                    "x-content-type-options": {"required": True, "allowed_values": ["nosniff"]},
                    "x-frame-options": {"required": True, "allowed_values": ["DENY", "SAMEORIGIN"]},
                    "content-security-policy": {"required": True, "disallowed_tokens": ["'unsafe-eval'"]},
                    "permissions-policy": {"required": True, "required_directives": ["camera=()", "microphone=()"]},
                },
                "forbidden": {
                    "x-powered-by": "Leaks runtime engine information",
                    "server": "Avoid leaking specific version numbers in Server header",
                },
            },
            "api": {
                "required": {
                    "strict-transport-security": {"required": True, "min_max_age": 31536000},
                    "x-content-type-options": {"required": True, "allowed_values": ["nosniff"]},
                    "x-frame-options": {"required": True, "allowed_values": ["DENY", "SAMEORIGIN"]},
                    "content-security-policy": {"required": False, "disallowed_tokens": ["'unsafe-eval'"]},
                },
                "forbidden": {
                    "x-powered-by": "Leaks runtime engine information",
                    "server": "Avoid leaking backend tech stack versions",
                },
            },
        }

        if path and path.exists():
            try:
                with open(path, "r", encoding="utf-8") as f:
                    loaded = json.load(f)
                    if "policy" in loaded:
                        return loaded["policy"]
                    return loaded
            except Exception as e:
                if self.verbose:
                    print(f"[!] Warning: Could not parse policy file at {path}: {e}. Using defaults.")
        return default_policy

    def _http_request(
        self,
        url: str,
        method: str = "GET",
        headers: Optional[Dict[str, str]] = None,
        data: Optional[bytes] = None,
    ) -> Tuple[Optional[int], Dict[str, str], bytes, float, Optional[str]]:
        """
        Executes real HTTP request via urllib.
        Returns: (status_code, headers_dict, body_bytes, latency_ms, error_msg)
        """
        req_headers = {
            "User-Agent": "StealthMark-DefSecOps-Auditor/1.0",
            "Accept": "*/*",
        }
        if headers:
            req_headers.update(headers)

        req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
        t0 = time.perf_counter()

        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                elapsed_ms = (time.perf_counter() - t0) * 1000.0
                body = resp.read()
                resp_headers = {k.lower(): v for k, v in resp.headers.items()}
                return resp.status, resp_headers, body, elapsed_ms, None
        except urllib.error.HTTPError as e:
            elapsed_ms = (time.perf_counter() - t0) * 1000.0
            body = e.read() if e.fp else b""
            resp_headers = {k.lower(): v for k, v in e.headers.items()} if e.headers else {}
            return e.code, resp_headers, body, elapsed_ms, None
        except urllib.error.URLError as e:
            elapsed_ms = (time.perf_counter() - t0) * 1000.0
            return None, {}, b"", elapsed_ms, str(e.reason)
        except Exception as e:
            elapsed_ms = (time.perf_counter() - t0) * 1000.0
            return None, {}, b"", elapsed_ms, str(e)

    @staticmethod
    def _infer_endpoint_type(target_url: str, headers: Dict[str, str]) -> str:
        ct = headers.get("content-type", "").lower()
        parsed = urllib.parse.urlparse(target_url)
        if "application/json" in ct or "application/agent+json" in ct:
            return "api"
        if parsed.path.startswith(("/api/", "/health", "/.well-known/")) or "run.app" in parsed.netloc:
            return "api"
        return "web"

    # -------------------------------------------------------------------------
    # MODULE A: Perimeter Header Verification (Endpoint Hygiene)
    # -------------------------------------------------------------------------
    def audit_perimeter_headers(self, target_url: str, endpoint_type: Optional[str] = None) -> List[Finding]:
        findings: List[Finding] = []
        status_code, headers, body, latency, err = self._http_request(target_url, method="GET")

        if err or status_code is None:
            findings.append(
                Finding(
                    module="Module A (Perimeter Headers)",
                    target=target_url,
                    severity=Severity.HIGH,
                    title="Target Host Unreachable",
                    description=f"Could not connect to {target_url} during header audit. Reason: {err}",
                    recommendation="Ensure the service is actively listening on the target port.",
                )
            )
            return findings

        effective_type = endpoint_type or self._infer_endpoint_type(target_url, headers)
        policy = self.policy.get(effective_type, self.policy.get("web", {}))
        required = policy.get("required", {})
        forbidden = policy.get("forbidden", {})

        # 1. HSTS Check
        if required.get("strict-transport-security", {}).get("required", True) and target_url.startswith("https://"):
            hsts_rule = required["strict-transport-security"]
            hsts_val = headers.get("strict-transport-security")
            if not hsts_val:
                findings.append(
                    Finding(
                        module="Module A (Perimeter Headers)",
                        target=target_url,
                        severity=Severity.HIGH,
                        title="Missing Strict-Transport-Security (HSTS)",
                        description="HSTS header is absent. Browsers and machine agents could be downgraded to unencrypted HTTP.",
                        recommendation="Add 'Strict-Transport-Security: max-age=63072000; includeSubDomains; preload'.",
                        evidence=f"Headers received: {list(headers.keys())}",
                    )
                )
            else:
                max_age_match = re.search(r"max-age=(\d+)", hsts_val, re.IGNORECASE)
                min_expected = hsts_rule.get("min_max_age", 31536000)
                if not max_age_match or int(max_age_match.group(1)) < min_expected:
                    findings.append(
                        Finding(
                            module="Module A (Perimeter Headers)",
                            target=target_url,
                            severity=Severity.MEDIUM,
                            title="Weak HSTS Max-Age Configuration",
                            description=f"HSTS max-age is set to less than {min_expected} seconds ({hsts_val}).",
                            recommendation="Increase max-age to at least 31536000 seconds (1 year).",
                            evidence=hsts_val,
                        )
                    )

        # 2. X-Content-Type-Options Check
        if required.get("x-content-type-options", {}).get("required", True):
            xcto = headers.get("x-content-type-options", "").strip().lower()
            if xcto != "nosniff":
                findings.append(
                    Finding(
                        module="Module A (Perimeter Headers)",
                        target=target_url,
                        severity=Severity.MEDIUM,
                        title="Missing or Invalid X-Content-Type-Options",
                        description="X-Content-Type-Options is not set to 'nosniff'. Browsers may attempt MIME-sniffing attacks.",
                        recommendation="Set header 'X-Content-Type-Options: nosniff'.",
                        evidence=f"Value: '{xcto}'",
                    )
                )

        # 3. X-Frame-Options Check
        if required.get("x-frame-options", {}).get("required", True):
            xfo = headers.get("x-frame-options", "").strip().upper()
            allowed = required["x-frame-options"].get("allowed_values", ["DENY", "SAMEORIGIN"])
            if not xfo or xfo not in allowed:
                findings.append(
                    Finding(
                        module="Module A (Perimeter Headers)",
                        target=target_url,
                        severity=Severity.MEDIUM,
                        title="Missing or Weak Clickjacking Protection (X-Frame-Options)",
                        description="X-Frame-Options header is absent or uses an insecure value.",
                        recommendation="Set 'X-Frame-Options: DENY' or 'SAMEORIGIN'.",
                        evidence=f"Value: '{xfo}'",
                    )
                )

        # 4. Content-Security-Policy Check
        if "content-security-policy" in required:
            csp_rule = required["content-security-policy"]
            csp = headers.get("content-security-policy", "")
            if not csp and csp_rule.get("required", True):
                findings.append(
                    Finding(
                        module="Module A (Perimeter Headers)",
                        target=target_url,
                        severity=Severity.MEDIUM,
                        title="Missing Content-Security-Policy (CSP)",
                        description="Content-Security-Policy header is absent. XSS and content injection protections are inactive.",
                        recommendation="Implement a strict CSP restricting script-src, object-src, and frame-ancestors.",
                    )
                )
            elif csp and "'unsafe-eval'" in csp:
                findings.append(
                    Finding(
                        module="Module A (Perimeter Headers)",
                        target=target_url,
                        severity=Severity.HIGH,
                        title="Insecure Token in CSP: 'unsafe-eval'",
                        description="CSP explicitly allows 'unsafe-eval', permitting dynamic string-to-code execution.",
                        recommendation="Remove 'unsafe-eval' from script-src directives.",
                        evidence=csp[:120] + ("..." if len(csp) > 120 else ""),
                    )
                )

        # 5. Permissions-Policy Check
        if required.get("permissions-policy", {}).get("required", False):
            perm_pol = headers.get("permissions-policy", "")
            if not perm_pol:
                findings.append(
                    Finding(
                        module="Module A (Perimeter Headers)",
                        target=target_url,
                        severity=Severity.LOW,
                        title="Missing Permissions-Policy Header",
                        description="Permissions-Policy is absent; browser hardware features (camera, mic) are not explicitly isolated.",
                        recommendation="Set 'Permissions-Policy: camera=(), microphone=(), geolocation=()'.",
                    )
                )

        # 6. Informative / Leaked Headers Check
        for forbidden_header, reason in forbidden.items():
            val = headers.get(forbidden_header)
            if not val:
                continue
            # For 'server', only flag if an explicit version number is disclosed (e.g. nginx/1.18.0, Python/3.12)
            if forbidden_header == "server" and not re.search(r"\d+\.\d+", val):
                continue
            findings.append(
                Finding(
                    module="Module A (Perimeter Headers)",
                    target=target_url,
                    severity=Severity.LOW,
                    title=f"Information Disclosure Header Present: '{forbidden_header}'",
                    description=f"Server exposes '{forbidden_header}: {val}'. {reason}",
                    recommendation=f"Remove '{forbidden_header}' in proxy or application middleware.",
                    evidence=f"{forbidden_header}: {val}",
                )
            )

        return findings

    # -------------------------------------------------------------------------
    # MODULE B: Input Handling & Boundary Check (BOLA & Resiliency)
    # -------------------------------------------------------------------------
    def audit_input_boundaries(self, api_base_url: str) -> List[Finding]:
        findings: List[Finding] = []
        parsed = urllib.parse.urlparse(api_base_url)
        base = f"{parsed.scheme}://{parsed.netloc}"

        # B.1: Nested JSON Bomb (Deep Depth Overload)
        nested_obj: Dict[str, Any] = {"leaf": "deep_payload"}
        for _ in range(75):
            nested_obj = {"node": nested_obj}
        bomb_payload = json.dumps(nested_obj).encode("utf-8")

        test_endpoints = [
            f"{base}/api/v1/scanner/audit-url",
            f"{base}/api/v1/telemetry/events",
            f"{base}/api/v1/usage/events",
        ]

        for ep in test_endpoints:
            code, h, body, lat, err = self._http_request(
                ep,
                method="POST",
                headers={"Content-Type": "application/json"},
                data=bomb_payload,
            )
            if err and "refused" in err.lower():
                continue
            if code == 500:
                findings.append(
                    Finding(
                        module="Module B (Input Boundaries)",
                        target=ep,
                        severity=Severity.HIGH,
                        title="Unhandled Exception on Deeply Nested JSON Bomb",
                        description="Endpoint returned HTTP 500 when presented with deep JSON nesting. Vulnerable to stack overflow / CPU lockup.",
                        recommendation="Enforce maximum JSON recursion depth or validate payload schemas strictly in middleware.",
                        evidence=f"Status: {code}, Latency: {lat:.1f}ms",
                    )
                )

        # B.2: Unauthenticated Protected Route & Zero Stack Trace Verification
        protected_routes = [
            f"{base}/api/v1/admin/metrics",
            f"{base}/api/v1/admin/override-plan",
            f"{base}/api/v1/keys",
            f"{base}/api/v1/defcon",
        ]

        stack_trace_patterns = [
            b"Traceback (most recent call last)",
            b"ZeroDivisionError",
            b"Internal Server Error",
            b"node_modules",
            b"File \"/",
            b"prisma:",
            b"supabase_key",
        ]

        for route in protected_routes:
            code, h, body, lat, err = self._http_request(
                route,
                method="GET",
                headers={"Accept": "application/json"},
            )
            if err and "refused" in err.lower():
                continue

            body_lower = body.lower()
            leaks = [pat for pat in stack_trace_patterns if pat.lower() in body_lower]
            if leaks:
                findings.append(
                    Finding(
                        module="Module B (Boundary Check)",
                        target=route,
                        severity=Severity.CRITICAL,
                        title="Stack Trace or Internal Path Disclosure on Unauthenticated Request",
                        description="Endpoint leaked internal stack traces or paths during unauthenticated probe.",
                        recommendation="Disable debug modes in production and catch all exceptions in custom error boundaries.",
                        evidence=f"Leaked patterns: {[p.decode('utf-8', errors='ignore') for p in leaks]}",
                    )
                )

        # B.3: Oversized Payload Body Cap Check (Content-Length > 2MB)
        oversized_bytes = b"X" * (2500 * 1024)
        target_post = f"{base}/api/v1/scanner/audit-url"

        code, h, body, lat, err = self._http_request(
            target_post,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Content-Length": str(len(oversized_bytes)),
            },
            data=oversized_bytes,
        )

        if not err and code is not None:
            if code not in [413, 400, 422, 404, 405]:
                findings.append(
                    Finding(
                        module="Module B (Payload Cap)",
                        target=target_post,
                        severity=Severity.HIGH,
                        title="Missing Payload Size Cap (>2MB Accepted)",
                        description=f"Endpoint returned HTTP {code} instead of 413 Payload Too Large when sent 2.5MB of data.",
                        recommendation="Enforce a strict 2MB body limit via middleware (e.g. StealthMark Anti-Buffer-Overflow Guard).",
                        evidence=f"Status: {code}, Payload size: {len(oversized_bytes)} bytes",
                    )
                )

        return findings

    # -------------------------------------------------------------------------
    # MODULE C: Consolidated Executive Report Generator
    # -------------------------------------------------------------------------
    def generate_report(
        self,
        targets: List[str],
        findings: List[Finding],
        duration: float,
        output_dir: Path,
    ) -> AuditReport:
        output_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat()

        counts = {s.value: 0 for s in Severity}
        for f in findings:
            counts[f.severity.value] += 1

        if counts[Severity.CRITICAL.value] > 0:
            risk_level = "CRITICAL"
            overall_status = "FAIL"
        elif counts[Severity.HIGH.value] > 0:
            risk_level = "HIGH"
            overall_status = "FAIL"
        elif counts[Severity.MEDIUM.value] > 0:
            risk_level = "MEDIUM"
            overall_status = "WARNING"
        else:
            risk_level = "LOW"
            overall_status = "PASS"

        report = AuditReport(
            timestamp=timestamp,
            duration_seconds=round(duration, 2),
            targets=targets,
            total_checks=len(targets) * 5 + len(findings),
            findings=findings,
            overall_status=overall_status,
            risk_level=risk_level,
        )

        md_lines = [
            "# 🛡️ StealthMark Automated Defensive Security & DevSecOps Audit Report",
            f"**Audit Timestamp (UTC):** `{timestamp}`  ",
            f"**Execution Duration:** `{report.duration_seconds}s`  ",
            f"**Overall Perimetral Status:** **`{overall_status}`**  ",
            f"**Global Risk Rating:** **`{risk_level}`**  ",
            "",
            "## 1. Executive Summary & Findings Matrix",
            "",
            "| Severity | Total Findings | Security Impact | Gate Action |",
            "| :--- | :--- | :--- | :--- |",
            f"| 🚨 **CRITICAL** | `{counts['CRITICAL']}` | Immediate perimeter exploitation risk | Block CI/CD Pipeline |",
            f"| ⚠️ **HIGH** | `{counts['HIGH']}` | Significant vulnerability or bypass | Block CI/CD Pipeline |",
            f"| 🟡 **MEDIUM** | `{counts['MEDIUM']}` | Security configuration weakness | Warning / Remediation Recommended |",
            f"| ℹ️ **LOW / INFO** | `{counts['LOW'] + counts['INFO']}` | Best-practice hardening improvement | Advisory |",
            "",
            "## 2. Audited Target Endpoints",
            "",
        ]

        for t in targets:
            md_lines.append(f"- `{t}`")

        md_lines.append("")
        md_lines.append("## 3. Detailed Findings & Remediation Steps")
        md_lines.append("")

        if not findings:
            md_lines.append("✅ **No vulnerabilities or security weaknesses detected across all audited vectors.**")
        else:
            md_lines.append("| Module | Target | Severity | Finding | Remediation |")
            md_lines.append("| :--- | :--- | :--- | :--- | :--- |")
            for f in findings:
                badge = {
                    Severity.CRITICAL: "🔴 CRITICAL",
                    Severity.HIGH: "🟠 HIGH",
                    Severity.MEDIUM: "🟡 MEDIUM",
                    Severity.LOW: "🔵 LOW",
                    Severity.INFO: "⚪ INFO",
                }.get(f.severity, f.severity.value)
                clean_desc = f.description.replace("|", "\\|")
                clean_rec = f.recommendation.replace("|", "\\|")
                md_lines.append(f"| {f.module} | `{f.target}` | **{badge}** | {f.title}<br>*{clean_desc}* | {clean_rec} |")

        md_lines.append("")
        md_lines.append("---")
        md_lines.append("*Generated automatically by StealthMark DevSecOps Security Gate.*")

        md_path = output_dir / "audit_latest.md"
        with open(md_path, "w", encoding="utf-8") as f:
            f.write("\n".join(md_lines) + "\n")

        json_path = output_dir / "audit_latest.json"
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "timestamp": report.timestamp,
                    "duration_seconds": report.duration_seconds,
                    "overall_status": report.overall_status,
                    "risk_level": report.risk_level,
                    "targets": report.targets,
                    "summary_counts": counts,
                    "findings": [asdict(f) for f in report.findings],
                },
                f,
                indent=2,
            )

        print(f"\n[+] Security audit completed in {report.duration_seconds}s.")
        print(f"[+] Markdown report generated: {md_path}")
        print(f"[+] JSON report generated: {json_path}")
        print(f"[+] Overall Risk Rating: {risk_level} ({overall_status})\n")

        return report


def main() -> int:
    parser = argparse.ArgumentParser(description="StealthMark DevSecOps Defensive Security Auditor")
    parser.add_argument("--target", action="append", help="Target URL to audit (can specify multiple)")
    parser.add_argument("--targets-file", type=Path, help="File containing list of URLs to audit")
    parser.add_argument("--policy", type=Path, default=Path("security/rules/headers_policy.json"), help="Headers policy JSON")
    parser.add_argument("--report-dir", type=Path, default=Path("security/reports"), help="Output directory for reports")
    parser.add_argument("--timeout", type=float, default=8.0, help="HTTP request timeout in seconds")
    parser.add_argument("--skip-boundary", action="store_true", help="Skip Module B boundary tests")
    parser.add_argument("--verbose", action="store_true", help="Verbose output")
    args = parser.parse_args()

    targets: List[str] = []
    if args.target:
        targets.extend(args.target)
    if args.targets_file and args.targets_file.exists():
        with open(args.targets_file, "r") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    targets.append(line)

    if not targets:
        targets = [
            "https://stealthmark.io",
            "https://gateway.stealthmark.io/health",
            "https://api.stealthmark.io/health",
        ]

    print("=================================================================")
    print("🛡️  StealthMark Automated Defensive Security & DevSecOps Audit")
    print("=================================================================")
    print(f"[*] Target count: {len(targets)}")
    for t in targets:
        print(f"    - {t}")
    print(f"[*] Policy: {args.policy}")
    print(f"[*] Report dir: {args.report_dir}")

    t_start = time.perf_counter()
    auditor = DefensiveSecurityAuditor(timeout=args.timeout, policy_path=args.policy, verbose=args.verbose)
    all_findings: List[Finding] = []

    for target in targets:
        print(f"\n[*] Auditing Perimeter Headers: {target} ...")
        findings_a = auditor.audit_perimeter_headers(target)
        all_findings.extend(findings_a)
        print(f"    Found {len(findings_a)} perimeter items.")

        if not args.skip_boundary:
            print(f"[*] Running Boundary & Input Checks: {target} ...")
            findings_b = auditor.audit_input_boundaries(target)
            all_findings.extend(findings_b)
            print(f"    Found {len(findings_b)} boundary items.")

    duration = time.perf_counter() - t_start
    report = auditor.generate_report(targets, all_findings, duration, args.report_dir)

    counts = report.summary_counts()
    if counts[Severity.CRITICAL.value] > 0 or counts[Severity.HIGH.value] > 0:
        print(f"[!] Security Gate FAILED: Found {counts[Severity.CRITICAL.value]} CRITICAL and {counts[Severity.HIGH.value]} HIGH findings.")
        return 1

    print("[✓] Security Gate PASSED: No blocking vulnerabilities detected.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
