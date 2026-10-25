# 🐇 Example Workflows for Jules, el conejo 🥕

Ready-to-use GitHub Actions workflows for common and advanced Jules use cases. Every workflow in `examples/` injects one or more specialized engineering skills from [`../skills/`](../skills) directly into the prompt or audit pipeline. Copy these into your `.github/workflows/` directory and customize as needed.

## 🥕 Security First

> **⚠️ Important:** All issue- and PR-triggered workflows include user allowlists and fork guards. Always restrict who can trigger Jules to prevent abuse.

🐇 Replace `["your-username", "trusted-collaborator"]` with your actual trusted usernames.

---

## 🐇 Skill Catalog (`skills/`)

🥕 Each example workflow loads and injects at least one skill from the [`skills/`](../skills) folder:

| Skill File | Frontmatter Name | Primary Focus & Toolchain |
| :--- | :--- | :--- |
| [`pr-body-visualizer.md`](../skills/pr-body-visualizer.md) | `pr-body-visualizer` | Visual `## Summary` diagrams/diff-sketches, `## Evidence` (Before/After), and `## Merge Danger` (`Door` & `Blast Radius`) |
| [`pr-review-architecture-quality.md`](../skills/pr-review-architecture-quality.md) | `pr-review-architecture-quality` | Single Responsibility, public API call-site consistency, direct module imports (no barrel files), error robustness, Conventional Commits (`biome`, `tsc`, `pyrefly`, `ruff`, `cargo clippy`) |
| [`pr-review-performance.md`](../skills/pr-review-performance.md) | `pr-review-performance` | $O(n^2)$ complexity, N+1 queries, loop recomputation, data structures, unbounded caches, blocking sync I/O (`ruff PERF`, `biome`, `cargo clippy::perf`) |
| [`pr-review-polyglot-standards.md`](../skills/pr-review-polyglot-standards.md) | `pr-review-polyglot-standards` | Python PEP 8/20, Pure Bash idioms, RFC-style Markdown references, and workflow linting (`pyrefly`, `ruff`, `shellcheck`, `markdownlint-cli2`, `yamllint`, `actionlint`) |
| [`pr-review-rust-quality.md`](../skills/pr-review-rust-quality.md) | `pr-review-rust-quality` | Rust memory/concurrency safety, `unsafe` invariants, lock guards across `.await`, ownership idioms, EN/JA localization (`cargo check`, `cargo clippy`, `cargo deny`) |
| [`pr-review-security-owasp.md`](../skills/pr-review-security-owasp.md) | `pr-review-security-owasp` | SQL/query parameterization, log leak prevention, OWASP Web/API Top 10, supply-chain CVEs, PII/PHI allowlists (`gitleaks`, `ruff S/LOG/G`, `pip-audit`, `npm audit`, `cargo audit`, `cargo deny`) |
| [`pr-review-static-triage.md`](../skills/pr-review-static-triage.md) | `pr-review-static-triage` | Multi-language defect triage calibrated by Confidence (1–3) and Priority (1–3) across security, async I/O, type safety, and hygiene (`pyrefly`, `ruff`, `biome`, `tsc`, `cargo clippy`) |
| [`pr-review-testing.md`](../skills/pr-review-testing.md) | `pr-review-testing` | Unit, regression, and error-path test adequacy, test isolation, deterministic teardown, and benchmark evidence (`pytest`, `vitest`, `cargo test`, `pyrefly`, `tsc`) |

---

## 🐇 Core Workflows (Skill-Enhanced)

### 🥕 [bug-fixer.yml](./bug-fixer.yml)
**Trigger:** Issue labeled with `bug`
**Injected Skills:** `pr-review-static-triage.md`, `pr-review-testing.md`

Diagnose and fix bugs with a structured debugging prompt while waiting for human plan approval. Jules runs deterministic static analyzers, traces the root cause, implements a minimal fix, and adds isolated regression tests.

---

### 🥕 [autonomous-bug-fixer.yml](./autonomous-bug-fixer.yml)
**Trigger:** Issue labeled with `bug`
**Injected Skills:** `pr-review-testing.md`, `pr-body-visualizer.md`

Like `bug-fixer.yml`, but Jules skips plan approval, opens a PR formatted with `pr-body-visualizer.md` (`## Summary`, `## Evidence`, `## Merge Danger`), and comments the session link on the issue.

**🐇 Setup:**
- Replace the `TRUSTED_USERS` list. Jules only runs when both the issue author and the person who added the label are on it, because the issue body becomes the prompt.
- Needs `issues: write` to post the comment.

---

### 🥕 [weekly-cleanup.yml](./weekly-cleanup.yml)
**Trigger:** Scheduled (Mondays at 2 AM UTC) or manual
**Injected Skills:** `pr-review-static-triage.md`, `pr-review-architecture-quality.md`, `pr-review-polyglot-standards.md`

Keep your codebase clean with automated maintenance. Eliminates dead code, cross-package duplication, barrel re-export files, and unjustified type suppressors while enforcing PEP 8 and Pure Bash idioms.

---

### 🥕 [performance-improver.yml](./performance-improver.yml)
**Trigger:** Scheduled (daily at 4 AM UTC) or manual
**Injected Skills:** `pr-review-performance.md`, `pr-body-visualizer.md`

A performance optimization agent (`TURBO`) that hunts for $O(n^2)$ loops, N+1 queries, repeated recomputation, suboptimal data structures, and blocking I/O on async paths, presenting verified wins using `pr-body-visualizer.md`.

---

### 🥕 [ci-failure-fix.yml](./ci-failure-fix.yml)
**Trigger:** When your CI workflow fails
**Injected Skills:** `pr-review-polyglot-standards.md`, `pr-review-testing.md`

Summarizes failed CI jobs and steps via the GitHub API, injects polyglot linter/typechecker and testing skills, and dispatches Jules to propose a verified fix on the failing branch.

---

### 🥕 [unblocked-issues.yml](./unblocked-issues.yml)
**Trigger:** When an issue is closed
**Injected Skills:** `pr-review-architecture-quality.md`, `pr-review-testing.md`

Uses the [on-unblocked](https://github.com/google-labs-code/on-unblocked) action to find issues that were blocked by the closed issue, then implements each unblocked feature enforcing Single Responsibility, direct module imports, public API consistency, and unit test coverage.

---

### 🥕 [session-cleanup-on-merge.yml](./session-cleanup-on-merge.yml)
**Trigger:** Pull request merged
**Injected Skills:** `pr-body-visualizer.md`

Audits the merged PR description against `skills/pr-body-visualizer.md` (`## Summary`, `## Evidence`, `## Merge Danger`) in the job summary and deletes the Jules session behind the merged Jules PR using the footer link (`PR created automatically by Jules for task [<id>](https://jules.google.com/task/<id>)`).

---

## 🐇 Sophisticated Multi-Stage Workflows

### 🥕 [pr-reviewer.yml](./pr-reviewer.yml)
**Trigger:** Pull request (`opened`, `synchronize`, `reopened`, `labeled`) or manual `workflow_dispatch`
**Injected Skills:** All 8 skills (`pr-review-static-triage.md`, `pr-review-security-owasp.md`, `pr-review-performance.md`, `pr-review-architecture-quality.md`, `pr-review-testing.md`, `pr-review-polyglot-standards.md`, `pr-review-rust-quality.md`, `pr-body-visualizer.md`)

A 4-stage automated PR reviewer and companion remediation pipeline:
1. **Stage 1 — Multi-Tool Static Analysis:** Executes `gitleaks`, `ruff`, `pip-audit`, `biome`, `cargo clippy`, `cargo deny`, `shellcheck`, `actionlint`, `markdownlint-cli2`, and `yamllint`.
2. **Stage 2 — Strict Multi-Language Typechecking:** Executes `pyrefly check`, `tsc --noEmit`, and `cargo check --all-targets --all-features`.
3. **Stage 3 — Detailed PR Review Comment:** Posts a structured Markdown review report on the PR summarizing static analysis, typecheck diagnostics, and `pr-body-visualizer` compliance.
4. **Stage 4 — Companion Remediation PR:** Invokes `arthrod/jules-el-conejo@v1` starting from the PR head branch with all diagnostics and skills injected so Jules opens a companion PR fixing every detected issue.

---

### 🥕 [security-owasp-auditor.yml](./security-owasp-auditor.yml)
**Trigger:** Push to dependency manifests/lockfiles, daily cron (`0 5 * * *`), or manual `workflow_dispatch` with `audit_scope` (`full`, `supply-chain`, `owasp-pii`)
**Injected Skills:** `pr-review-security-owasp.md`, `pr-review-static-triage.md`, `pr-body-visualizer.md`

Runs pre-flight secret, security-linter, and CVE/license scanners (`gitleaks`, `ruff --select S,LOG,G`, `pip-audit`, `npm audit`, `cargo audit`, `cargo deny`) and dispatches Jules to enforce parameterized SQL/NoSQL queries, eliminate sensitive log leaks, replace PII denylist serializers with explicit allowlists, and patch vulnerable dependencies.

---

### 🥕 [rust-systems-auditor.yml](./rust-systems-auditor.yml)
**Trigger:** Pull requests modifying `**/*.rs` or `Cargo.toml`, or manual `workflow_dispatch` with `review_lang` (`en-US` or `ja`)
**Injected Skills:** `pr-review-rust-quality.md`, `pr-review-performance.md`, `pr-body-visualizer.md`

Runs `cargo check`, pedantic + performance `cargo clippy`, and `cargo deny`, then dispatches Jules as a Principal Rust Systems Engineer (supporting English or Japanese output) to audit `unsafe` blocks for `// SAFETY:` invariants, eliminate `MutexGuard` locks held across `.await` points, replace production `.unwrap()` calls with structured error propagation, and optimize hot-loop allocations.

---

### 🥕 [polyglot-matrix-triage.yml](./polyglot-matrix-triage.yml)
**Trigger:** Weekly schedule (Wednesdays at 3 AM UTC) or manual `workflow_dispatch`
**Injected Skills:** Dynamic per-stack bundle (`pr-review-polyglot-standards.md`, `pr-review-static-triage.md`, `pr-review-architecture-quality.md`, `pr-review-rust-quality.md`, `pr-review-performance.md`, `pr-review-testing.md`, `pr-body-visualizer.md`)

A 2-job dynamic matrix pipeline for polyglot repositories and monorepos:
1. **`discover-stacks`:** Inspects tracked files to detect active stacks (`python`, `typescript`, `rust`, `shell-docs-ci`) and maps each stack to its dedicated skills and verification commands.
2. **`stack-triage` (Matrix):** Runs in parallel per detected stack, concatenating the stack's skill bundle and launching an isolated Jules session scoped to that stack.

---

## 🐇 Combining Workflows

🥕 You can combine multiple approaches:

```yaml
# 🥕 Feature + Bug in one workflow
name: Jules Issue Handler
on:
  issues:
    types: [labeled]

jobs:
  handle:
    if: contains(fromJSON('["feature", "bug"]'), github.event.label.name)
    # 🐇 ... use different prompts based on label
```

## 🥕 Need Help?

- [Jules Documentation](https://jules.google/docs)
- [Jules API Reference](https://jules.google/docs/api/reference/)
- [GitHub Actions Docs](https://docs.github.com/actions)
- [Jules, el conejo, issues](https://github.com/arthrod/jules-el-conejo/issues) 🐇
