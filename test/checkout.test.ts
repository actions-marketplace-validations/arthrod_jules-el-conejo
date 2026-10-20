import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type MockJules,
  makeGitRepo,
  makeScratchDir,
  runJules,
  startMockJules,
} from "./helpers";

let mock: MockJules | undefined;
afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

const CHECKOUT_DIR = ".jules-action-checkout";

const createEnv = (overrides: Record<string, string> = {}) => ({
  JULES_MODE: "create",
  JULES_PROMPT: "Fix the flaky test",
  JULES_API_KEY: "test-key",
  JULES_INCLUDE_LAST_COMMIT: "false",
  JULES_INCLUDE_COMMIT_LOG: "false",
  ...overrides,
});

describe("validate decides whether the action needs its own checkout", () => {
  it.each(["JULES_INCLUDE_LAST_COMMIT", "JULES_INCLUDE_COMMIT_LOG"])(
    "checks out into its own directory when %s is true and cwd is not a repo",
    async (flag) => {
      const cwd = await makeScratchDir("jules-workspace-");
      const result = await runJules("validate", createEnv({ [flag]: "true" }), {
        cwd,
      });

      expect(result.code, result.stdout + result.stderr).toBe(0);
      expect(result.outputs.needs_checkout).toBe("true");
      expect(result.outputs.git_context_dir).toBe(CHECKOUT_DIR);
    },
  );

  it("uses the caller's checkout when cwd is already a repo", async () => {
    const repo = await makeGitRepo();
    const result = await runJules(
      "validate",
      createEnv({
        JULES_INCLUDE_LAST_COMMIT: "true",
        JULES_INCLUDE_COMMIT_LOG: "true",
      }),
      { cwd: repo },
    );

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(result.outputs.needs_checkout).toBe("false");
    expect(result.outputs.git_context_dir).toBe(".");
  });

  it("does not check out when no git context is requested", async () => {
    const cwd = await makeScratchDir("jules-workspace-");
    const result = await runJules("validate", createEnv(), { cwd });

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(result.outputs.needs_checkout).toBe("false");
  });

  it("does not check out in delete mode", async () => {
    const cwd = await makeScratchDir("jules-workspace-");
    const result = await runJules(
      "validate",
      {
        JULES_MODE: "delete",
        JULES_SESSION_ID: "123",
        JULES_API_KEY: "test-key",
        JULES_INCLUDE_LAST_COMMIT: "true",
      },
      { cwd },
    );

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(result.outputs.needs_checkout).toBe("false");
  });
});

describe("create reads git context from JULES_GIT_CONTEXT_DIR", () => {
  it("runs git show in the given directory", async () => {
    const repo = await makeGitRepo();
    mock = await startMockJules();
    const result = await runJules(
      "create",
      {
        ...createEnv({ JULES_INCLUDE_LAST_COMMIT: "true" }),
        JULES_API_BASE_URL: mock.baseUrl,
        JULES_STARTING_BRANCH: "main",
        JULES_REPOSITORY: "octo/repo",
        JULES_GIT_CONTEXT_DIR: basename(repo),
      },
      { cwd: dirname(repo) },
    );

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(JSON.parse(mock.requests[0].body).prompt).toContain(
      "+hello from the fixture commit",
    );
  });
});

describe("cleanup", () => {
  const workspace = async () => {
    const dir = await makeScratchDir("jules-workspace-");
    await mkdir(join(dir, CHECKOUT_DIR, ".git"), { recursive: true });
    await writeFile(join(dir, "keep.txt"), "caller file\n");
    return dir;
  };

  it("removes the action's own checkout and nothing else", async () => {
    const dir = await workspace();
    const result = await runJules(
      "cleanup",
      { JULES_GIT_CONTEXT_DIR: CHECKOUT_DIR },
      { cwd: dir },
    );

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(existsSync(join(dir, CHECKOUT_DIR))).toBe(false);
    expect(existsSync(join(dir, "keep.txt"))).toBe(true);
  });

  it.each([".", "", "keep.txt", `../${CHECKOUT_DIR}`])(
    "removes nothing when the context dir is %j",
    async (contextDir) => {
      const dir = await workspace();
      const result = await runJules(
        "cleanup",
        { JULES_GIT_CONTEXT_DIR: contextDir },
        { cwd: dir },
      );

      expect(result.code, result.stdout + result.stderr).toBe(0);
      expect(existsSync(join(dir, CHECKOUT_DIR))).toBe(true);
      expect(existsSync(join(dir, "keep.txt"))).toBe(true);
    },
  );
});
