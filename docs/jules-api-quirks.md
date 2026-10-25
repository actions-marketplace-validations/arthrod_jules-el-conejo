# Jules API quirks

What the Jules API (v1alpha, discovery revision 20261022) actually does, measured against the live API on 2026-10-25. Each item names the probe cell that showed it; the cells, raw results and method are in [#20](https://github.com/arthrod/jules-el-conejo/issues/20#issuecomment-6402564171). Where a result comes from Jules's own report of a command it ran, it was cross-checked against a value Jules could only get by running it (see [Evidence](#evidence)).

## Creating a session

- **`startingBranch` takes a branch name or a tag name, nothing else.** A SHA (C5) and `refs/heads/main` (C6) are not accepted. Jules clones with `git clone -b <startingBranch>`, which takes branches and tags only.
- **A bad `startingBranch` still gets HTTP 200.** The session is created and fails about a minute later with a `sessionFailed` activity: "Remote branch … not found" (C4, C5, C6). Check the session state; a 200 from create proves nothing about the branch.
- **To pin a session to an exact commit, push a tag at that commit and pass the tag** (C7: HEAD was the tagged commit, not the branch tip). The commit does not need to be on any branch.
- Omitting `githubRepoContext` is a 400 `INVALID_ARGUMENT` (C3).

## The checkout Jules works in

- **One commit of history.** The clone is `git clone --depth 1 --shallow-submodules --no-single-branch --recursive -b <startingBranch>`. `git log` shows one commit; `--no-single-branch` also brings the tip of every other branch, with no history behind it (S11).
- **So `git diff <base>...<head>` fails** with "no merge base", exit 128 (S11). That is why an instruction like "run `git diff base...head`" (jules-pr-reviewer's `diff_mode: agentic`) breaks.
- **History is available on demand.** The session can reach GitHub: `git fetch --deepen=50 origin main <branch>` worked and gave the true merge base (S11), and `git fetch origin <branch>` brought in a commit pushed after the session started (S8). Nothing guarantees Jules decides to do this unless told to.
- **The checkout is frozen at create time.** A commit pushed to the branch later does not appear in it (S8 turn 2: HEAD stayed at the create-time tip). Follow-up messages to the same session see the same old code unless Jules fetches.
- Not tested: `git fetch --unshallow` (full history), and private repositories (both repos probed are public).

## Getting a diff to Jules

Compute the diff on the runner, where the history is, and hand Jules the text. Do not rely on Jules running `git diff`.

| Route | Verified | Limit |
|---|---|---|
| In the create `prompt` | A 150,386-character prompt, sent with curl straight to the API (not through this action), was echoed byte-identical, and Jules quoted seeded tokens from its start, middle and end (S9) | **Through this action, about 128 KiB at most.** `prompt` reaches the script in the `JULES_PROMPT` environment variable, and Linux refuses any env string over 131,072 bytes, counting the name (in `ubuntu:24.04`: `Argument list too long`). A bigger prompt fails the step before any API call. |
| In a `sendMessage` (follow-ups) | 150 KB stored byte-identical; tokens quoted correctly (S10) | — |
| In a file committed for the review, on a tag passed as `startingBranch` | 600,000-byte `.tmp/jules-review/pr.diff` on a commit on top of main, reachable only from a tag: HEAD was that commit, `sha256sum` matched the hash computed outside the session, and Jules quoted the seeded tokens on lines 1, 12,500 and 25,000 (S12) | no env limit; the PR branch is not touched. Jules only reads the file because the prompt names it |
| Sent as a patch for Jules to `git apply` | applied cleanly, file hash matched (S8 turn 3) | — |

**Do not commit the diff into the PR branch itself.** The push moves the PR head (checks restart), wakes every PR bot, re-triggers `pull_request: synchronize` workflows when pushed with a PAT or App token, and puts the diff file into the next review's diff. A commit on top of the PR head, reachable only from a tag, gives Jules the same checkout without any of that. No workflow in this repo listens to tag pushes; check yours for `push: tags`. Either way the job needs `contents: write`, which a `pull_request` run from a fork does not get.

## Automation mode and `workingBranch`

| Setting | What lands on GitHub |
|---|---|
| `automationMode` unset or `AUTOMATION_MODE_UNSPECIFIED` | **Nothing.** No branch, no PR; the change only comes back as `outputs[].changeSet.gitPatch` (S5a, S5b). `workingBranch` is ignored (S7c). |
| `AUTO_CREATE_PR` | A new branch `<slug>-<sessionId>` and a PR from it into `startingBranch`, by `google-labs-jules[bot]` (S6a, S6b). |
| `AUTO_CREATE_PR` + a new `workingBranch` | Jules pushes to that branch and opens a PR into `startingBranch` (S7b). |
| `AUTO_CREATE_PR` + `workingBranch` = `startingBranch` | **An unsigned commit pushed straight onto `startingBranch`, no PR** (S7). Pointed at a PR's head branch, this commits into that PR. Not tested: a branch that moves mid-session, fork PRs. |

In every mode `changeSet.gitPatch.baseCommitId` is the `startingBranch` tip at create time, and `startingBranch` itself only moves in the last row. Where a PR was opened, it was already in `outputs` the first time the session read COMPLETED (S6a, S6b, S7b).

## Messages and replies

- **Addressing is exact.** `POST sessions/{id}:sendMessage` lands only in that session, and its reply only comes back there. Two otherwise identical sessions never saw each other's messages (S1/S2).
- **The response is `{}`**: no activity id and no reply. Pairing a reply with its message is the caller's job:
  1. Put a random nonce in the message.
  2. Poll `activities.list` until a `userMessaged` containing the nonce appears. Its `createTime` is the server's clock.
  3. Take the first `agentMessaged` with a later `createTime`: `activities.list?filter=create_time > "<t>"` returns exactly the newer activities. Compare timestamps numerically, because they come with 0, 3, 6 or 9 fractional digits.
  4. Require the reply to echo the nonce (see [PR comments](#comments-on-a-jules-created-pr-reach-its-session)).
- **Never take "the latest agent message" as the reply.** jules-pr-reviewer's `pollForReview` does, which on a follow-up would return the previous turn's answer.
- **Finished sessions take follow-ups.** COMPLETED, archived, and archived-then-unarchived sessions all accepted a message and answered it (S3, S4a, S4b).
- **The state does not signal a reply.** The reply lands while the session still says COMPLETED; it then shows IN_PROGRESS and returns to COMPLETED minutes later (S3, S4). Wait for the `agentMessaged`, not for a state change.
- Activity ids came in two shapes: `task-<session>-activity-step-<n>` for our messages, a hex id for Jules's replies. `activities.get` resolved both.

## Comments on a Jules-created PR reach its session

A comment on a PR that Jules opened wakes the session behind it, and the API does not see the comment arrive: no `userMessaged` appears. In the probe, all three sessions answered on GitHub within about 30 s. Two also logged an `agentMessaged` in the API. The third logged only `sessionCompleted`, then pushed its head branch again 6 s later, re-creating a branch that had just been deleted. Consequences:

- A bot commenting on a Jules-created PR wakes Jules and takes a concurrency slot.
- Agent messages can appear that answer something the API never showed, which is why reply pairing needs the nonce echo.
- To close a Jules PR for good, close it without a comment, or delete its branch only after the session has settled.
- Not tested: whether Jules also listens on PRs it did not open.

## Limits, errors and retries

| Situation | Response |
|---|---|
| Session id that does not exist | `sendMessage` and `GET` → 404 `NOT_FOUND` (C1, C2) |
| Malformed request (e.g. no `githubRepoContext`) | 400 `INVALID_ARGUMENT` (C3); permanent |
| Create while the account is at its concurrency cap | 400 `FAILED_PRECONDITION` "Precondition check failed."; **no session is created** |
| `sendMessage` while at the cap | 429 `RESOURCE_EXHAUSTED`; **the message is not stored** |

- **What the probe measured about the cap** (S4a-retry, `sendMessage` only): two calls got 429 while 11 sessions were IN_PROGRESS. The third was accepted after exactly one of them had moved to COMPLETED (IN_PROGRESS 11→10, COMPLETED 27→28; AWAITING_USER_FEEDBACK 16, PAUSED 24 and FAILED 22 unchanged). So IN_PROGRESS sessions count, COMPLETED sessions don't, and the cap looked like 11.
  - **Not established:** whether QUEUED, AWAITING_USER_FEEDBACK or PAUSED sessions count. No session was QUEUED in any list, and the other two counts did not change across the release; if they counted, the cap would be about 51, not 11. The lists also only covered the account's newest 100 sessions.
  - Also not established: that create is refused at the same number. Its 400s came a few minutes before these lists, and no count was taken then.
  - A message to an idle session sends it back to IN_PROGRESS, so it takes a slot.
  - The listed state lags, so don't compute headroom from it.
- **Rule: on a 429, or a 400 whose `error.status` is `FAILED_PRECONDITION`, wait and retry at 5, 10, 15 and 30 minutes after the first failure, then give up.** Neither rejection leaves anything behind, so a retry cannot duplicate a session or a message. Any other 400 is permanent and fails at once. `scripts/jules.sh` implements this rule for create and delete (#24).

## Evidence

For these sessions the API returned no `bashOutput` artifacts (a whole session could have a single activity, Jules's chat message), so results about the inside of the VM are Jules's own report. Each is checked against a value Jules could only get by running the command: FETCH_HEAD was the SHA of a commit pushed after the session started (S8); the post-deepen merge base and file list matched GitHub's compare API (S11); file hashes and seeded tokens matched values computed outside the session (S8, S9, S10, S12).
