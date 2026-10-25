import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { BRAND, ERROR, REPO_ROOT, runJules } from "./helpers";

// 🥕 or 🐇 (or 🐰): what "carrots and rabbits" means for every instruction.
const CONEJO = /🥕|🐇|🐰/u;

type Described = Record<string, { description?: string }>;
const action = parse(readFileSync(join(REPO_ROOT, "action.yaml"), "utf8")) as {
  name: string;
  description: string;
  inputs: Described;
  outputs: Described;
};

const read = (...path: string[]) =>
  readFileSync(join(REPO_ROOT, ...path), "utf8");
const exampleFiles = readdirSync(join(REPO_ROOT, "examples")).filter((file) =>
  file.endsWith(".yml"),
);
const skillFiles = readdirSync(join(REPO_ROOT, "skills")).filter((file) =>
  file.endsWith(".md"),
);

describe("the action is branded Jules, el conejo", () => {
  it("names itself Jules, el conejo in action.yaml", () => {
    expect(action.name).toBe("Jules, el conejo");
  });

  // Built from parts so this file does not match its own search.
  const retired = [
    ["jules", "action"].join("-"),
    ["jules", "invoke"].join("-"),
  ];

  it.each(retired)("no tracked file still says %s", (needle) => {
    const tracked = execFileSync("git", ["ls-files", "-z"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    })
      .split("\0")
      .filter((file) => file !== "" && !file.endsWith(".png"));
    const offenders = tracked.filter((file) =>
      read(file).toLowerCase().includes(needle.toLowerCase()),
    );

    expect(offenders).toEqual([]);
  });

  it.each(exampleFiles)(
    "examples/%s runs this action as arthrod/jules-el-conejo",
    (file) => {
      const workflow = parse(read("examples", file)) as {
        jobs: Record<string, { steps: { uses?: string }[] }>;
      };
      const uses = Object.values(workflow.jobs)
        .flatMap((job) => job.steps)
        .map((step) => step.uses ?? "")
        .filter((ref) => ref.toLowerCase().includes("jules"));

      expect(uses.length).toBeGreaterThan(0);
      for (const ref of uses) {
        // @v1 follows the published 1.x releases; @main would follow every merge.
        expect(ref).toBe("arthrod/jules-el-conejo@v1");
      }
    },
  );

  it("the README's snippets run this action at @v1", () => {
    const refs = [
      ...read("README.md").matchAll(/uses:\s*(arthrod\/jules-el-conejo@\S+)/g),
    ].map((m) => m[1]);

    expect(refs.length).toBeGreaterThan(0);
    expect(refs.filter((ref) => ref !== "arthrod/jules-el-conejo@v1")).toEqual(
      [],
    );
  });
});

describe("every instruction carries carrots and rabbits", () => {
  it("action.yaml's own description", () => {
    expect(action.description).toMatch(CONEJO);
  });

  it.each([
    ...Object.entries(action.inputs).map(([name, x]) => [`input ${name}`, x]),
    ...Object.entries(action.outputs).map(([name, x]) => [`output ${name}`, x]),
  ] as const)("action.yaml %s description", (_name, entry) => {
    expect(entry.description).toMatch(CONEJO);
  });

  it.each([
    "README.md",
    "examples/README.md",
    ...skillFiles.map((file) => join("skills", file)),
  ])("every heading in %s", (file) => {
    // A `# comment` inside a fenced code block is not a heading.
    let fenced = false;
    const headings = read(file)
      .split("\n")
      .filter((line) => {
        if (line.startsWith("```")) fenced = !fenced;
        return !fenced && /^#{1,6} /.test(line);
      });

    expect(headings.length).toBeGreaterThan(0);
    expect(headings.filter((line) => !CONEJO.test(line))).toEqual([]);
  });

  it.each(skillFiles)(
    "skills/%s frontmatter description and brand are conejo-themed",
    (file) => {
      const text = read("skills", file);
      const fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
      expect(fmMatch).not.toBeNull();
      const fm = parse(fmMatch?.[1] ?? "") as {
        description?: string;
        metadata?: { brand?: string };
      };

      expect(fm.description).toMatch(CONEJO);
      expect(fm.description).toContain("Jules, el conejo");
      expect(fm.metadata?.brand).toMatch(CONEJO);
      expect(fm.metadata?.brand).toContain("Jules, el conejo");
    },
  );

  it.each(exampleFiles)("every comment block in examples/%s", (file) => {
    // Lines inside `prompt: |` and `script: |` are payload, not comments, even
    // when they start with # (markdown headings in a prompt).
    const blocks: string[] = [];
    let current: string[] = [];
    let scalarIndent: number | undefined;
    const flush = () => {
      if (current.length > 0) blocks.push(current.join("\n"));
      current = [];
    };
    for (const line of read("examples", file).split("\n")) {
      const indent = line.length - line.trimStart().length;
      if (scalarIndent !== undefined) {
        if (line.trim() === "" || indent > scalarIndent) continue;
        scalarIndent = undefined;
      }
      if (line.trim().startsWith("#")) {
        current.push(line.trim());
        continue;
      }
      flush();
      if (/:\s*[|>][-+]?\s*(#.*)?$/.test(line)) scalarIndent = indent;
    }
    flush();

    expect(blocks.length).toBeGreaterThan(0);

    expect(blocks.filter((block) => !CONEJO.test(block))).toEqual([]);
  });

  it("errors are signed by the conejo", async () => {
    const result = await runJules("validate", {
      JULES_MODE: "hop",
      JULES_API_KEY: "test-key",
    });

    expect(result.code).toBe(1);
    expect(BRAND).toMatch(CONEJO);
    expect(result.stdout).toContain(
      `${ERROR}mode must be "create" or "delete", got: hop`,
    );
  });

  it("the usage line is signed by the conejo", async () => {
    const result = await runJules("hop", {});

    expect(result.code).toBe(2);
    expect(result.stderr).toContain(
      `${BRAND} usage: jules.sh validate|create|delete|cleanup`,
    );
  });
});

describe("the hero image: a conejo raising a carrot like Excalibur", () => {
  const svgPath = join(REPO_ROOT, "assets", "jules-el-conejo.svg");
  const svg = (() => {
    try {
      return readFileSync(svgPath, "utf8");
    } catch {
      return "";
    }
  })();

  it("is well-formed XML with an svg root, viewBox and title", () => {
    expect(XMLValidator.validate(svg)).toBe(true);
    const doc = new XMLParser({ ignoreAttributes: false }).parse(svg) as {
      svg?: { "@_xmlns"?: string; "@_viewBox"?: string; title?: string };
    };

    expect(doc.svg?.["@_xmlns"]).toBe("http://www.w3.org/2000/svg");
    expect(doc.svg?.["@_viewBox"]).toMatch(/^0 0 \d+ \d+$/);
    expect(doc.svg?.title).toBe("Jules, el conejo");
  });

  it("is self-contained: no scripts, foreign objects, events or remote refs", () => {
    expect(svg).not.toMatch(/<script|<foreignObject|<image|@import/i);
    expect(svg).not.toMatch(/\son[a-z]+\s*=/i);
    expect(svg).not.toMatch(/href\s*=\s*["'](?!#)/i);
    expect(statSync(svgPath).size).toBeLessThan(60_000);
  });

  it("opens the README", () => {
    const firstImage = read("README.md").match(/<img\s+src="([^"]+)"/);

    expect(firstImage?.[1]).toBe("assets/jules-el-conejo.svg");
  });
});
