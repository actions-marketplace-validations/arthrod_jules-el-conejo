<div align="center">

<img src="assets/jules-el-conejo.svg" alt="Jules, el conejo, raising a carrot like Excalibur" width="480">

## 🐇 Jules, el conejo 🥕
Send Jules, Google's remote coding agent, to work from any GitHub Actions workflow

[Get Started](#-quick-start) • [Examples](./examples) • [API Docs](https://jules.google/docs/api/reference/)

[![Built with Jules](https://img.shields.io/badge/Built%20with-Jules-715cd7?link=https://jules.google)](https://jules.google)


</div>


## 🥕 What is Jules?

**[Jules](https://jules.google)** is a remote AI coding agent from [Google Labs](https://labs.google) powered by Gemini 3.1 Pro. It works autonomously in a cloud VM—analyzing your codebase, implementing features, fixing bugs, and creating pull requests while you focus on what matters.

**Jules, el conejo** 🐇 is this GitHub Action: it lets you trigger Jules from any GitHub event, such as issues, pull requests, schedules, or workflow dispatches.

Check out our [example workflows](#-example-workflows) for ideas on using Jules workflows to automatically fix bugs, improve performance, and more!

## 🐇 Quick Start

### 🥕 1. Get a Jules API Key

1. 🐇 Authenticate with GitHub at [jules.google.com](https://jules.google.com)
2. 🥕 Generate an API key from your account settings
3. 🐇 See [API docs](https://jules.google/docs/api/reference/) for details

### 🥕 2. Add to GitHub Secrets

1. 🐇 Go to **Settings** → **Secrets and variables** → **Actions**
2. 🥕 Click **New repository secret**
3. 🐇 Name: `JULES_API_KEY`, Value: your key

### 🥕 3. Create a Workflow

🐇 Create `.github/workflows/security-agent.yml`:

```yaml
name: Daily Security Scan

on:
  schedule:
    - cron: '0 6 * * *'  # 🥕 Every day at 6 AM
  workflow_dispatch:

jobs:
  scan:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - name: 🐇 Run Jules, el conejo
        # 🥕 Pin to a release tag or commit SHA instead of @main in your workflows.
        uses: arthrod/jules-el-conejo@main
        with:
          prompt: |
            You are a security agent. Scan for vulnerabilities and fix them:

            CRITICAL (fix immediately):
            - Hardcoded secrets, API keys, passwords
            - SQL injection, command injection
            - Missing auth on sensitive endpoints

            HIGH PRIORITY:
            - XSS, CSRF vulnerabilities
            - Insecure direct object references
            - Missing input validation

            Rules:
            - Fix highest severity first
            - Keep changes under 100 lines
            - Run tests before creating PR
          jules_api_key: ${{ secrets.JULES_API_KEY }}
```

Your repo now has a security agent hunting vulnerabilities daily! 🛡️🐇🥕

---

## 🥕 Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `prompt` | The task for Jules to perform. **Required for create mode.** | — |
| `jules_api_key` | **Required.** Your Jules API key (use secrets). | — |
| `starting_branch` | Branch for Jules to start from. | `main` |
| `include_last_commit` | Include the last commit's diff in context (`true`/`false`). | `false` |
| `include_commit_log` | Include recent commit history in context (`true`/`false`). | `false` |
| `title` | Optional title for the Jules session. Auto-generated if omitted. | — |
| `require_plan_approval` | `true` makes Jules wait for plan approval (approve it in the Jules web app); `false` runs fully autonomously. | `false` |
| `automation_mode` | Jules `AutomationMode`: `AUTO_CREATE_PR` opens a PR automatically; `AUTOMATION_MODE_UNSPECIFIED` creates no PR. | `AUTO_CREATE_PR` |
| `mode` | `create` starts a new session; `delete` removes an existing one. | `create` |
| `session_id` | Session to delete (delete mode), e.g. `16871897978654894041` or `sessions/16871897978654894041`. | — |

🐇 Inputs are validated before anything else runs, and an invalid value fails the step with an error that names the input:

- `mode` must be `create` or `delete` (case-insensitive).
- `prompt` must not be empty in create mode.
- Boolean inputs accept `true` or `false` (case-insensitive). Anything else, such as `yes` or `1`, is an error rather than being read as `false`.
- `automation_mode` must look like an `AutomationMode` name: upper-case letters, digits and `_`. The action does not keep a list of valid names. The Jules API rejects an unknown name with HTTP 400, so new modes work without an action update.
- `session_id` may contain only letters, digits, `_` and `-`, optionally prefixed with `sessions/`.
- `jules_api_key` must not be empty.

**🥕 Git context and checkout.**
- Jules reads your repository from GitHub, so the action needs no checkout of its own. It uses git only for `include_last_commit` and `include_commit_log`.
- If the workspace is already a git checkout, those commands run there, and the action never cleans it, moves its HEAD or touches its credentials. Check out with `fetch-depth: 20` or more if you want the whole 20-commit log in `include_commit_log`.
- Otherwise the action checks out the repository into `.jules-el-conejo-checkout` and removes that directory when it finishes. If a directory of that name already exists, the step fails rather than overwrite it.
- Without either flag, the action does not check anything out. Earlier versions checked out on every create, so if a later step relied on that side effect, add your own `actions/checkout` step.

**🐇 Error handling.**
- Each attempt at an API call has a 10 s connect timeout and a 60 s overall timeout.
- Creating a session is retried only when the connection could not be made at all. It is never retried once the request may have reached Jules, because a retry could start a duplicate session and a duplicate PR. In that case the error says the request may already have reached Jules, so check the Jules web app for a new session before re-running.
- Deleting a session retries transient errors (timeouts, 429, 5xx) up to 3 times, so in the worst case a delete takes about 4 minutes. A 404 is reported as a warning and treated as already deleted.
- Any other non-2xx response fails the step, showing the HTTP status and the start of the response body.
- A successful create must return a JSON object whose session `name`, `id` and `url` have the expected shape (for example `sessions/<id>` and a single-line `https://` URL). Anything else fails the step instead of writing odd values to the outputs.
- The API key is passed to curl through a private header file (created with `mktemp`, mode 0600, removed on exit), never on the command line.
- Every error, warning and status line the action prints starts with `🥕🐇 Jules, el conejo:`, so you can spot them in a busy job log. Response bodies the action echoes (the create JSON, an HTTP error body) are data and are printed as is.

## 🐇 Outputs

| Output | Description |
|--------|-------------|
| `session_id` | The Jules session ID (e.g., `16871897978654894041`) |
| `session_name` | The full session resource name (e.g., `sessions/16871897978654894041`) |
| `session_url` | Link to the session in the Jules web app (create mode) |
| `response` | The full JSON response from the Jules API (create mode) |

🥕 In delete mode, `session_id` and `session_name` identify the deleted session, and `session_url` and `response` are empty.

---

## 🐇 Example Workflows & Skills

🥕 Copy these into `.github/workflows/` and customize. Each workflow injects one or more engineering skills from [`./skills`](./skills):

| Example | Trigger | Injected Skills | Description |
|---------|---------|-----------------|-------------|
| [pr-reviewer](./examples/pr-reviewer.yml) | Pull request / manual | All 8 skills in `skills/` | 🔍 Multi-step PR reviewer: multi-tool static analysis, typechecking, detailed PR review comments, and a companion fix PR |
| [security-owasp-auditor](./examples/security-owasp-auditor.yml) | Manifest push / daily | `pr-review-security-owasp`, `pr-review-static-triage`, `pr-body-visualizer` | 🛡️ OWASP Top 10, query parameterization, PII allowlist & supply-chain CVE gatekeeper |
| [rust-systems-auditor](./examples/rust-systems-auditor.yml) | Rust PR / manual (`en-US`/`ja`) | `pr-review-rust-quality`, `pr-review-performance`, `pr-body-visualizer` | 🦀 Rust `unsafe` soundness, async concurrency & zero-cost abstraction auditor |
| [polyglot-matrix-triage](./examples/polyglot-matrix-triage.yml) | Scheduled / manual | Dynamic per-stack skill bundle | 🧩 Auto-discovers repo stacks (`python`, `typescript`, `rust`, `shell-docs-ci`) and runs parallel Jules sessions |
| [weekly-cleanup](./examples/weekly-cleanup.yml) | Scheduled (cron) | `pr-review-static-triage`, `pr-review-architecture-quality`, `pr-review-polyglot-standards` | Automated code maintenance, dead-code removal, and barrel-file elimination |
| [performance-improver](./examples/performance-improver.yml) | Scheduled (daily) | `pr-review-performance`, `pr-body-visualizer` | ⚡ Hunt and fix $O(n^2)$ loops, N+1 queries, and hot-path bottlenecks |
| [bug-fixer](./examples/bug-fixer.yml) | Issue labeled `bug` | `pr-review-static-triage`, `pr-review-testing` | Diagnose and fix bugs with static triage and regression tests |
| [ci-failure-fix](./examples/ci-failure-fix.yml) | CI workflow fails | `pr-review-polyglot-standards`, `pr-review-testing` | Summarize failed CI steps and automatically fix failed builds |
| [unblocked-issues](./examples/unblocked-issues.yml) | Issue closed | `pr-review-architecture-quality`, `pr-review-testing` | Work on issues that were blocked by the closed issue |
| [autonomous-bug-fixer](./examples/autonomous-bug-fixer.yml) | Issue labeled `bug` | `pr-review-testing`, `pr-body-visualizer` | Fully autonomous bug fix with regression tests and session tracking |
| [session-cleanup-on-merge](./examples/session-cleanup-on-merge.yml) | PR merged | `pr-body-visualizer` | Audit merged PR evidence and delete the Jules session when its PR is merged |

🐇 See [examples/README.md](./examples/README.md) for detailed setup instructions and the full skill catalog.

---

## 🥕 Writing Good Prompts

Jules excels when you give it **clear specifications** or **measurable targets** it can verify. This is especially powerful for scheduled workflows that run continuously.

**🐇 Example: Weekly Performance Agent**

```yaml
name: Performance Improvement Agent
on:
  schedule:
    - cron: '0 3 * * 1'  # 🥕 Every Monday at 3 AM

jobs:
  optimize:
    runs-on: ubuntu-latest
    steps:
      - name: 🐇 Run Jules, el conejo
        # 🥕 Pin to a release tag or commit SHA instead of @main in your workflows.
        uses: arthrod/jules-el-conejo@main
        with:
          prompt: |
            You are a performance improvement agent. Run our benchmark suite
            and look for optimization opportunities:

            1. Run `npm run bench` to get current metrics
            2. Identify the slowest endpoints or functions
            3. Implement optimizations (caching, query improvements, algorithm changes)
            4. Re-run benchmarks to verify improvement
            5. Only open a PR if you achieve measurable gains

            Constraints:
            - Don't change public API contracts
            - All existing tests must pass
          jules_api_key: ${{ secrets.JULES_API_KEY }}
```

**🥕 Why this works:** Jules can run benchmarks, iterate on solutions, and verify its own success. Give Jules a target it can measure, and it becomes a continuous improvement loop.

**🐇 More ideas for scheduled agents:**
- Security audit agent (run `npm audit`, fix vulnerabilities)
- Dependency updater (update deps, run tests, PR if green)
- Docs updater agent (update docs based on recent changes)
- Test coverage improver (find gaps, add tests, target 90%)




---

## 🐇 Security

**⚠️🥕 Important:** Issue-triggered workflows can be exploited by untrusted users opening issues. Always restrict who can trigger Jules for sources like GitHub issues. For things like issues, oftentimes __anyone__ can create an issue so it can be handy to have an allowlist condition for
Jules triggering.

**🐇 Add an allowlist condition to your step:**

```yaml
- name: 🐇 Run Jules, el conejo
  # 🥕 Only runs if user is in the allowlist
  if: ${{ contains(fromJSON('["trusted-user", "another-user"]'), github.event.issue.user.login) }}
  uses: arthrod/jules-el-conejo@main
  with:
    prompt: ...
```

**🥕 Best practices:**
- Never commit `JULES_API_KEY`—always use [GitHub Actions secrets](https://docs.github.com/en/actions/how-tos/security-for-github-actions/security-guides/using-secrets-in-github-actions)
- Treat Jules like any team member: review its PRs before merging

---

## 🥕 Resources

- **Jules Homepage:** [jules.google](https://jules.google)
- **Jules Web App:** [jules.google.com](https://jules.google.com)
- **Jules API Documentation:** [jules.google/docs/api/reference](https://jules.google/docs/api/reference/)
- **GitHub Actions:** [docs.github.com/actions](https://docs.github.com/actions)
- **Jules, el conejo, issues:** [github.com/arthrod/jules-el-conejo/issues](https://github.com/arthrod/jules-el-conejo/issues)

---

## 🐇 Attribution

🥕 If you find this useful, add the badge to your README:

```markdown
[![Built with Jules](https://img.shields.io/badge/Built%20with-Jules-715cd7?link=https://jules.google)](https://jules.google)
```

---

<div align="center">

**🐇🥕 Jules, el conejo** · powered by [Jules](https://jules.google), built with ❤️ by Google Labs

[Jules](https://jules.google) • [API Docs](https://jules.google/docs/api/reference/) • [Report Issues](https://github.com/arthrod/jules-el-conejo/issues)

</div>
