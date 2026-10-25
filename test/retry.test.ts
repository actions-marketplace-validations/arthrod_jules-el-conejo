import { execSync } from "node:child_process";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ERROR,
  json,
  type MockJules,
  makeScratchDir,
  runJules,
  SESSION,
  startMockJules,
  WARNING,
} from "./helpers";

let mock: MockJules | undefined;
afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

const createEnv = (
  baseUrl: string,
  overrides: Record<string, string> = {},
) => ({
  JULES_API_BASE_URL: baseUrl,
  JULES_API_KEY: "test-key",
  JULES_MODE: "create",
  JULES_PROMPT: "Fix it",
  JULES_TITLE: "",
  JULES_STARTING_BRANCH: "main",
  JULES_REPOSITORY: "octo/repo",
  JULES_REQUIRE_PLAN_APPROVAL: "false",
  JULES_AUTOMATION_MODE: "AUTO_CREATE_PR",
  JULES_INCLUDE_LAST_COMMIT: "false",
  JULES_INCLUDE_COMMIT_LOG: "false",
  ...overrides,
});

const deleteEnv = (
  baseUrl: string,
  overrides: Record<string, string> = {},
) => ({
  JULES_API_BASE_URL: baseUrl,
  JULES_API_KEY: "test-key",
  JULES_MODE: "delete",
  JULES_SESSION_ID: "16871897978654894041",
  ...overrides,
});

const quotaExhausted = () =>
  json(429, {
    error: {
      code: 429,
      message: "Resource has been exhausted (e.g. check quota).",
      status: "RESOURCE_EXHAUSTED",
    },
  });

const preconditionFailed = () =>
  json(400, {
    error: {
      code: 400,
      message: "Precondition check failed.",
      status: "FAILED_PRECONDITION",
    },
  });

/** The warning api_request signs before each wait, e.g. retry 1 of 4. */
const capWarning = (
  code: number,
  status: string,
  minutes: number,
  retry: number,
) =>
  `${WARNING}Jules API returned HTTP ${code} ${status} (the account may be at its concurrency cap); retrying in ${minutes} minutes (retry ${retry} of 4)`;

/** Builds a sleep shim that logs its arguments, one per line, and waits 0s. */
const makeSleepShim = async (): Promise<{ dir: string; log: string }> => {
  const dir = await makeScratchDir("jules-sleepshim-");
  const log = join(dir, "sleep.log");
  // Created empty up front so a script that never sleeps reads as [].
  await writeFile(log, "");
  const shim = join(dir, "sleep");
  await writeFile(
    shim,
    [
      "#!/usr/bin/env bash",
      `printf '%s\\n' "$@" >> ${JSON.stringify(log)}`,
      "exit 0",
      "",
    ].join("\n"),
  );
  await chmod(shim, 0o755);
  return { dir, log };
};

/** The seconds the script asked the external sleep to wait, one per call. */
const slept = async (log: string): Promise<string[]> =>
  (await readFile(log, "utf8")).split("\n").filter((line) => line !== "");

/** Builds a curl shim that exits 28 (curl's timeout) on its first invocation
 * and afterwards execs the real curl. */
const makeCurlTimeoutShim = async (): Promise<{ dir: string }> => {
  const dir = await makeScratchDir("jules-curlshim-");
  const realCurl = execSync("command -v curl", { encoding: "utf8" }).trim();
  const marker = join(dir, "timed-out");
  const shim = join(dir, "curl");
  await writeFile(
    shim,
    [
      "#!/usr/bin/env bash",
      `if [ ! -e ${JSON.stringify(marker)} ]; then`,
      `  touch ${JSON.stringify(marker)}`,
      "  exit 28",
      "fi",
      `exec ${JSON.stringify(realCurl)} "$@"`,
      "",
    ].join("\n"),
  );
  await chmod(shim, 0o755);
  return { dir };
};

describe("jules.sh waits and retries over-cap replies", () => {
  it("create retries one 429 after 5 minutes and succeeds", async () => {
    const sleep = await makeSleepShim();
    let calls = 0;
    mock = await startMockJules(() => {
      calls += 1;
      return calls === 1 ? quotaExhausted() : json(200, SESSION);
    });
    const result = await runJules(
      "create",
      createEnv(mock.baseUrl, {
        PATH: `${sleep.dir}:${process.env.PATH ?? ""}`,
      }),
    );

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(mock.requests).toHaveLength(2);
    expect(await slept(sleep.log)).toEqual(["300"]);
    expect(result.stdout).toContain(
      capWarning(429, "RESOURCE_EXHAUSTED", 5, 1),
    );
    expect(result.outputs.session_id).toBe(SESSION.id);
  });

  it("create retries 400 FAILED_PRECONDITION twice before it clears", async () => {
    const sleep = await makeSleepShim();
    let calls = 0;
    mock = await startMockJules(() => {
      calls += 1;
      return calls < 3 ? preconditionFailed() : json(200, SESSION);
    });
    const result = await runJules(
      "create",
      createEnv(mock.baseUrl, {
        PATH: `${sleep.dir}:${process.env.PATH ?? ""}`,
      }),
    );

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(mock.requests).toHaveLength(3);
    expect(await slept(sleep.log)).toEqual(["300", "300"]);
    expect(result.stdout).toContain(
      capWarning(400, "FAILED_PRECONDITION", 5, 2),
    );
  });

  it("create fails at once on 400 INVALID_ARGUMENT", async () => {
    const sleep = await makeSleepShim();
    mock = await startMockJules(() =>
      json(400, {
        error: {
          code: 400,
          message: "Request contains an invalid argument.",
          status: "INVALID_ARGUMENT",
        },
      }),
    );
    const result = await runJules(
      "create",
      createEnv(mock.baseUrl, {
        PATH: `${sleep.dir}:${process.env.PATH ?? ""}`,
      }),
    );

    expect(result.code).toBe(1);
    expect(mock.requests).toHaveLength(1);
    expect(await slept(sleep.log)).toEqual([]);
    expect(result.stdout).toContain(`${ERROR}Jules API returned HTTP 400`);
  });

  it("create gives up on a 429 after five attempts", async () => {
    const sleep = await makeSleepShim();
    mock = await startMockJules(quotaExhausted);
    const result = await runJules(
      "create",
      createEnv(mock.baseUrl, {
        PATH: `${sleep.dir}:${process.env.PATH ?? ""}`,
      }),
    );

    expect(result.code).toBe(1);
    expect(mock.requests).toHaveLength(5);
    expect(await slept(sleep.log)).toEqual(["300", "300", "300", "900"]);
    expect(result.stdout).toContain(
      capWarning(429, "RESOURCE_EXHAUSTED", 15, 4),
    );
    expect(result.stdout).toContain(`${ERROR}Jules API returned HTTP 429`);
  });

  it("delete gives up on a 429 after its own five attempts", async () => {
    const sleep = await makeSleepShim();
    mock = await startMockJules(quotaExhausted);
    const result = await runJules(
      "delete",
      deleteEnv(mock.baseUrl, {
        PATH: `${sleep.dir}:${process.env.PATH ?? ""}`,
      }),
    );

    expect(result.code).toBe(1);
    expect(mock.requests).toHaveLength(5);
    expect(await slept(sleep.log)).toEqual(["300", "300", "300", "900"]);
    expect(result.stdout).toContain(`${ERROR}Jules API returned HTTP 429`);
  }, 60_000);

  it("delete retries a 429 that clears while it waits", async () => {
    const sleep = await makeSleepShim();
    let calls = 0;
    mock = await startMockJules(() => {
      calls += 1;
      return calls === 1 ? quotaExhausted() : json(200, {});
    });
    const result = await runJules(
      "delete",
      deleteEnv(mock.baseUrl, {
        PATH: `${sleep.dir}:${process.env.PATH ?? ""}`,
      }),
    );

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(mock.requests).toHaveLength(2);
    expect(await slept(sleep.log)).toEqual(["300"]);
  }, 60_000);

  it("delete ignores a 429's Retry-After header", async () => {
    // A curl that re-sent on its own would honor Retry-After (2 s) instead
    // of the cap schedule's 5 minutes.
    const sleep = await makeSleepShim();
    let calls = 0;
    mock = await startMockJules(() => {
      calls += 1;
      return calls === 1
        ? { ...quotaExhausted(), headers: { "retry-after": "2" } }
        : json(200, {});
    });
    const result = await runJules(
      "delete",
      deleteEnv(mock.baseUrl, {
        PATH: `${sleep.dir}:${process.env.PATH ?? ""}`,
      }),
    );

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(mock.requests).toHaveLength(2);
    expect(await slept(sleep.log)).toEqual(["300"]);
  }, 60_000);

  it("create fails at once on a 400 body that is not JSON", async () => {
    const sleep = await makeSleepShim();
    mock = await startMockJules(() => ({
      status: 400,
      body: "Precondition check failed.",
    }));
    const result = await runJules(
      "create",
      createEnv(mock.baseUrl, {
        PATH: `${sleep.dir}:${process.env.PATH ?? ""}`,
      }),
    );

    expect(result.code).toBe(1);
    expect(mock.requests).toHaveLength(1);
    expect(await slept(sleep.log)).toEqual([]);
    expect(result.stdout).toContain(`${ERROR}Jules API returned HTTP 400`);
  });
});

describe("jules.sh retries delete's transient failures", () => {
  it("delete retries a non-JSON 503 and then a cap refusal", async () => {
    // curl's own --retry would concatenate both replies' bodies into one
    // BODY, jq could not parse it, and the cap retry the 400 deserves was
    // skipped.
    const sleep = await makeSleepShim();
    let calls = 0;
    mock = await startMockJules(() => {
      calls += 1;
      if (calls === 1) {
        return { status: 503, body: "<html>proxy error</html>" };
      }
      return calls === 2 ? preconditionFailed() : json(200, {});
    });
    const result = await runJules(
      "delete",
      deleteEnv(mock.baseUrl, {
        PATH: `${sleep.dir}:${process.env.PATH ?? ""}`,
      }),
    );

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(mock.requests).toHaveLength(3);
    expect(await slept(sleep.log)).toEqual(["1", "300"]);
  }, 60_000);

  it("delete gives up on a 503 after four attempts", async () => {
    const sleep = await makeSleepShim();
    let calls = 0;
    mock = await startMockJules(() => {
      calls += 1;
      return calls <= 4 ? json(503, {}) : json(200, {});
    });
    const result = await runJules(
      "delete",
      deleteEnv(mock.baseUrl, {
        PATH: `${sleep.dir}:${process.env.PATH ?? ""}`,
      }),
    );

    expect(result.code).toBe(1);
    expect(mock.requests).toHaveLength(4);
    expect(await slept(sleep.log)).toEqual(["1", "1", "1"]);
    expect(result.stdout).toContain(`${ERROR}Jules API returned HTTP 503`);
  }, 15_000);

  it("delete retries a curl timeout", async () => {
    // The shim's first curl invocation exits 28 without transferring; the
    // second runs the real curl.
    const sleep = await makeSleepShim();
    const curlShim = await makeCurlTimeoutShim();
    mock = await startMockJules(() => json(200, {}));
    const result = await runJules("delete", {
      ...deleteEnv(mock.baseUrl),
      PATH: `${sleep.dir}:${curlShim.dir}:${process.env.PATH ?? ""}`,
    });

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(mock.requests).toHaveLength(1);
    expect(await slept(sleep.log)).toEqual(["1"]);
  }, 15_000);
});
