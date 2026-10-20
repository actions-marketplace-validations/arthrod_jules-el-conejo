import { afterEach, describe, expect, it } from "vitest";
import { type MockJules, runJules, startMockJules } from "./helpers";

let mock: MockJules | undefined;
afterEach(async () => {
  await mock?.close();
  mock = undefined;
});

const validCreate = (overrides: Record<string, string> = {}) => ({
  JULES_MODE: "create",
  JULES_PROMPT: "do it",
  JULES_API_KEY: "test-key",
  JULES_REQUIRE_PLAN_APPROVAL: "false",
  JULES_INCLUDE_LAST_COMMIT: "false",
  JULES_INCLUDE_COMMIT_LOG: "false",
  JULES_AUTOMATION_MODE: "AUTO_CREATE_PR",
  ...overrides,
});

const validDelete = (overrides: Record<string, string> = {}) => ({
  JULES_MODE: "delete",
  JULES_SESSION_ID: "16871897978654894041",
  JULES_API_KEY: "test-key",
  ...overrides,
});

describe("validate: mode", () => {
  it.each([
    ["create", "create"],
    ["Create", "create"],
    ["CREATE", "create"],
  ])("normalizes %s to %s", async (mode, expected) => {
    const result = await runJules(
      "validate",
      validCreate({ JULES_MODE: mode }),
    );

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(result.outputs.mode).toBe(expected);
  });

  it.each([
    ["delete", "delete"],
    ["DELETE", "delete"],
  ])("normalizes %s to %s", async (mode, expected) => {
    const result = await runJules(
      "validate",
      validDelete({ JULES_MODE: mode }),
    );

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(result.outputs.mode).toBe(expected);
  });

  it("applies delete rules to DELETE (session_id still required)", async () => {
    const result = await runJules(
      "validate",
      validDelete({ JULES_MODE: "DELETE", JULES_SESSION_ID: "" }),
    );

    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      "::error::session_id is required for delete mode",
    );
  });

  it.each(["delet", "remove", ""])("rejects mode %j", async (mode) => {
    const result = await runJules(
      "validate",
      validCreate({ JULES_MODE: mode }),
    );

    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      `::error::mode must be "create" or "delete", got: ${mode}`,
    );
    expect(result.outputs.mode).toBeUndefined();
  });
});

describe("validate: booleans fail closed", () => {
  it.each([
    ["require_plan_approval", "JULES_REQUIRE_PLAN_APPROVAL", "yes"],
    ["require_plan_approval", "JULES_REQUIRE_PLAN_APPROVAL", "1"],
    ["require_plan_approval", "JULES_REQUIRE_PLAN_APPROVAL", "on"],
    ["include_last_commit", "JULES_INCLUDE_LAST_COMMIT", "yes"],
    ["include_commit_log", "JULES_INCLUDE_COMMIT_LOG", "yes"],
  ])("rejects %s (%s=%s)", async (name, envName, value) => {
    const result = await runJules(
      "validate",
      validCreate({ [envName]: value }),
    );

    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      `::error::${name} must be true or false, got: ${value}`,
    );
  });

  it.each([
    ["TRUE", "true"],
    ["True", "true"],
    ["true", "true"],
    ["False", "false"],
    ["false", "false"],
    ["", "false"],
  ])("normalizes %j to %s", async (value, expected) => {
    const result = await runJules(
      "validate",
      validCreate({
        JULES_REQUIRE_PLAN_APPROVAL: value,
        JULES_INCLUDE_LAST_COMMIT: value,
        JULES_INCLUDE_COMMIT_LOG: value,
      }),
    );

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(result.outputs.require_plan_approval).toBe(expected);
    expect(result.outputs.include_last_commit).toBe(expected);
    expect(result.outputs.include_commit_log).toBe(expected);
  });

  it("treats unset booleans as false", async () => {
    const result = await runJules("validate", {
      JULES_MODE: "create",
      JULES_PROMPT: "do it",
      JULES_API_KEY: "test-key",
    });

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(result.outputs.require_plan_approval).toBe("false");
    expect(result.outputs.include_last_commit).toBe("false");
    expect(result.outputs.include_commit_log).toBe("false");
    expect(result.outputs.automation_mode).toBe("AUTO_CREATE_PR");
  });
});

describe("validate: automation_mode", () => {
  it.each(["auto_create_pr", "AUTO CREATE", "1PR"])(
    "rejects %j",
    async (value) => {
      const result = await runJules(
        "validate",
        validCreate({ JULES_AUTOMATION_MODE: value }),
      );

      expect(result.code).toBe(1);
      expect(result.stdout).toContain(
        `::error::automation_mode must be an AutomationMode name such as AUTO_CREATE_PR or AUTOMATION_MODE_UNSPECIFIED, got: ${value}`,
      );
    },
  );

  it.each([
    ["AUTO_CREATE_PR", "AUTO_CREATE_PR"],
    ["AUTOMATION_MODE_UNSPECIFIED", "AUTOMATION_MODE_UNSPECIFIED"],
    ["SOME_FUTURE_MODE", "SOME_FUTURE_MODE"],
    ["", "AUTO_CREATE_PR"],
  ])("accepts %j as %s", async (value, expected) => {
    const result = await runJules(
      "validate",
      validCreate({ JULES_AUTOMATION_MODE: value }),
    );

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(result.outputs.automation_mode).toBe(expected);
  });
});

describe("validate: session_id in delete mode", () => {
  it.each(["sessions/1/2", "12 34", "abc.def", "123?x"])(
    "rejects %j",
    async (value) => {
      const result = await runJules(
        "validate",
        validDelete({ JULES_SESSION_ID: value }),
      );

      expect(result.code).toBe(1);
      expect(result.stdout).toContain(
        `::error::session_id must look like 1234567890 or sessions/1234567890, got: ${value}`,
      );
    },
  );

  it.each([
    ["123", "123"],
    ["sessions/123", "123"],
    ["abc_DEF-9", "abc_DEF-9"],
  ])("accepts %s", async (value, id) => {
    const result = await runJules(
      "validate",
      validDelete({ JULES_SESSION_ID: value }),
    );

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(result.outputs.session_id).toBe(id);
    expect(result.outputs.session_name).toBe(`sessions/${id}`);
  });
});

describe("validate: API key", () => {
  it.each([
    ["create", validCreate({ JULES_API_KEY: "" })],
    ["delete", validDelete({ JULES_API_KEY: "" })],
  ])("requires jules_api_key in %s mode", async (_mode, env) => {
    const result = await runJules("validate", env);

    expect(result.code).toBe(1);
    expect(result.stdout).toContain("::error::jules_api_key is required");
  });
});

describe("create applies the same boolean rules", () => {
  const createEnv = (baseUrl: string, overrides: Record<string, string>) => ({
    ...validCreate(overrides),
    JULES_API_BASE_URL: baseUrl,
    JULES_STARTING_BRANCH: "main",
    JULES_REPOSITORY: "octo/repo",
    JULES_TITLE: "",
  });

  it("sends requirePlanApproval true for TRUE", async () => {
    mock = await startMockJules();
    const result = await runJules(
      "create",
      createEnv(mock.baseUrl, { JULES_REQUIRE_PLAN_APPROVAL: "TRUE" }),
    );

    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(JSON.parse(mock.requests[0].body).requirePlanApproval).toBe(true);
  });

  it("refuses yes before sending anything", async () => {
    mock = await startMockJules();
    const result = await runJules(
      "create",
      createEnv(mock.baseUrl, { JULES_REQUIRE_PLAN_APPROVAL: "yes" }),
    );

    expect(result.code).toBe(1);
    expect(result.stdout).toContain(
      "::error::require_plan_approval must be true or false, got: yes",
    );
    expect(mock.requests).toHaveLength(0);
  });
});
