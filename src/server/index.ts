import "dotenv/config";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import {
  buildRecommendations,
  deduplicateEvents,
  enrichValidationInput,
  safeValidateInput,
} from "../core/index.js";
import type { ProviderCapability, ValidationResult } from "../core/types.js";
import { createProviderRegistry } from "../providers/index.js";
import { deriveDataMode } from "./result.js";

const app = new Hono();
const registry = createProviderRegistry();
const port = Number(process.env.FR_LOCAL_API_PORT || 8787);
const MAX_JSON_BYTES = 64 * 1024;

app.get("/api/health", (context) =>
  context.json({ ok: true, service: "front-row-local-api" })
);

function providerPayload(): { providers: ProviderCapability[] } {
  return { providers: registry.capabilities() };
}

app.get("/api/providers", (context) => context.json(providerPayload()));
app.get("/api/capabilities", (context) => context.json(providerPayload()));

app.post("/api/validation-runs", async (context) => {
  const origin = context.req.header("Origin");
  if (origin && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) {
    return context.json({ error: "只接受来自本地 Front Row 页面的请求。" }, 403);
  }
  if (!context.req.header("Content-Type")?.toLowerCase().includes("application/json")) {
    return context.json({ error: "请求必须使用 JSON 格式。" }, 415);
  }

  let body: unknown;
  try {
    const rawBody = await context.req.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_JSON_BYTES) {
      return context.json({ error: "请求内容过大。" }, 413);
    }
    body = JSON.parse(rawBody);
  } catch {
    return context.json({ error: "请求内容不是有效的 JSON。" }, 400);
  }

  const parsed = safeValidateInput(body);
  if (!parsed.success) {
    return context.json(
      {
        error: "请检查输入内容。",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      },
      400
    );
  }

  const enrichedInput = enrichValidationInput(parsed.data);
  const { events, diagnostics } = await registry.fetchEvents(enrichedInput);
  const deduplicated = deduplicateEvents(events);
  const recommendations = buildRecommendations(enrichedInput, deduplicated);
  const dataMode = deriveDataMode(events, diagnostics);

  const result: ValidationResult = {
    runId: crypto.randomUUID(),
    generatedAt: new Date().toISOString(),
    dataMode,
    recommendations,
    diagnostics,
    coverage: {
      rawEvents: events.length,
      deduplicatedEvents: deduplicated.length,
      eligibleEvents: recommendations.length
    }
  };

  return context.json(result);
});

app.onError((error, context) => {
  console.error(error);
  return context.json({ error: "本地服务发生错误，请查看终端信息。" }, 500);
});

serve({
  fetch: app.fetch,
  hostname: "127.0.0.1",
  port
});

console.log(`Front Row local API: http://127.0.0.1:${port}`);

export { app };
