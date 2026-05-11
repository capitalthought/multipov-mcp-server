/**
 * Upstream error translation.
 *
 * Extracted from src/index.ts so the regex-based detection logic has a
 * unit-testable surface. The function is called from two sites in
 * index.ts: the tools/list handler (where it becomes the message of a
 * thrown Error) and the tools/call handler (where it becomes the text
 * content of an isError result).
 *
 * The point of describeUpstreamError is to translate generic SDK errors
 * (which surface as Error objects whose .message is a status code or
 * stringified body) into actionable text the operator can react to.
 *
 * **CF 1102 / Worker-boundary detection (todo #69, 2026-05-10):**
 * When the multipov.ai Cloudflare Worker exceeds its CPU/memory budget,
 * the CF edge kills the isolate and emits a 503 response with body
 * containing `error_code: 1102` / `worker_exceeded_resources`. The
 * Worker code itself never gets to respond — there's no business-logic
 * way to translate this into a typed MCP error envelope server-side.
 * The client-side proxy is the only layer that can recognize the
 * 1102 pattern and surface a useful message.
 *
 * See docs/plans/2026-05-10-worker-boundary-error-envelope-design.md
 * (in capitalthought/multipov) §2.2 for full design context.
 */

export interface UpstreamErrorContext {
  remoteUrl: string;
}

export function describeUpstreamError(
  err: unknown,
  ctx: UpstreamErrorContext,
): string {
  const e = err as { message?: string; code?: number } | undefined;
  const msg = e?.message ?? String(err);

  // ---- CF Worker 1102 — Worker exceeded CPU/memory budget ----
  // Detected by either the literal 1102 code, the "worker_exceeded_resources"
  // CF error_name slug, or the human-readable string "Worker exceeded resource
  // limits". The latter is what CF shows in its own dashboards; the SDK may
  // surface any of the three depending on whether the body is JSON or HTML.
  if (
    /\b1102\b/.test(msg) ||
    /worker_exceeded_resources/i.test(msg) ||
    /worker exceeded (?:cpu|memory|resource)/i.test(msg)
  ) {
    const rayId = extractCfRayId(msg);
    return (
      "multipov.ai's Worker exceeded its CPU/memory budget on this request " +
      "(Cloudflare Error 1102). This is content-pattern-sensitive — the Worker " +
      "ran out of CPU before reaching the queue, so the request never started. " +
      "**Recoverable class: payload_complexity_too_high.** " +
      "Recovery: split the document into smaller chunks (try ≤4K words each) " +
      "and resubmit. Dense SQL schema / function-body content is a known " +
      "trigger; prose-heavy content of comparable size usually completes fine. " +
      "**Quota status: ambiguous** — the Worker died before it could record " +
      "whether your daily slot was consumed; if your next submit returns " +
      "`rate_limited` faster than expected, that's why." +
      (rayId ? ` (Cloudflare Ray ID: ${rayId})` : "")
    );
  }

  // ---- CF Worker startup-failure variants (1101, 1104) ----
  // Distinct from 1102 (resource exceeded) — these mean the Worker
  // failed to initialize at all. Less likely on multipov.ai which has
  // stable deploys, but worth catching so the user gets a clear signal.
  if (/\b110[14]\b/.test(msg)) {
    return (
      "multipov.ai's Worker failed to initialize (Cloudflare Error " +
      (msg.match(/\b(110[14])\b/)?.[1] ?? "1101/1104") +
      "). This is a deployment-level issue, not a payload issue. " +
      "**Recoverable class: transient.** Wait 30-60s and retry; if it " +
      "persists more than 5 min, the operator needs to investigate the " +
      "Worker deploy."
    );
  }

  if (/401|unauthori[sz]ed/i.test(msg)) {
    return (
      "multipov.ai rejected the API key (HTTP 401). " +
      "Check that MULTIPOV_API_KEY is set correctly and hasn't been revoked. " +
      "You can rotate keys at https://multipov.ai/settings/api-keys."
    );
  }
  if (/403|forbidden/i.test(msg)) {
    return (
      "multipov.ai refused the request (HTTP 403). " +
      "Your account may not have access to this tool or feature."
    );
  }
  if (/429|rate/i.test(msg)) {
    return (
      "multipov.ai rate-limited the request (HTTP 429). " +
      "Wait a few seconds and retry, or check your daily quota at https://multipov.ai/settings."
    );
  }
  if (/5\d\d|server error/i.test(msg)) {
    return `multipov.ai returned a server error: ${msg}. Try again in a moment.`;
  }
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|network/i.test(msg)) {
    return `Network error talking to ${ctx.remoteUrl}: ${msg}. Check your internet connection.`;
  }
  return msg;
}

/**
 * Extract a Cloudflare Ray ID from an error message string, if present.
 * Ray IDs are 16-hex-char identifiers, sometimes followed by a `-XXX`
 * datacenter suffix. Returns null when no match.
 */
function extractCfRayId(msg: string): string | null {
  const m = msg.match(/\b([a-f0-9]{16})(?:-[A-Z0-9]{3,4})?\b/i);
  return m ? m[0] : null;
}
