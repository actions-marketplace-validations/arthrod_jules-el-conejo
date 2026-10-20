import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { REPO_ROOT } from "./helpers";

type Step = {
  name?: string;
  id?: string;
  if?: string;
  uses?: string;
  run?: string;
  shell?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
};

const action = parse(readFileSync(join(REPO_ROOT, "action.yaml"), "utf8")) as {
  inputs: Record<string, unknown>;
  outputs: Record<string, { value: string }>;
  runs: { using: string; steps: Step[] };
};
const steps = action.runs.steps;
const runSteps = steps.filter((step) => step.run !== undefined);

describe("action.yaml wiring", () => {
  it("is a composite action with run steps", () => {
    expect(action.runs.using).toBe("composite");
    expect(runSteps.length).toBeGreaterThan(0);
  });

  it.each(
    runSteps.map((step) => [step.name ?? step.id ?? "unnamed", step] as const),
  )(
    "step %s passes values through env, never expressions inside run",
    (_name, step) => {
      expect(step.run).not.toContain("${{");
    },
  );

  it.each(
    runSteps.map((step) => [step.name ?? step.id ?? "unnamed", step] as const),
  )("step %s only delegates to scripts/jules.sh", (_name, step) => {
    expect(step.run?.trim()).toMatch(
      /^bash "\$GITHUB_ACTION_PATH\/scripts\/jules\.sh" (validate|create|delete)$/,
    );
  });

  it.each(
    runSteps.map((step) => [step.name ?? step.id ?? "unnamed", step] as const),
  )("step %s runs under bash", (_name, step) => {
    expect(step.shell).toBe("bash");
  });

  it("keeps GitHub expressions out of scripts/jules.sh", () => {
    expect(
      readFileSync(join(REPO_ROOT, "scripts", "jules.sh"), "utf8"),
    ).not.toContain("${{");
  });

  it("pins every action it uses to a full commit SHA", () => {
    const uses = steps.flatMap((step) => (step.uses ? [step.uses] : []));
    expect(uses.length).toBeGreaterThan(0);
    for (const ref of uses)
      expect(ref).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
  });

  it("checks out without persisting credentials", () => {
    const checkout = steps.find((step) =>
      step.uses?.startsWith("actions/checkout@"),
    );
    expect(checkout).toBeDefined();
    expect(checkout?.with?.["persist-credentials"]).toBe(false);
  });

  it("passes the API key only through env", () => {
    const keyed = runSteps.filter(
      (step) => step.env?.JULES_API_KEY !== undefined,
    );
    expect(keyed.map((step) => step.env?.JULES_API_KEY)).toEqual(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub expression syntax
      keyed.map(() => "${{ inputs.jules_api_key }}"),
    );
    expect(keyed.length).toBeGreaterThanOrEqual(2);
  });
});

describe("action.yaml uses validated values", () => {
  const byId = (id: string) => steps.find((step) => step.id === id);

  it("gates checkout, create and delete on the normalized mode", () => {
    const checkout = steps.find((step) =>
      step.uses?.startsWith("actions/checkout@"),
    );
    expect(byId("validate")).toBeDefined();
    expect(checkout?.if).toContain("steps.validate.outputs.mode == 'create'");
    expect(byId("invoke")?.if).toContain(
      "steps.validate.outputs.mode == 'create'",
    );
    expect(byId("delete")?.if).toContain(
      "steps.validate.outputs.mode == 'delete'",
    );
  });

  it("feeds create the normalized booleans and automation mode", () => {
    const env = byId("invoke")?.env ?? {};
    expect(env.JULES_REQUIRE_PLAN_APPROVAL).toContain(
      "steps.validate.outputs.require_plan_approval",
    );
    expect(env.JULES_INCLUDE_LAST_COMMIT).toContain(
      "steps.validate.outputs.include_last_commit",
    );
    expect(env.JULES_INCLUDE_COMMIT_LOG).toContain(
      "steps.validate.outputs.include_commit_log",
    );
    expect(env.JULES_AUTOMATION_MODE).toContain(
      "steps.validate.outputs.automation_mode",
    );
  });
});

describe("action outputs", () => {
  const script = readFileSync(join(REPO_ROOT, "scripts", "jules.sh"), "utf8");

  it.each(Object.keys(action.outputs))(
    "output %s is written by scripts/jules.sh",
    (key) => {
      expect(script).toMatch(new RegExp(`echo "${key}(=|<<)`));
    },
  );
});
