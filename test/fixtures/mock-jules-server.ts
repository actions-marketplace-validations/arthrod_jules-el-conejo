// Mock Jules API for the e2e CI job: `bun test/fixtures/mock-jules-server.ts <port>`.
// GET /__requests returns every recorded API call; GET /healthz answers readiness.
import { json, type MockJules, SESSION, startMockJules } from "../helpers";

const port = Number(process.argv[2] ?? 8787);
const isApiCall = (path: string) => path.startsWith("/v1alpha/");

let mock: MockJules | undefined;
mock = await startMockJules((req) => {
  if (req.path === "/healthz") return { status: 200, body: "ok" };
  if (req.path === "/__requests") {
    return json(
      200,
      (mock?.requests ?? []).filter((r) => isApiCall(r.path)),
    );
  }
  if (req.method === "POST" && req.path === "/v1alpha/sessions")
    return json(200, SESSION);
  if (req.method === "DELETE" && req.path.startsWith("/v1alpha/sessions/"))
    return json(200, {});
  return json(404, {
    error: { message: `unexpected ${req.method} ${req.path}` },
  });
}, port);

console.log(`mock Jules API listening on ${mock.baseUrl}`);
