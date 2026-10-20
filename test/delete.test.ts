import { afterEach, describe, expect, it } from "vitest";
import {
  BRAND,
  ERROR,
  json,
  type MockJules,
  runJules,
  startMockJules,
} from "./helpers";

let mock: MockJules | undefined;
afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

const deleteEnv = (baseUrl: string, sessionId: string) => ({
  JULES_API_BASE_URL: baseUrl,
  JULES_API_KEY: "test-key",
  JULES_MODE: "delete",
  JULES_SESSION_ID: sessionId,
});

describe("jules.sh delete", () => {
  it("DELETEs sessions/<id> with the API key header", async () => {
    mock = await startMockJules(() => json(200, {}));
    const result = await runJules(
      "delete",
      deleteEnv(mock.baseUrl, "16871897978654894041"),
    );

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0].method).toBe("DELETE");
    expect(mock.requests[0].path).toBe(
      "/v1alpha/sessions/16871897978654894041",
    );
    expect(mock.requests[0].headers["x-goog-api-key"]).toBe("test-key");
    expect(result.stdout).toContain(
      `${BRAND} Session sessions/16871897978654894041 deleted successfully`,
    );
  });

  it("does not double the sessions/ prefix", async () => {
    mock = await startMockJules(() => json(200, {}));
    const result = await runJules(
      "delete",
      deleteEnv(mock.baseUrl, "sessions/123"),
    );

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(mock.requests[0].path).toBe("/v1alpha/sessions/123");
  });

  it("fails with an error annotation on HTTP errors", async () => {
    mock = await startMockJules(() =>
      json(403, { error: { message: "forbidden" } }),
    );
    const result = await runJules("delete", deleteEnv(mock.baseUrl, "123"));

    expect(result.code).toBe(1);
    expect(result.stdout).toContain(`${ERROR}Jules API returned HTTP 403`);
  });
});
