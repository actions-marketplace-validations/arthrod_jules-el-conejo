import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  json,
  type MockJules,
  REPO_ROOT,
  runJules,
  SESSION,
  startMockJules,
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
  JULES_PROMPT: "Fix the flaky test",
  JULES_TITLE: "",
  JULES_STARTING_BRANCH: "main",
  JULES_REPOSITORY: "octo/repo",
  JULES_REQUIRE_PLAN_APPROVAL: "false",
  JULES_AUTOMATION_MODE: "AUTO_CREATE_PR",
  JULES_INCLUDE_LAST_COMMIT: "false",
  JULES_INCLUDE_COMMIT_LOG: "false",
  ...overrides,
});

const deleteEnv = (baseUrl: string, sessionId: string) => ({
  JULES_API_BASE_URL: baseUrl,
  JULES_API_KEY: "test-key",
  JULES_MODE: "delete",
  JULES_SESSION_ID: sessionId,
});

type ActionOutputs = Record<string, { description: string; value: string }>;

const action = parse(readFileSync(join(REPO_ROOT, "action.yaml"), "utf8")) as {
  outputs: ActionOutputs;
};

describe("jules.sh create outputs session_url", () => {
  it("writes session_url equal to the response url", async () => {
    mock = await startMockJules();
    const result = await runJules("create", createEnv(mock.baseUrl));

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(result.outputs.session_url).toBe(SESSION.url);
  });

  it("writes session_url as an empty string when the response has no url", async () => {
    mock = await startMockJules(() =>
      json(200, { name: "sessions/9", id: "9" }),
    );
    const result = await runJules("create", createEnv(mock.baseUrl));

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(result.outputs.session_url).toBe("");
  });
});

describe("jules.sh delete outputs", () => {
  it("writes session_id and session_name for a bare session id", async () => {
    mock = await startMockJules(() => json(200, {}));
    const result = await runJules(
      "delete",
      deleteEnv(mock.baseUrl, "16871897978654894041"),
    );

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(result.outputs.session_id).toBe("16871897978654894041");
    expect(result.outputs.session_name).toBe("sessions/16871897978654894041");
  });

  it("writes session_id and session_name when given a sessions/<id> input", async () => {
    mock = await startMockJules(() => json(200, {}));
    const result = await runJules(
      "delete",
      deleteEnv(mock.baseUrl, "sessions/77"),
    );

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(result.outputs.session_id).toBe("77");
    expect(result.outputs.session_name).toBe("sessions/77");
  });
});

const responseHeredocDelim = (raw: string): string | undefined => {
  const line = raw.split("\n").find((entry) => entry.startsWith("response<<"));
  if (!line) return undefined;
  return line.slice("response<<".length);
};

describe("jules.sh response output uses a random heredoc delimiter", () => {
  it("does not use the hardcoded JULES_EOF delimiter", async () => {
    mock = await startMockJules();
    const result = await runJules("create", createEnv(mock.baseUrl));

    expect(result.code, result.stdout + result.stderr).toBe(0);
    const raw = await readFile(
      join(result.runnerTemp, "github_output"),
      "utf8",
    );
    const delim = responseHeredocDelim(raw);
    expect(delim, `raw output: ${raw}`).toBeDefined();
    expect(delim).not.toBe("JULES_EOF");
    expect(delim).toMatch(/^[A-Za-z0-9_]{16,}$/);
  });

  it("uses a different delimiter on each create run", async () => {
    mock = await startMockJules();
    const first = await runJules("create", createEnv(mock.baseUrl));
    const second = await runJules("create", createEnv(mock.baseUrl));

    expect(first.code, first.stdout + first.stderr).toBe(0);
    expect(second.code, second.stdout + second.stderr).toBe(0);
    const raw1 = await readFile(
      join(first.runnerTemp, "github_output"),
      "utf8",
    );
    const raw2 = await readFile(
      join(second.runnerTemp, "github_output"),
      "utf8",
    );
    const d1 = responseHeredocDelim(raw1);
    const d2 = responseHeredocDelim(raw2);
    expect(d1).toBeDefined();
    expect(d2).toBeDefined();
    expect(d1).not.toBe(d2);
  });

  it("still parses the response output as the original SESSION JSON", async () => {
    // already true
    mock = await startMockJules();
    const result = await runJules("create", createEnv(mock.baseUrl));

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(JSON.parse(result.outputs.response)).toEqual(SESSION);
  });
});

describe("action.yaml outputs wiring", () => {
  it("exposes session_url that references steps.invoke.outputs.session_url", () => {
    expect(action.outputs.session_url?.value).toContain(
      "steps.invoke.outputs.session_url",
    );
  });

  it("exposes session_id that references BOTH invoke and delete steps", () => {
    const value = action.outputs.session_id?.value ?? "";
    expect(value).toContain("steps.invoke.outputs.session_id");
    expect(value).toContain("steps.delete.outputs.session_id");
  });

  it("exposes session_name that references BOTH invoke and delete steps", () => {
    const value = action.outputs.session_name?.value ?? "";
    expect(value).toContain("steps.invoke.outputs.session_name");
    expect(value).toContain("steps.delete.outputs.session_name");
  });

  it("exposes response that references steps.invoke.outputs.response", () => {
    // already true
    expect(action.outputs.response?.value).toContain(
      "steps.invoke.outputs.response",
    );
  });

  it("has a non-empty description for every output", () => {
    // already true (for the outputs that exist today)
    for (const [name, output] of Object.entries(action.outputs)) {
      expect(output.description, `description for output ${name}`).toBeTruthy();
    }
  });
});

describe("every action output is written to GITHUB_OUTPUT by its step", () => {
  const refs = Object.entries(action.outputs).flatMap(([name, output]) =>
    [...output.value.matchAll(/steps\.(\w+)\.outputs\.(\w+)/g)].map(
      ([, step, key]) => ({ name, step, key }),
    ),
  );
  const runStep: Record<string, () => Promise<Record<string, string>>> = {
    invoke: async () => {
      mock = await startMockJules();
      return (await runJules("create", createEnv(mock.baseUrl))).outputs;
    },
    delete: async () => {
      mock = await startMockJules(() => json(200, {}));
      return (await runJules("delete", deleteEnv(mock.baseUrl, "77"))).outputs;
    },
  };

  it("reads only steps this test can run", () => {
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(Object.keys(runStep), `${ref.name} reads ${ref.step}`).toContain(
        ref.step,
      );
    }
  });

  it.each(refs.map((ref) => [ref.name, ref.step, ref.key]))(
    "output %s: step %s writes %s",
    async (_name, step, key) => {
      const outputs = await runStep[step]();

      expect(outputs).toHaveProperty(key);
    },
  );
});

describe("jules.sh create payload title", () => {
  it("omits the title key when JULES_TITLE is empty", async () => {
    // already true
    mock = await startMockJules();
    const result = await runJules("create", createEnv(mock.baseUrl));

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(JSON.parse(mock.requests[0].body)).not.toHaveProperty("title");
  });

  it("sets title to the given value when JULES_TITLE is set", async () => {
    // already true
    mock = await startMockJules();
    const result = await runJules(
      "create",
      createEnv(mock.baseUrl, { JULES_TITLE: "T" }),
    );

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(JSON.parse(mock.requests[0].body).title).toBe("T");
  });
});
