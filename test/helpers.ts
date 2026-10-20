import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const REPO_ROOT = resolve(import.meta.dirname, "..");
export const SCRIPT = join(REPO_ROOT, "scripts", "jules.sh");
// Lets the suite run under a specific bash (e.g. macOS /bin/bash 3.2).
const BASH = process.env.JULES_TEST_BASH ?? "bash";

export type RecordedRequest = {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
};

export type MockReply = {
  status: number;
  body?: string;
  headers?: Record<string, string>;
};

export type MockJules = {
  baseUrl: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
};

export const json = (status: number, value: unknown): MockReply => ({
  status,
  body: JSON.stringify(value, null, 2),
  headers: { "content-type": "application/json" },
});

export const SESSION = {
  name: "sessions/16871897978654894041",
  id: "16871897978654894041",
  title: "Fix the bug",
  state: "QUEUED",
  url: "https://jules.google.com/session/16871897978654894041",
};

/** Starts a local stand-in for https://jules.googleapis.com/v1alpha. */
export async function startMockJules(
  reply: (req: RecordedRequest) => MockReply = () => json(200, SESSION),
  port = 0,
): Promise<MockJules> {
  const requests: RecordedRequest[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const recorded: RecordedRequest = {
        method: req.method ?? "",
        path: req.url ?? "",
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      requests.push(recorded);
      const { status, body = "", headers = {} } = reply(recorded);
      res.writeHead(status, headers);
      res.end(body);
    });
  });
  await new Promise<void>((done) => server.listen(port, "127.0.0.1", done));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1alpha`,
    requests,
    close: () =>
      new Promise<void>((done, fail) =>
        server.close((err) => (err ? fail(err) : done())),
      ),
  };
}

/** Parses a $GITHUB_OUTPUT file: `key=value` lines and `key<<DELIM` blocks. */
export function parseGithubOutput(text: string): Record<string, string> {
  const outputs: Record<string, string> = {};
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === "") continue;
    const heredoc = line.match(/^([^=<]+)<<(.+)$/);
    if (heredoc) {
      const [, key, delimiter] = heredoc;
      const value: string[] = [];
      for (i++; i < lines.length && lines[i] !== delimiter; i++) {
        value.push(lines[i]);
      }
      if (i >= lines.length) {
        throw new Error(`unterminated heredoc for output ${key}`);
      }
      outputs[key] = value.join("\n");
      continue;
    }
    const eq = line.indexOf("=");
    if (eq === -1) throw new Error(`malformed GITHUB_OUTPUT line: ${line}`);
    outputs[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return outputs;
}

export type RunResult = {
  code: number;
  stdout: string;
  stderr: string;
  outputs: Record<string, string>;
  runnerTemp: string;
};

/** Runs `bash scripts/jules.sh <command>` the way a composite step would. */
export async function runJules(
  command: string,
  env: Record<string, string>,
  options: { cwd?: string } = {},
): Promise<RunResult> {
  const runnerTemp = await mkdtemp(join(tmpdir(), "jules-runner-"));
  const outputFile = join(runnerTemp, "github_output");
  await writeFile(outputFile, "");
  const child = spawn(
    BASH,
    ["--noprofile", "--norc", "-eo", "pipefail", SCRIPT, command],
    {
      cwd: options.cwd ?? runnerTemp,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: runnerTemp,
        RUNNER_TEMP: runnerTemp,
        GITHUB_OUTPUT: outputFile,
        ...env,
      },
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const code = await new Promise<number>((done) =>
    child.on("close", (status) => done(status ?? -1)),
  );
  const outputs = parseGithubOutput(await readFile(outputFile, "utf8"));
  return { code, stdout, stderr, outputs, runnerTemp };
}

/** Creates a throwaway git repo with one commit, for include_* tests. */
export async function makeGitRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "jules-repo-"));
  const git = (...args: string[]) =>
    new Promise<void>((done, fail) => {
      const child = spawn(
        "git",
        [
          "-c",
          "user.name=Test",
          "-c",
          "user.email=test@example.com",
          "-c",
          "commit.gpgsign=false",
          ...args,
        ],
        { cwd: dir, env: { PATH: process.env.PATH ?? "", HOME: dir } },
      );
      child.on("close", (status) =>
        status === 0
          ? done()
          : fail(new Error(`git ${args.join(" ")} exited ${status}`)),
      );
    });
  await git("init", "-q");
  await writeFile(join(dir, "fixture.txt"), "hello from the fixture commit\n");
  await git("add", "fixture.txt");
  await git("commit", "-q", "-m", "Add fixture file");
  return dir;
}
