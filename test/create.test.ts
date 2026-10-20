import { afterEach, describe, expect, it } from "vitest";
import {
  json,
  type MockJules,
  makeGitRepo,
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

describe("jules.sh create", () => {
  it("POSTs the session payload with the API key header", async () => {
    mock = await startMockJules();
    const result = await runJules("create", createEnv(mock.baseUrl));

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(mock.requests).toHaveLength(1);
    const [request] = mock.requests;
    expect(request.method).toBe("POST");
    expect(request.path).toBe("/v1alpha/sessions");
    expect(request.headers["x-goog-api-key"]).toBe("test-key");
    expect(request.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(request.body)).toEqual({
      prompt: "Fix the flaky test",
      sourceContext: {
        source: "sources/github/octo/repo",
        githubRepoContext: { startingBranch: "main" },
      },
      requirePlanApproval: false,
      automationMode: "AUTO_CREATE_PR",
    });
  });

  it("adds title only when one is given", async () => {
    mock = await startMockJules();
    const result = await runJules(
      "create",
      createEnv(mock.baseUrl, { JULES_TITLE: "Fix: login" }),
    );

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(JSON.parse(mock.requests[0].body).title).toBe("Fix: login");
  });

  it("sends requirePlanApproval true when asked", async () => {
    mock = await startMockJules();
    const result = await runJules(
      "create",
      createEnv(mock.baseUrl, { JULES_REQUIRE_PLAN_APPROVAL: "true" }),
    );

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(JSON.parse(mock.requests[0].body).requirePlanApproval).toBe(true);
  });

  it("keeps the prompt text literal, minus trailing newlines", async () => {
    mock = await startMockJules();
    const prompt = 'Say "hi" to $HOME\n\n  indented line — ünïcode\n\n';
    const result = await runJules(
      "create",
      createEnv(mock.baseUrl, { JULES_PROMPT: prompt }),
    );

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(JSON.parse(mock.requests[0].body).prompt).toBe(
      'Say "hi" to $HOME\n\n  indented line — ünïcode',
    );
  });

  it("appends the last commit only when include_last_commit is true", async () => {
    const repo = await makeGitRepo();
    mock = await startMockJules();
    const withCommit = await runJules(
      "create",
      createEnv(mock.baseUrl, { JULES_INCLUDE_LAST_COMMIT: "true" }),
      { cwd: repo },
    );
    const without = await runJules("create", createEnv(mock.baseUrl), {
      cwd: repo,
    });

    expect(withCommit.code, withCommit.stdout + withCommit.stderr).toBe(0);
    expect(without.code, without.stdout + without.stderr).toBe(0);
    const included = JSON.parse(mock.requests[0].body).prompt as string;
    expect(included).toContain(
      "Fix the flaky test\n\n\nContent of the latest commit (in the format of `git show`):\n```\ncommit ",
    );
    expect(included).toContain("+hello from the fixture commit");
    expect(JSON.parse(mock.requests[1].body).prompt).toBe("Fix the flaky test");
  });

  it("appends the commit log only when include_commit_log is true", async () => {
    const repo = await makeGitRepo();
    mock = await startMockJules();
    const result = await runJules(
      "create",
      createEnv(mock.baseUrl, { JULES_INCLUDE_COMMIT_LOG: "true" }),
      { cwd: repo },
    );

    expect(result.code, result.stdout + result.stderr).toBe(0);
    const prompt = JSON.parse(mock.requests[0].body).prompt as string;
    expect(prompt).toContain(
      "Log of the last 20 commits (in the format of `git log --stat`):",
    );
    expect(prompt).toContain("Add fixture file");
    expect(prompt).not.toContain("Content of the latest commit");
  });

  it("writes session_id, session_name and response outputs", async () => {
    mock = await startMockJules();
    const result = await runJules("create", createEnv(mock.baseUrl));

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(result.outputs.session_id).toBe(SESSION.id);
    expect(result.outputs.session_name).toBe(SESSION.name);
    expect(JSON.parse(result.outputs.response)).toEqual(SESSION);
  });

  it("fails with an error annotation on HTTP errors", async () => {
    mock = await startMockJules(() =>
      json(400, { error: { message: "bad prompt" } }),
    );
    const result = await runJules("create", createEnv(mock.baseUrl));

    expect(result.code).toBe(1);
    expect(result.stdout).toContain("::error::Jules API returned HTTP 400");
    expect(result.outputs.session_id).toBeUndefined();
  });

  it("keeps scratch files out of the working directory", async () => {
    const repo = await makeGitRepo();
    mock = await startMockJules();
    const result = await runJules("create", createEnv(mock.baseUrl), {
      cwd: repo,
    });

    expect(result.code, result.stdout + result.stderr).toBe(0);
    const { readdir } = await import("node:fs/promises");
    expect((await readdir(repo)).sort()).toEqual([".git", "fixture.txt"]);
  });
});

describe("jules.sh API base URL override", () => {
  it.each([
    "https://example.com/v1alpha",
    // userinfo: curl would read "localhost:1" as credentials and connect to example.com
    "http://localhost:1@example.com/v1alpha",
    "http://127.0.0.1:1@example.com/v1alpha",
    "https://jules.googleapis.com.example.com/v1alpha",
    "http://localhost/v1alpha",
  ])("validate and create refuse %s", async (baseUrl) => {
    const validate = await runJules("validate", {
      JULES_API_BASE_URL: baseUrl,
      JULES_MODE: "create",
      JULES_PROMPT: "p",
    });
    const create = await runJules("create", createEnv(baseUrl));

    expect(validate.code).toBe(1);
    expect(validate.stdout).toContain("::error::JULES_API_BASE_URL");
    expect(create.code).toBe(1);
    expect(create.stdout).toContain("::error::JULES_API_BASE_URL");
  });

  it.each([
    "https://jules.googleapis.com/v1alpha",
    "http://127.0.0.1:8787/v1alpha",
    "http://localhost:8787",
  ])("validate accepts %s", async (baseUrl) => {
    const result = await runJules("validate", {
      JULES_API_BASE_URL: baseUrl,
      JULES_MODE: "create",
      JULES_PROMPT: "p",
      JULES_API_KEY: "k",
    });

    expect(result.code, result.stdout + result.stderr).toBe(0);
  });
});
