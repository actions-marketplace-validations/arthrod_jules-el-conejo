import { execSync } from "node:child_process";
import { chmod, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ERROR,
  json,
  type MockJules,
  makeScratchDir,
  runJules,
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

const deleteEnv = (baseUrl: string) => ({
  JULES_API_BASE_URL: baseUrl,
  JULES_API_KEY: "test-key",
  JULES_MODE: "delete",
  JULES_SESSION_ID: "16871897978654894041",
});

const redirect = () => ({
  status: 302,
  body: "",
  headers: { location: "https://jules.example/elsewhere" },
});

/** Builds a curl shim that logs its argv, one argument per line. */
const makeCurlShim = async (): Promise<{ dir: string; log: string }> => {
  const dir = await makeScratchDir("jules-curlshim-");
  const log = join(dir, "argv.log");
  const realCurl = execSync("command -v curl", { encoding: "utf8" }).trim();
  const shim = join(dir, "curl");
  await writeFile(
    shim,
    [
      "#!/usr/bin/env bash",
      `printf '%s\\n' "$@" >> ${JSON.stringify(log)}`,
      `exec ${JSON.stringify(realCurl)} "$@"`,
      "",
    ].join("\n"),
  );
  await chmod(shim, 0o755);
  return { dir, log };
};

describe("jules.sh HTTP handling", () => {
  describe("non-2xx statuses fail both commands", () => {
    it("create fails on HTTP 302 with an error annotation", async () => {
      mock = await startMockJules(redirect);
      const result = await runJules("create", createEnv(mock.baseUrl));

      expect(result.code).toBe(1);
      expect(result.stdout).toContain(`${ERROR}Jules API returned HTTP 302`);
    });

    it("delete fails on HTTP 302 with an error annotation", async () => {
      mock = await startMockJules(redirect);
      const result = await runJules("delete", deleteEnv(mock.baseUrl));

      expect(result.code).toBe(1);
      expect(result.stdout).toContain(`${ERROR}Jules API returned HTTP 302`);
    });

    it("create fails on HTTP 400 with an error annotation", async () => {
      // already true
      mock = await startMockJules(() =>
        json(400, { error: { message: "bad prompt" } }),
      );
      const result = await runJules("create", createEnv(mock.baseUrl));

      expect(result.code).toBe(1);
      expect(result.stdout).toContain(`${ERROR}Jules API returned HTTP 400`);
    });

    it("delete fails on HTTP 403 with an error annotation", async () => {
      // already true
      mock = await startMockJules(() =>
        json(403, { error: { message: "forbidden" } }),
      );
      const result = await runJules("delete", deleteEnv(mock.baseUrl));

      expect(result.code).toBe(1);
      expect(result.stdout).toContain(`${ERROR}Jules API returned HTTP 403`);
    });
  });

  it("delete treats HTTP 404 as already deleted", async () => {
    mock = await startMockJules(() =>
      json(404, { error: { message: "not found" } }),
    );
    const result = await runJules("delete", deleteEnv(mock.baseUrl));

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain(
      `${WARNING}Jules session sessions/16871897978654894041 was not found; treating it as already deleted`,
    );
  });

  it("create bounds the error annotation when the body is huge", async () => {
    mock = await startMockJules(() => ({
      status: 400,
      body: "x".repeat(5000),
    }));
    const result = await runJules("create", createEnv(mock.baseUrl));

    expect(result.code).toBe(1);
    const errorLine = result.stdout
      .split("\n")
      .find((line) => line.startsWith(ERROR));
    expect(errorLine).toBeDefined();
    expect(errorLine?.length).toBeLessThanOrEqual(1200);
  });

  it("create fails on a 200 response that is not JSON", async () => {
    mock = await startMockJules(() => ({
      status: 200,
      body: "<html>oops</html>",
      headers: { "content-type": "text/html" },
    }));
    const result = await runJules("create", createEnv(mock.baseUrl));

    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      `${ERROR}Jules API returned a response that is not a JSON object`,
    );
  });

  it("create calls a JSON null body what it is: not an object", async () => {
    mock = await startMockJules(() => ({ status: 200, body: "null" }));
    const result = await runJules("create", createEnv(mock.baseUrl));

    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      `${ERROR}Jules API returned a response that is not a JSON object: null`,
    );
  });

  describe("create requires a session name in the response", () => {
    it("fails on HTTP 204 with an empty body", async () => {
      mock = await startMockJules(() => ({ status: 204, body: "" }));
      const result = await runJules("create", createEnv(mock.baseUrl));

      expect(result.code).toBe(1);
      expect(result.stdout).toContain(
        `${ERROR}Jules API response did not include a session name`,
      );
      expect(result.outputs.session_id).toBeUndefined();
    });

    it("fails on HTTP 200 with an empty JSON object", async () => {
      mock = await startMockJules(() => json(200, {}));
      const result = await runJules("create", createEnv(mock.baseUrl));

      expect(result.code).toBe(1);
      expect(result.stdout).toContain(
        `${ERROR}Jules API response did not include a session name`,
      );
      expect(result.outputs.session_id).toBeUndefined();
    });
  });

  it("create derives session_id from the name when id is missing", async () => {
    mock = await startMockJules(() => json(200, { name: "sessions/555" }));
    const result = await runJules("create", createEnv(mock.baseUrl));

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(result.outputs.session_id).toBe("555");
    expect(result.outputs.session_name).toBe("sessions/555");
  });

  it("create falls back to the name when id is empty", async () => {
    mock = await startMockJules(() =>
      json(200, { name: "sessions/555", id: "" }),
    );
    const result = await runJules("create", createEnv(mock.baseUrl));

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(result.outputs.session_id).toBe("555");
    expect(result.outputs.session_name).toBe("sessions/555");
  });

  it("create never retries HTTP 503", async () => {
    // already true: no retry logic exists yet; guards the delete-retry work
    mock = await startMockJules(() =>
      json(503, { error: { message: "unavailable" } }),
    );
    const result = await runJules("create", createEnv(mock.baseUrl));

    expect(result.code).toBe(1);
    expect(result.stdout).toContain(`${ERROR}Jules API returned HTTP 503`);
    expect(mock.requests).toHaveLength(1);
  }, 15_000);

  it("delete retries a transient 503 and succeeds", async () => {
    let calls = 0;
    mock = await startMockJules(() => {
      calls += 1;
      return calls === 1 ? json(503, {}) : json(200, {});
    });
    const result = await runJules("delete", deleteEnv(mock.baseUrl));

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(mock.requests).toHaveLength(2);
  }, 15_000);

  describe("transport failures", () => {
    it("create reports an unreachable API", async () => {
      const dead = await startMockJules();
      const baseUrl = dead.baseUrl;
      await dead.close();
      const result = await runJules("create", createEnv(baseUrl));

      expect(result.code).toBe(1);
      expect(result.stdout).toContain(`${ERROR}Could not reach the Jules API`);
    }, 15_000);

    it("create says a session may exist when the reply is lost", async () => {
      const methods: string[] = [];
      const server = createServer((req, res) => {
        methods.push(req.method ?? "");
        req.resume();
        req.on("end", () => res.socket?.destroy());
      });
      await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
      const { port } = server.address() as AddressInfo;
      try {
        const result = await runJules(
          "create",
          createEnv(`http://127.0.0.1:${port}/v1alpha`),
        );

        expect(result.code).toBe(1);
        expect(result.stdout).toContain(
          `${ERROR}The Jules API request failed (curl exit 52) and may already have reached Jules`,
        );
        expect(methods).toEqual(["POST"]);
      } finally {
        await new Promise((done) => server.close(done));
      }
    }, 15_000);

    it("delete reports an unreachable API", async () => {
      const dead = await startMockJules();
      const baseUrl = dead.baseUrl;
      await dead.close();
      const result = await runJules("delete", deleteEnv(baseUrl));

      expect(result.code).toBe(1);
      expect(result.stdout).toContain(`${ERROR}Could not reach the Jules API`);
    }, 15_000);
  });

  describe("the API key stays out of curl's command line", () => {
    it("create still authenticates without the key in argv", async () => {
      const shim = await makeCurlShim();
      mock = await startMockJules();
      const result = await runJules(
        "create",
        createEnv(mock.baseUrl, {
          PATH: `${shim.dir}:${process.env.PATH ?? ""}`,
        }),
      );

      expect(result.code, result.stdout + result.stderr).toBe(0);
      const argv = await readFile(shim.log, "utf8");
      expect(argv).not.toContain("test-key");
      expect(mock.requests[0].headers["x-goog-api-key"]).toBe("test-key");
    });

    it("delete still authenticates without the key in argv", async () => {
      const shim = await makeCurlShim();
      mock = await startMockJules(() => json(200, {}));
      const result = await runJules("delete", {
        ...deleteEnv(mock.baseUrl),
        PATH: `${shim.dir}:${process.env.PATH ?? ""}`,
      });

      expect(result.code, result.stdout + result.stderr).toBe(0);
      const argv = await readFile(shim.log, "utf8");
      expect(argv).not.toContain("test-key");
      expect(mock.requests[0].headers["x-goog-api-key"]).toBe("test-key");
    });
  });
});

describe("jules.sh scratch files", () => {
  // BASH_ENV runs inside the script's own process before the script, so $$
  // there is the script's PID and the old guessable paths can be planted.
  const plantSymlinks = async (names: string[]) => {
    const dir = await makeScratchDir("jules-plant-");
    const lines = names.map(
      (name) =>
        `ln -s ${JSON.stringify(join(dir, name))} "$RUNNER_TEMP/${name}"`,
    );
    const plant = join(dir, "plant.sh");
    await writeFile(plant, `${lines.join("\n")}\n`);
    return { dir, plant };
  };

  it("does not follow symlinks planted at guessable scratch paths", async () => {
    mock = await startMockJules();
    const names = [
      "jules_api_key_header.$$",
      "jules_prompt.txt",
      "jules_payload.json",
    ];
    const { dir, plant } = await plantSymlinks(names);
    const result = await runJules("create", {
      ...createEnv(mock.baseUrl),
      BASH_ENV: plant,
    });

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(mock.requests[0].headers["x-goog-api-key"]).toBe("test-key");
    const written = (await readdir(dir)).filter((name) => name !== "plant.sh");
    expect(written).toEqual([]);
  });

  it("removes its scratch files when it exits", async () => {
    mock = await startMockJules();
    const result = await runJules("create", createEnv(mock.baseUrl));

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(await readdir(result.runnerTemp)).toEqual(["github_output"]);
  });
});
