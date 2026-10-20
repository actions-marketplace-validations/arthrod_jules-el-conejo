# Example Workflows

Ready-to-use GitHub Actions workflows for common Jules use cases. Copy these into your `.github/workflows/` directory and customize as needed.

## 🔐 Security First

> **⚠️ Important:** All issue-triggered workflows include user allowlists. Always restrict who can trigger Jules to prevent abuse.

Replace `["your-username", "trusted-collaborator"]` with your actual trusted usernames.

---

## Workflows

### [bug-fixer.yml](./bug-fixer.yml)
**Trigger:** Issue labeled with `bug`

Diagnose and fix bugs with a structured debugging prompt. Jules will analyze, trace, fix, and add regression tests.

**Tips for best results:**
- Include error messages and stack traces in the issue
- Describe expected vs actual behavior
- Mention steps to reproduce

---

### [weekly-cleanup.yml](./weekly-cleanup.yml)
**Trigger:** Scheduled (Mondays at 2 AM UTC) or manual

Keep your codebase clean with automated maintenance. Removes dead code, reduces duplication, and improves naming.

**Customize by:**
- Adjusting the cron schedule
- Adding/removing focus areas in the prompt
- Targeting specific directories

---

### [performance-improver.yml](./performance-improver.yml)
**Trigger:** Scheduled (daily at 4 AM UTC) or manual

A performance optimization agent that hunts for speed improvements across frontend, backend, and general code patterns.

**What it looks for:**
- Frontend: unnecessary re-renders, code splitting opportunities, unoptimized images
- Backend: N+1 queries, missing indexes, caching opportunities
- General: O(n²) algorithms, redundant calculations, inefficient data structures

**How it works:**
- Only creates PR if there's measurable impact
- Keeps changes under 50 lines
- Includes expected performance improvement in PR description

---

### [ci-failure-fix.yml](./ci-failure-fix.yml)
**Trigger:** When your CI workflow fails

Automatically attempt to fix CI failures. Jules analyzes the failure and proposes a fix on the failing branch.

**Setup:**
- Change `workflows: ["CI"]` to match your actual CI workflow name
- Works best for test failures and lint errors

---

### [unblocked-issues.yml](./unblocked-issues.yml)
**Trigger:** When an issue is closed

Uses the [on-unblocked](https://github.com/google-labs-code/on-unblocked) action to find issues that were blocked by the closed issue, then starts working on them.

**Setup:**
1. Use `blocked by #123` syntax in your issues to create dependencies
2. When you close issue #123, any issues blocked by it will trigger Jules

---

### [autonomous-bug-fixer.yml](./autonomous-bug-fixer.yml)
**Trigger:** Issue labeled with `bug`

Like `bug-fixer.yml`, but Jules skips plan approval and opens a PR on its own, then comments the session link on the issue.

**Setup:**
- Replace the `TRUSTED_USERS` list. Jules only runs when both the issue author and the person who added the label are on it, because the issue body becomes the prompt.
- Needs `issues: write` to post the comment.

---

### [session-cleanup-on-merge.yml](./session-cleanup-on-merge.yml)
**Trigger:** Pull request merged

Deletes the Jules session behind a merged Jules PR. The session ID comes from the footer that Jules puts at the end of the PR body (`PR created automatically by Jules for task [<id>](https://jules.google.com/task/<id>)`). Other Jules links in the PR text are ignored.

**Notes:**
- Runs only for PRs from this repository, never for forks.
- Deletion cannot be undone. Leave this workflow out if you want to keep session history.

---

## Combining Workflows

You can combine multiple approaches:

```yaml
# Feature + Bug in one workflow
name: Jules Issue Handler
on:
  issues:
    types: [labeled]

jobs:
  handle:
    if: contains(fromJSON('["feature", "bug"]'), github.event.label.name)
    # ... use different prompts based on label
```

## Need Help?

- [Jules Documentation](https://jules.google/docs)
- [Jules API Reference](https://jules.google/docs/api/reference/)
- [GitHub Actions Docs](https://docs.github.com/actions)
