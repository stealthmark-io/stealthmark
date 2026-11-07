import { FIX_PACK } from '@/lib/offer';

export const CLOUDFLARE_WAF_RULE = `(http.request.uri.path contains "/.env") or (http.request.uri.path contains "/.git") or (http.request.uri.path contains "/_next/mcp") or (http.request.uri.path contains "/actuator/env") or (http.request.uri.path contains "eval-stdin.php") or (http.request.uri.path contains "/+CSCOE+/") or (http.request.uri.path contains "/dana-na/") or (http.request.uri.path contains "/amc/") or (http.request.uri.path contains "/__api__/") or (http.request.uri.query contains "169.254.169.254") or (http.request.uri.query contains "metadata.google.internal") or (http.request.uri.query contains "fd00:ec2::254") or (http.request.uri.query contains "allow_url_include") or (http.request.uri.query contains "auto_prepend_file") or (http.user_agent contains "zgrab") or (http.user_agent contains "nuclei") or (http.user_agent contains "masscan") or (http.user_agent contains "evilginx") or (http.user_agent contains "modlishka") or (http.request.uri.path contains "/xmlrpc.php" and not http.request.uri.path contains "/wc-api/" and not http.request.uri.path contains "/wp-json/stripe/" and not http.request.uri.path contains "/webhook")`;

/** A fresh random secret per download: a fallback anyone can recompute from the domain makes the worker's signatures forgeable. */
function randomFallbackSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// `domain` must already be the output of sanitizeAndValidateDomain; JSON.stringify keeps it inert inside the script.
export function buildEdgeWorker(domain: string): string {
  const fallbackSecret = randomFallbackSecret();

  return `/**
 * StealthMark Active Edge Shield v2.0 — Cloudflare Worker (JA4 Session Binding + Anti-AiTM + DEFCON 5->1)
 * Commercial License — StealthMark ${FIX_PACK.label} (${FIX_PACK.starterPriceLabel} USD one-time per domain)
 * Target Domain: ${domain}
 * Issuer: StealthMark Security Team <security@stealthmark.io>
 *
 * Recommended Environment Variables in Cloudflare Worker Settings / wrangler.toml:
 * - STEALTHMARK_SECRET: 32-byte HMAC secret (a random default unique to this download is included below; set your own in production)
 * - DEFAULT_DEFCON: "5" (normal peacetime monitoring) down to "1" (emergency mutation freeze)
 * - STEALTHMARK_KV (Optional): KV Namespace for dynamic DEFCON escalation & honeypot IP bans
 */
const TARGET_DOMAIN = ${JSON.stringify(domain)};
const FALLBACK_DOMAIN_SECRET = ${JSON.stringify(fallbackSecret)};

const HONEYPOT_PATHS = new Set([
  "/.env",
  "/.env.local",
  "/.env.production",
  "/.git/config",
  "/.aws/credentials",
  "/wp-login.php",
  "/phpinfo.php",
  "/_next/mcp",
  "/actuator/env",
  "/eval-stdin.php"
]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const clientIP = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
    const userAgent = request.headers.get("User-Agent") || "";
    const uaLower = userAgent.toLowerCase();

    // Composite TLS/Network fingerprint compatible with Cloudflare Free, Pro & Enterprise
    const ja4OrTls =
      request.cf?.botManagement?.ja4 ||
      [request.cf?.tlsVersion, request.cf?.tlsCipher, request.cf?.httpProtocol].filter(Boolean).join(":") ||
      "std-tls";
    const asn = String(request.cf?.asn || "0");
    const hmacSecret = (env && env.STEALTHMARK_SECRET) || FALLBACK_DOMAIN_SECRET;

    // 1. Allowlist payment webhooks (Stripe, Polar, WooCommerce)
    const isPaymentWebhook =
      url.pathname.startsWith("/wc-api/") ||
      url.pathname.startsWith("/wp-json/stripe/") ||
      url.pathname.startsWith("/api/webhooks/") ||
      url.pathname.startsWith("/webhook");

    // 2. Block inbound Brotli-compressed request bodies (CVE-2026-111497 Node2Shell RCE mitigation)
    const contentEncoding = (request.headers.get("content-encoding") || "").toLowerCase();
    if (contentEncoding.includes("br")) {
      return new Response("Blocked inbound Content-Encoding: br (CVE-2026-111497 Node2Shell mitigation)", { status: 415 });
    }

    // 2b. Anti-SSRF Cloud Metadata & VPN Zero-Day Edge Gate (SonicWall SMA 1000, Cisco ASA CVE-2026-76418, Ivanti CVE-2026-104935)
    const decodedUri = decodeURIComponent(url.pathname + url.search);
    if (
      /(?:169\.254\.169\.254|metadata\.google\.internal|fd00:ec2::254|::ffff:169\.254\.169\.254)/i.test(decodedUri) ||
      /^\/(?:\+CSCOE\+|dana-na|dana-ws|amc|__api__)\//i.test(decodedUri)
    ) {
      ctx.waitUntil(registerThreatAndEscalate(env, clientIP, ja4OrTls, url.hostname, "SSRF/VPN-ZeroDay Probe: " + url.pathname));
      return new Response("StealthMark v5 Edge Shield: Blocked SSRF / VPN Appliance Zero-Day Vector.", { status: 403 });
    }

    // 2c. Edge PDF Malware, Active-Object (/JavaScript, /Launch, /OpenAction) & AI Prompt-Injection CDR Inspector
    const reqContentType = (request.headers.get("content-type") || "").toLowerCase();
    if (
      ["POST", "PUT"].includes(request.method) &&
      (reqContentType.includes("application/pdf") || reqContentType.includes("multipart/form-data") || url.pathname.endsWith(".pdf"))
    ) {
      const pdfVerdict = await inspectIncomingPdfStream(request, env, ctx, clientIP, ja4OrTls, url.hostname);
      if (!pdfVerdict.safe) return pdfVerdict.response;
    }

    // 3. Resolve current DEFCON posture (5 = Normal, 1 = Maximum Alert)
    let defcon = parseInt((env && env.DEFAULT_DEFCON) || "5", 10);
    if (env && env.STEALTHMARK_KV) {
      const kvDefcon = await env.STEALTHMARK_KV.get("defcon:" + url.hostname);
      if (kvDefcon) defcon = parseInt(kvDefcon, 10);
      const isBlockedIP = await env.STEALTHMARK_KV.get("block:" + clientIP);
      if (isBlockedIP) {
        return new Response("StealthMark Active Shield: Access Denied (Honeypot Signature)", {
          status: 403,
          headers: { "Content-Type": "text/plain", "X-StealthMark-Block": "Honeypot-Trigger" }
        });
      }
    }

    // 4. Client-Side RASP Telemetry Receiver
    if (url.pathname === "/__stealthmark/telemetry" && request.method === "POST") {
      return handleClientTelemetry(request, env, ctx, clientIP, ja4OrTls, url.hostname);
    }

    // 5. Active Honeypot / Canary Traps & Scanner Blocking
    if (!isPaymentWebhook) {
      if (
        HONEYPOT_PATHS.has(url.pathname.toLowerCase()) ||
        uaLower.includes("zgrab") ||
        uaLower.includes("nuclei") ||
        uaLower.includes("masscan")
      ) {
        ctx.waitUntil(registerThreatAndEscalate(env, clientIP, ja4OrTls, url.hostname, "Honeypot/Scanner: " + url.pathname));
        return new Response("Not Found", {
          status: 404,
          headers: { "X-StealthMark-Canary": "Triggered" }
        });
      }
    }

    // 6. Anti-AiTM Reverse Proxy Detection (Evilginx2, Modlishka, Muraena, Spoofed Host)
    const viaHeader = request.headers.get("Via") || "";
    const xForwardedHost = request.headers.get("X-Forwarded-Host") || "";
    const isSuspectedAiTMProxy =
      (xForwardedHost && xForwardedHost !== url.hostname && !xForwardedHost.endsWith("." + TARGET_DOMAIN)) ||
      /evilginx|modlishka|muraena|mitmproxy/i.test(userAgent + " " + viaHeader);

    if (isSuspectedAiTMProxy) {
      ctx.waitUntil(registerThreatAndEscalate(env, clientIP, ja4OrTls, url.hostname, "AiTM Reverse Proxy Detected"));
      return new Response("Security Alert: Untrusted Proxy Intermediary Blocked by StealthMark.", {
        status: 403,
        headers: { "Clear-Site-Data": '"cookies", "storage"' }
      });
    }

    // 7. Cryptographic Session Binding (Anti-Cookie Theft / Replay)
    const cookieHeader = request.headers.get("Cookie") || "";
    const hasAuthSession = /(?:__Host-session|session_id|auth_token)=([^;]+)/i.test(cookieHeader);
    const expectedBindingHash = await computeSessionBindingHash(ja4OrTls, asn, userAgent, hmacSecret);

    if (hasAuthSession && defcon <= 4) {
      const boundCookieMatch = cookieHeader.match(/__Host-sm_bind=([a-f0-9]{64})/i);
      if (boundCookieMatch && boundCookieMatch[1] !== expectedBindingHash) {
        ctx.waitUntil(registerThreatAndEscalate(env, clientIP, ja4OrTls, url.hostname, "Session Cookie Replay Blocked"));
        return new Response("Session Invalidated: TLS/Device Fingerprint Mismatch (StealthMark Anti-Replay).", {
          status: 401,
          headers: {
            "Clear-Site-Data": '"cookies", "storage"',
            "Set-Cookie": "__Host-sm_bind=; Path=/; Secure; HttpOnly; Max-Age=0"
          }
        });
      }
    }

    // 8. DEFCON 1 Emergency Mutation Freeze
    if (defcon === 1 && !isPaymentWebhook && ["POST", "PUT", "DELETE", "PATCH"].includes(request.method)) {
      return new Response(
        JSON.stringify({ error: "DEFCON 1 Active: State mutations temporarily frozen by StealthMark Active Shield." }),
        {
          status: 503,
          headers: {
            "Content-Type": "application/json",
            "Clear-Site-Data": '"cookies", "storage"',
            "Retry-After": "300"
          }
        }
      );
    }

    const response = await fetch(request);
    const newHeaders = new Headers(response.headers);

    // 9. Per-Request Cryptographic Nonce & Domain Lock Signature
    const nonceBytes = new Uint8Array(16);
    crypto.getRandomValues(nonceBytes);
    const nonce = btoa(String.fromCharCode(...nonceBytes));
    const domainSignature = await computeSessionBindingHash(url.hostname, "domain-lock", "", hmacSecret);

    applyDefconHeaders(newHeaders, defcon, nonce, url.hostname);

    if (!cookieHeader.includes("__Host-sm_bind=")) {
      newHeaders.append(
        "Set-Cookie",
        "__Host-sm_bind=" + expectedBindingHash + "; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=86400"
      );
    }

    const contentType = newHeaders.get("Content-Type") || "";
    if (contentType.includes("text/html") && typeof HTMLRewriter !== "undefined") {
      return new HTMLRewriter()
        .on("script", {
          element(el) {
            if (!el.getAttribute("nonce")) el.setAttribute("nonce", nonce);
          }
        })
        .on("head", {
          element(el) {
            el.prepend(
              '<meta name="stealthmark-lock" content="' + domainSignature + '" data-origin="' + url.hostname + '" data-defcon="' + defcon + '">',
              { html: true }
            );
          }
        })
        .transform(
          new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders
          })
        );
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders
    });
  }
};

async function computeSessionBindingHash(ja4, asn, ua, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const data = encoder.encode(ja4 + "|" + ua.slice(0, 64));
  const signature = await crypto.subtle.sign("HMAC", key, data);
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function applyDefconHeaders(headers, defcon, nonce, hostname) {
  headers.delete("X-Powered-By");
  headers.delete("Via");
  headers.set("X-StealthMark-Protected", "v5.1-DEFCON-" + defcon + "-VirtualPatch-PDFGuard-AntiSSRF");
  headers.set("X-StealthMark-Shield", "ACTIVE");
  // HSTS starts at 5 minutes. Raise it to 86400, then 31536000, once every subdomain of
  // TARGET_DOMAIN serves HTTPS. includeSubDomains and preload are deliberately left to you.
  headers.set("Strict-Transport-Security", "max-age=300");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set(
    "Permissions-Policy",
    "clipboard-read=(), clipboard-write=(self), camera=(), microphone=(), geolocation=(), display-capture=(), payment=(), usb=(), browsing-topics=()"
  );
  const respType = (headers.get("Content-Type") || "").toLowerCase();
  if (respType.includes("application/pdf")) {
    headers.set("Content-Security-Policy", "sandbox; default-src 'none'");
    headers.set("Content-Disposition", "attachment");
    headers.set("X-Download-Options", "noopen");
    return;
  }
  headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'nonce-" + nonce + "' 'strict-dynamic'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://" + hostname,
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
      "upgrade-insecure-requests"
    ].join("; ")
  );
  if (defcon <= 3) {
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
    headers.set("Cross-Origin-Resource-Policy", "same-origin");
  }
}

async function inspectIncomingPdfStream(request, env, ctx, ip, ja4, hostname) {
  try {
    const buf = await request.clone().arrayBuffer();
    const raw = new TextDecoder("latin1").decode(new Uint8Array(buf.slice(0, 1024 * 1024)));
    if (!raw.includes("%PDF-")) return { safe: true };
    const dangerousTag = raw.match(/\/(?:JavaScript|JS\b|Launch\b|EmbeddedFiles\b|OpenAction\b|AA\b|RichMedia\b|XFA\b|GoToR\b|SubmitForm\b)|<!ENTITY\s+/i);
    if (dangerousTag) {
      ctx.waitUntil(registerThreatAndEscalate(env, ip, ja4, hostname, "Weaponized PDF Blocked: " + dangerousTag[0]));
      return {
        safe: false,
        response: new Response(
          JSON.stringify({ error: "StealthMark v5 PDF CDR Shield: Blocked PDF containing executable tag " + dangerousTag[0] }),
          { status: 422, headers: { "Content-Type": "application/json" } }
        )
      };
    }
    if (/(?:ignore all previous instructions|system prompt override|hire this candidate immediately|approve this invoice immediately)/i.test(raw)) {
      ctx.waitUntil(registerThreatAndEscalate(env, ip, ja4, hostname, "PDF AI Prompt Injection Blocked"));
      return {
        safe: false,
        response: new Response(
          JSON.stringify({ error: "StealthMark v5 PDF CDR Shield: Hidden AI prompt injection detected inside PDF." }),
          { status: 422, headers: { "Content-Type": "application/json" } }
        )
      };
    }
    return { safe: true };
  } catch {
    return { safe: true };
  }
}

async function registerThreatAndEscalate(env, ip, ja4, hostname, reason) {
  if (!env || !env.STEALTHMARK_KV) return;
  await env.STEALTHMARK_KV.put("block:" + ip, JSON.stringify({ ja4, reason, ts: Date.now() }), { expirationTtl: 3600 });
  const counterKey = "attacks:" + hostname;
  const currentCount = parseInt((await env.STEALTHMARK_KV.get(counterKey)) || "0", 10) + 1;
  await env.STEALTHMARK_KV.put(counterKey, String(currentCount), { expirationTtl: 600 });
  if (currentCount >= 10) {
    await env.STEALTHMARK_KV.put("defcon:" + hostname, "2", { expirationTtl: 1800 });
  }
}

async function handleClientTelemetry(request, env, ctx, ip, ja4, hostname) {
  try {
    const payload = await request.json();
    if (payload?.type === "CLONE_DETECTED" || payload?.type === "AUTOFILL_SCRAPE_ATTEMPT") {
      ctx.waitUntil(registerThreatAndEscalate(env, ip, ja4, hostname, payload.type));
    }
    return new Response(JSON.stringify({ received: true }), {
      status: 202,
      headers: { "Content-Type": "application/json" }
    });
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
}`;
}

export function buildClientRaspShield(domain: string): string {
  return `/**
 * StealthMark Client-Side RASP & Anti-Cloning Shield v2.0 (<3KB)
 * Target Domain: ${domain}
 * Protects end-users against:
 * 1. AiTM Phishing Proxy & Unauthorized Domain Cloning (Domain Lock)
 * 2. Hidden Input Autofill Scraping (Credentials & Credit Cards)
 * 3. Unauthorized WebRTC STUN/TURN Real-IP Leaks behind VPN
 */
(function initStealthMarkClientShield() {
  "use strict";
  const AUTHORIZED_DOMAIN = ${JSON.stringify(domain)};
  const metaLock = document.querySelector('meta[name="stealthmark-lock"]');
  const authorizedOrigin = (metaLock && metaLock.getAttribute("data-origin")) || AUTHORIZED_DOMAIN;
  const telemetryUrl = "https://" + authorizedOrigin + "/__stealthmark/telemetry";

  function sendSecurityAlert(type, details) {
    try {
      const payload = JSON.stringify({
        type,
        details,
        currentOrigin: window.location.origin,
        authorizedOrigin,
        ts: new Date().toISOString()
      });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(telemetryUrl, payload);
      } else {
        fetch(telemetryUrl, { method: "POST", body: payload, keepalive: true }).catch(function () {});
      }
    } catch {}
  }

  // 1. Domain Lock (Anti-Cloning & AiTM Phishing Proxy Guard)
  const currentHost = window.location.hostname;
  const isLocalDev = currentHost === "localhost" || currentHost === "127.0.0.1";
  if (
    !isLocalDev &&
    authorizedOrigin &&
    currentHost !== authorizedOrigin &&
    !currentHost.endsWith("." + authorizedOrigin)
  ) {
    sendSecurityAlert("CLONE_DETECTED", { spoofedHost: currentHost });
    document.addEventListener("DOMContentLoaded", function () {
      document.querySelectorAll("form, input").forEach(function (el) {
        el.setAttribute("disabled", "true");
      });
    });
    return;
  }

  // 2. Debounced Hidden Autofill Trap Guard
  function isInputSuspiciouslyHidden(input) {
    const type = (input.getAttribute("type") || "text").toLowerCase();
    const auto = (input.getAttribute("autocomplete") || "").toLowerCase();
    const isSensitive =
      type === "password" ||
      /cc-number|cc-csc|current-password|new-password/.test(auto);
    if (!isSensitive) return false;
    const style = window.getComputedStyle(input);
    const rect = input.getBoundingClientRect();
    const zeroOpacity = parseFloat(style.opacity) < 0.05;
    const offScreen = rect.left < -500 || rect.top < -500 || (rect.width <= 2 && rect.height <= 2);
    return (zeroOpacity || offScreen) && style.display !== "none";
  }

  let scanScheduled = false;
  function scheduleAutofillCheck() {
    if (scanScheduled) return;
    scanScheduled = true;
    setTimeout(function () {
      scanScheduled = false;
      document.querySelectorAll("input").forEach(function (input) {
        if (isInputSuspiciouslyHidden(input)) {
          input.setAttribute("autocomplete", "off");
          input.value = "";
          input.disabled = true;
          sendSecurityAlert("AUTOFILL_SCRAPE_ATTEMPT", { id: input.name || input.id || "hidden-input" });
        }
      });
    }, 250);
  }

  if (typeof MutationObserver !== "undefined" && document.documentElement) {
    const observer = new MutationObserver(scheduleAutofillCheck);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  // 3. WebRTC STUN/TURN Leak Firewall (Skipped if data-allow-webrtc="true" is set)
  const allowWebRtc =
    window.__STEALTHMARK_ALLOW_WEBRTC__ ||
    (document.documentElement && document.documentElement.getAttribute("data-allow-webrtc") === "true");
  if (typeof window.RTCPeerConnection !== "undefined" && !allowWebRtc) {
    const OriginalRTC = window.RTCPeerConnection;
    window.RTCPeerConnection = function (config) {
      if (config && Array.isArray(config.iceServers) && config.iceServers.length > 0) {
        sendSecurityAlert("WEBRTC_STUN_LEAK_BLOCKED", { count: config.iceServers.length });
        config = Object.assign({}, config, { iceServers: [] });
      }
      return new OriginalRTC(config);
    };
    window.RTCPeerConnection.prototype = OriginalRTC.prototype;
  }
})();`;
}

export function buildLiveBadgeSnippet(domain: string): string {
  return `<!-- StealthMark Live Security Trust Badge -->
<a href="https://stealthmark.io/verify/${domain}?utm_source=trust_badge" target="_blank" rel="noopener noreferrer" title="Verify Real-Time Security Posture on StealthMark">
  <img src="https://stealthmark.io/api/badge/${domain}.svg" alt="StealthMark Security Posture - Verified" width="256" height="32" loading="lazy" />
</a>`;
}
