import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { REPO_ROOT } from "./helpers";

type Step = {
  id?: string;
  if?: string;
  uses?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
};

type Job = {
  if?: string;
  env?: Record<string, string>;
  permissions?: Record<string, string>;
  steps: Step[];
};

type Workflow = { jobs: Record<string, Job> };

const readWorkflow = (file: string): Workflow =>
  parse(readFileSync(join(REPO_ROOT, "examples", file), "utf8")) as Workflow;

const findStep = (
  job: Job,
  matches: (step: Step) => boolean,
  what: string,
): Step => {
  const step = job.steps.find(matches);
  if (step === undefined) {
    throw new Error(`expected a step that ${what}`);
  }
  return step;
};

const cleanupWorkflow = readWorkflow("session-cleanup-on-merge.yml");
const cleanupJob = cleanupWorkflow.jobs["cleanup-session"];
if (cleanupJob === undefined) {
  throw new Error("session-cleanup-on-merge.yml must define cleanup-session");
}

const fixerWorkflow = readWorkflow("autonomous-bug-fixer.yml");
const fixerJob = fixerWorkflow.jobs["fix-bug"];
if (fixerJob === undefined) {
  throw new Error("autonomous-bug-fixer.yml must define job fix-bug");
}

const extractScript = findStep(
  cleanupJob,
  (step) => step.id === "extract",
  "has id extract",
).with?.script;
if (typeof extractScript !== "string") {
  throw new Error("the extract step must define with.script");
}

/** Runs the extract step's github-script against a fake pull request body. */
const runExtract = async (
  body: string | undefined,
): Promise<Record<string, string>> => {
  const outputs: Record<string, string> = {};
  const context = { payload: { pull_request: { body } } };
  const core = {
    setOutput(key: string, value: string) {
      outputs[key] = value;
    },
  };
  const silentConsole = { log: () => {} };
  const evaluate = new Function("context", "core", "console", extractScript);
  await evaluate(context, core, silentConsole);
  return outputs;
};

const julesActionStep = (job: Job): Step =>
  findStep(
    job,
    (step) => step.uses?.includes("jules-el-conejo") ?? false,
    "uses arthrod/jules-el-conejo",
  );

describe("examples/session-cleanup-on-merge.yml", () => {
  describe("extract step script", () => {
    it("extracts the session id from the Jules task footer", async () => {
      const outputs = await runExtract(
        "The fix is ready for review.\n\n*PR created automatically by Jules for task [16871897978654894041](https://jules.google.com/task/16871897978654894041) started by @someone*",
      );

      expect(outputs.found).toBe("true");
      expect(outputs.session_id).toBe("16871897978654894041");
    });

    it("ignores Jules links that are only mentioned in the PR text", async () => {
      // Deletion is permanent, so only Jules's own footer may pick the session.
      const outputs = await runExtract(
        "Follow-up to https://jules.google.com/session/123456789 and https://jules.google.com/task/987654321.",
      );

      expect(outputs.found).toBe("false");
      expect(outputs.session_id).toBeUndefined();
    });

    it("takes the session from the footer, not from other links", async () => {
      const outputs = await runExtract(
        "Builds on https://jules.google.com/task/111.\n\n*PR created automatically by Jules for task [16871897978654894041](https://jules.google.com/task/16871897978654894041) started by @someone*",
      );

      expect(outputs.found).toBe("true");
      expect(outputs.session_id).toBe("16871897978654894041");
    });

    it("rejects a footer whose link and label disagree", async () => {
      const outputs = await runExtract(
        "*PR created automatically by Jules for task [111](https://jules.google.com/task/222) started by @someone*",
      );

      expect(outputs.found).toBe("false");
    });

    it("does not mistake ses_ substrings inside words for sessions", async () => {
      const outputs = await runExtract(
        "This change uses_cache and processes_items.",
      );

      expect(outputs.found).toBe("false");
      expect(outputs.session_id).toBeUndefined();
    });

    it("reports found=false for empty and undefined bodies", async () => {
      // already true: the script defaults a missing body to "" and finds nothing.
      for (const body of ["", undefined]) {
        const outputs = await runExtract(body);

        expect(outputs.found).toBe("false");
      }
    });
  });

  it("runs cleanup only for merged PRs from the same repository", () => {
    expect(cleanupJob.if).toContain("github.event.pull_request.merged == true");
    expect(cleanupJob.if).toContain(
      "github.event.pull_request.head.repo.full_name == github.repository",
    );
  });

  it("deletes the session through arthrod/jules-el-conejo", () => {
    expect(julesActionStep(cleanupJob).uses).toContain(
      "arthrod/jules-el-conejo@",
    );
  });

  it("passes mode: delete to the delete step", () => {
    // already true: the delete step already sets mode: delete.
    expect(julesActionStep(cleanupJob).with?.mode).toBe("delete");
  });
});

describe("examples/autonomous-bug-fixer.yml", () => {
  it("grants write permission on issues", () => {
    expect(fixerJob.permissions?.issues).toBe("write");
  });

  it("gates the Jules step on both the issue author and the sender", () => {
    const julesStep = findStep(
      fixerJob,
      (step) => step.id === "jules",
      "has id jules",
    );

    // Exact match: turning && into || or dropping a contains() must fail here.
    expect(julesStep.if).toBe(
      "contains(fromJSON(env.TRUSTED_USERS), github.event.issue.user.login) && contains(fromJSON(env.TRUSTED_USERS), github.event.sender.login)",
    );
  });

  it("declares TRUSTED_USERS as a JSON list of logins", () => {
    const users = JSON.parse(fixerJob.env?.TRUSTED_USERS ?? "null");

    expect(Array.isArray(users)).toBe(true);
    expect(users.length).toBeGreaterThan(0);
    for (const user of users) {
      expect(typeof user).toBe("string");
    }
  });

  it("invokes arthrod/jules-el-conejo", () => {
    const julesStep = findStep(
      fixerJob,
      (step) => step.id === "jules",
      "has id jules",
    );

    expect(julesStep.uses).toContain("arthrod/jules-el-conejo@");
  });

  it("feeds the comment step the session URL through env", () => {
    const commentStep = findStep(
      fixerJob,
      (step) => step.uses?.startsWith("actions/github-script@") ?? false,
      "uses actions/github-script",
    );

    expect(commentStep.env?.SESSION_URL).toBe(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub expression syntax
      "${{ steps.jules.outputs.session_url }}",
    );
  });

  it("reads the session URL from env in the comment script, not expressions", () => {
    const commentStep = findStep(
      fixerJob,
      (step) => step.uses?.startsWith("actions/github-script@") ?? false,
      "uses actions/github-script",
    );
    const script = commentStep.with?.script;
    if (typeof script !== "string") {
      throw new Error("the comment step must define with.script");
    }

    expect(script).toContain("process.env.SESSION_URL");
    expect(script).not.toContain("${{");
  });
});

describe("shipped docs and examples", () => {
  const files = [
    "README.md",
    "action.yaml",
    "examples/README.md",
    ...readdirSync(join(REPO_ROOT, "examples"))
      .filter((file) => file.endsWith(".yml"))
      .map((file) => join("examples", file))
      .sort(),
  ];

  it("mentions neither nq-rdl/ nor ses_abc123", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(join(REPO_ROOT, file), "utf8");
      for (const banned of ["nq-rdl/", "ses_abc123"]) {
        if (text.includes(banned)) {
          offenders.push(`${file} contains ${banned}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("examples/README.md lists the bug fixer and session cleanup examples", () => {
    const text = readFileSync(join(REPO_ROOT, "examples", "README.md"), "utf8");

    expect(text).toContain("autonomous-bug-fixer.yml");
    expect(text).toContain("session-cleanup-on-merge.yml");
  });

  it("README.md documents session_url in the outputs table", () => {
    const lines = readFileSync(join(REPO_ROOT, "README.md"), "utf8").split(
      "\n",
    );
    const start = lines.findIndex(
      (line) => line.startsWith("## ") && line.includes("Outputs"),
    );
    if (start === -1) {
      throw new Error("README.md has no Outputs section");
    }
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index++) {
      if (lines[index].startsWith("## ")) {
        end = index;
        break;
      }
    }

    expect(lines.slice(start, end).join("\n")).toContain("session_url");
  });
});

describe("skills catalog and example skill injection", () => {
  const skillFiles = readdirSync(join(REPO_ROOT, "skills"))
    .filter((file) => file.endsWith(".md"))
    .sort();
  const exampleYamlFiles = readdirSync(join(REPO_ROOT, "examples"))
    .filter((file) => file.endsWith(".yml"))
    .sort();

  it("names every skill file descriptively after its frontmatter name", () => {
    expect(skillFiles.length).toBeGreaterThanOrEqual(8);
    for (const file of skillFiles) {
      expect(file).not.toMatch(/^gemini-code-/);
      const raw = readFileSync(join(REPO_ROOT, "skills", file), "utf8");
      const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---/);
      expect(frontmatterMatch).not.toBeNull();
      const fm = parse(frontmatterMatch?.[1] ?? "") as { name?: string };
      expect(`${fm.name}.md`).toBe(file);
    }
  });

  it.each(exampleYamlFiles)(
    "examples/%s injects at least one skill from skills/",
    (file) => {
      const content = readFileSync(join(REPO_ROOT, "examples", file), "utf8");
      const referencedSkills = skillFiles.filter((skill) =>
        content.includes(`skills/${skill}`),
      );

      expect(referencedSkills.length).toBeGreaterThan(0);
    },
  );

  it("examples/pr-reviewer.yml runs static analysis, typechecking, detailed comments, and a companion PR", () => {
    const reviewer = readWorkflow("pr-reviewer.yml");
    const job = reviewer.jobs["pr-review-pipeline"];
    expect(job).toBeDefined();

    const stepIds = job.steps.map((s) => s.id).filter(Boolean);
    expect(stepIds).toEqual(
      expect.arrayContaining([
        "skills",
        "static_analysis",
        "typecheck",
        "post_review",
        "jules",
      ]),
    );

    const julesStep = findStep(
      job,
      (step) => step.id === "jules",
      "has id jules",
    );
    expect(julesStep.uses).toContain("arthrod/jules-el-conejo@");
    expect(julesStep.with?.automation_mode).toBe("AUTO_CREATE_PR");
  });
});
