import { describe, it, expect } from "vitest";
import { describeUpstreamError } from "../upstream-error.js";

const CTX = { remoteUrl: "https://multipov.ai/mcp" };

// ---------------------------------------------------------------------------
// upstream-error tests
//
// Pins the translation logic for upstream error patterns. The big new
// case is CF 1102 (Worker exceeded CPU/memory) — closes todo #69 from
// the multipov repo. Without this translation, the SDK forwards the
// raw CF 1102 envelope to the MCP client and the operator has no way
// to programmatically distinguish "retry with smaller payload" from
// "wait and retry" from "actual server bug."
// ---------------------------------------------------------------------------

describe("describeUpstreamError", () => {
  it("translates CF Worker 1102 (error_code literal)", () => {
    const err = new Error(
      'multipov.ai returned a server error: HTTP 503 - {"error_code":1102,"error_name":"worker_exceeded_resources"}',
    );
    const msg = describeUpstreamError(err, CTX);
    expect(msg).toContain("Cloudflare Error 1102");
    expect(msg).toContain("payload_complexity_too_high");
    expect(msg).toContain("Quota status: ambiguous");
    expect(msg).toMatch(/split.*chunks/i);
  });

  it("translates CF Worker 1102 (error_name slug)", () => {
    const err = new Error(
      "Streamable HTTP error: 503 worker_exceeded_resources",
    );
    const msg = describeUpstreamError(err, CTX);
    expect(msg).toContain("Cloudflare Error 1102");
    expect(msg).toContain("payload_complexity_too_high");
  });

  it("translates CF Worker 1102 (human-readable string)", () => {
    const err = new Error(
      "Error: Worker exceeded CPU time limit and was terminated",
    );
    const msg = describeUpstreamError(err, CTX);
    expect(msg).toContain("Cloudflare Error 1102");
  });

  it("extracts CF Ray ID into the message when present", () => {
    const err = new Error(
      'HTTP 503 - {"error_code":1102,"ray_id":"9f9ddf21fbc3c305"}',
    );
    const msg = describeUpstreamError(err, CTX);
    expect(msg).toContain("9f9ddf21fbc3c305");
  });

  it("Ray ID detector tolerates a datacenter suffix", () => {
    const err = new Error("Error 1102 cf-ray: abc123def4567890-SEA");
    const msg = describeUpstreamError(err, CTX);
    expect(msg).toMatch(/abc123def4567890(-SEA)?/);
  });

  it("translates CF 1101 (Worker startup failure) distinctly from 1102", () => {
    const err = new Error("HTTP 503 - Error 1101: Worker threw exception");
    const msg = describeUpstreamError(err, CTX);
    expect(msg).toContain("Cloudflare Error 1101");
    expect(msg).toContain("transient");
    expect(msg).not.toContain("payload_complexity_too_high");
  });

  it("translates CF 1104 similarly", () => {
    const err = new Error("HTTP 503 - Error 1104 worker threw exception");
    const msg = describeUpstreamError(err, CTX);
    expect(msg).toContain("Cloudflare Error 1104");
    expect(msg).toContain("transient");
  });

  it("translates 401 → API key rejected", () => {
    const err = new Error("HTTP 401 Unauthorized");
    const msg = describeUpstreamError(err, CTX);
    expect(msg).toContain("rejected the API key");
    expect(msg).toContain("MULTIPOV_API_KEY");
  });

  it("translates 403 → access refused", () => {
    const err = new Error("403 Forbidden");
    const msg = describeUpstreamError(err, CTX);
    expect(msg).toContain("refused the request");
  });

  it("translates 429 → rate limited", () => {
    const err = new Error("HTTP 429 Too Many Requests");
    const msg = describeUpstreamError(err, CTX);
    expect(msg).toContain("rate-limited");
  });

  it("falls back to generic 5xx for non-1102 server errors", () => {
    const err = new Error("HTTP 502 Bad Gateway");
    const msg = describeUpstreamError(err, CTX);
    expect(msg).toContain("server error");
    expect(msg).not.toContain("Cloudflare Error 1102");
  });

  it("translates network errors with the remote URL in context", () => {
    const err = new Error("ECONNRESET");
    const msg = describeUpstreamError(err, CTX);
    expect(msg).toContain("Network error");
    expect(msg).toContain("https://multipov.ai/mcp");
  });

  it("passes unknown errors through verbatim", () => {
    const err = new Error("some completely novel error nobody pattern-matched");
    const msg = describeUpstreamError(err, CTX);
    expect(msg).toBe("some completely novel error nobody pattern-matched");
  });

  it("handles non-Error inputs without crashing", () => {
    expect(describeUpstreamError("string error", CTX)).toBe("string error");
    expect(describeUpstreamError(null, CTX)).toBe("null");
    expect(describeUpstreamError(undefined, CTX)).toBe("undefined");
  });

  it("1102 detection takes precedence over generic 5xx", () => {
    // Both patterns match — make sure the more-specific case wins.
    const err = new Error(
      'multipov.ai 503 server error: {"error_code":1102}',
    );
    const msg = describeUpstreamError(err, CTX);
    expect(msg).toContain("Cloudflare Error 1102");
    expect(msg).toContain("payload_complexity_too_high");
  });
});
