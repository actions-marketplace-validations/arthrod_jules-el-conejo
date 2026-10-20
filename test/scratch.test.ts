import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import config from "../vitest.config";
import { makeGitRepo, removeScratchDirs, runJules } from "./helpers";

describe("test scratch directories", () => {
  it("removeScratchDirs deletes runner temp dirs and fixture repos", async () => {
    const result = await runJules("validate", {
      JULES_MODE: "create",
      JULES_PROMPT: "p",
      JULES_API_KEY: "k",
    });
    const repo = await makeGitRepo();
    expect(existsSync(result.runnerTemp)).toBe(true);
    expect(existsSync(repo)).toBe(true);

    await removeScratchDirs();

    expect(existsSync(result.runnerTemp)).toBe(false);
    expect(existsSync(repo)).toBe(false);
  });

  it("runs removeScratchDirs after every test file", () => {
    expect(config.test?.setupFiles).toContain("test/setup.ts");
  });
});
