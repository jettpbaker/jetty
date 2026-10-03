# Pull request data layer

`server/src/pull-request-graphql.ts` defines full, checks-only, and state query
selections and maps GitHub actors, reviewers, and references.
`server/src/pull-requests.ts` loads snapshots, paginates connections, caches file
metadata and commit diffs, schedules reads, and serializes writes.

## Snapshot reads

A full load reads PR metadata, author and merged-by names, reviews, native review
threads and their comments, conversation comments, commit history and parent
counts, status events, file viewed state, repository merge settings, the real
`viewerDefaultMergeMethod`, the authenticated viewer, and `viewerCanUpdate` in
one GraphQL query. Checks retain a bare name, their run/status discriminator,
workflow, event, description (`CheckRun.summary` or `StatusContext.description`),
and `isRequired(pullRequestNumber:)`.

Unsubmitted (`PENDING`) review comments are excluded from posted comments and
their count. Reviews, threads, nested thread replies, conversation comments,
commit history, status timeline, and viewed-file connections follow cursors until
exhausted. Reviewer requests, latest reviews, latest opinionated reviews, labels,
closing issues, and check contexts remain capped at 100. `truncatedConnections`
reports any remaining pages; check totals and the authoritative rollup remain
available. Status events are chronological. The first ready/draft event determines
whether the PR opened as a draft; without one, its current draft flag determines
that.

REST supplies file patches, with ETags per page and Link pagination up to GitHub's
3,000-file limit. A full load reuses previous patches when the head SHA and
changed-file, addition, and deletion counts match, even if the base branch moved.
Viewed states always come freshly from GraphQL; mergeability and `behindBy` also
refresh. Legacy snapshots lacking file flags receive classification on their next
full load.

One additional GraphQL query batches distinct parent directories as aliased
repository objects. Head-side files use the head repository and SHA; removed files
use the base repository and SHA. Each tree entry supplies `isGenerated` and its
blob's `isBinary`. Results are cached by repository, SHA, and directory. The same
query verifies head and base after the REST patch pages. If either moved, the
server retries the full read once and refuses a second mixed revision. Even when
directory metadata is cached, fetching patch pages or reusing patches after the
base moves requires this revision check. Base movement also refreshes
classification for removed files. GitHub's flags are used directly rather than
inferred from a missing patch, extension, or byte sample.

All added schema fields are optional, so stored snapshots still decode. Live
loads fill them. Actor selections include `... on User { name }`; there are no
per-user REST requests. Bot logins retain `[bot]`, and Copilot is normalized to
one display identity while writes use its GitHub bot login.

`reviewers` combines latest reviews with latest opinionated reviews, so a
comment after approval preserves that approval. Re-requested reviewers show
`AWAITING` with the previous verdict in `latestReviewState`. Team identities use
`organization/slug` and retain CODEOWNERS provenance. Reviewer candidate search
remains separate and cached for five minutes.

Description mentions resolve as typed issue/PR references, excluding fenced and
inline code, duplicates, and self-references, with a 30-reference bound. Cached
body references join the main query as aliases; newly discovered targets require
one follow-up. Unresolvable targets are omitted. Closing issues retain repository
identity and open/completed/not-planned states.

Partial GraphQL errors retain previously read fields where possible. Data tied to
a different head is not carried over. Pagination failures affect only their own PR
in a batch. Partial page errors retain the previous connection where it is safe;
revision-bound connections never carry over to a different head. Failed full reads
retain the last good stored snapshot. `behindBy` uses the cached head and live
base comparison; it is null on a cold read or when that head no longer matches.

## Refresh policy

| Context          | Change detection        | Running checks            |
| ---------------- | ----------------------- | ------------------------- |
| Focused PR       | 30 seconds              | 10 seconds                |
| Blurred PR       | 2 minutes               | 30 seconds                |
| Linked PRs       | 30 seconds              | Rollup in the state query |
| PR list tabs     | 2-minute batched search | 30-second batched rollup  |
| Hidden clients   | Paused                  | Paused                    |
| Closed/merged PR | 30 minutes              | Paused                    |

Visible refreshes first read `updatedAt`, head/base SHAs, and the check rollup.
Metadata or revision changes trigger a full load; rollup-only changes patch checks
through the checks query. Running checks also keep their faster refresh cadence,
since individual runs may change without changing the rollup. Visible PRs receive
a full safety refresh after five minutes (or their longer normal cadence). This
catches changes that bump neither `updatedAt` nor the check rollup, including
someone else resolving a thread, individual check runs changing after the rollup
settles, and viewer marks made on GitHub.

Detection requests share batches and in-flight work, and reuse a detection made
within the last five seconds across link and visible monitors. Full reads retain
the existing visible/prefetch queue and batch limits. Subscriptions render cached
state first. Snapshot publication is serialized; reads overlapping a write are
discarded by the revision guard.

Rate-limit health exposes GraphQL cost/remaining/reset, REST remaining/reset,
backoff deadlines, and cadences. Budgets below 500 slow polling fourfold.
Exhaustion honours reset; secondary limits honour Retry-After or exponential
backoff from one to fifteen minutes.

## Request counts

Counts below assume one page per connection, stable revisions, no newly discovered
body references, and cold directory metadata where a diff revision changes.
Concurrent PRs can share GraphQL requests. ETag 304s still count as requests.

| Action                                     | Before |                                                      After |
| ------------------------------------------ | -----: | ---------------------------------------------------------: |
| Cold PR open                               |      7 | 3: full GraphQL + REST patches + metadata/revision GraphQL |
| Unchanged visible refresh                  |      7 |                                     1: batched state query |
| Visible refresh after a new commit         |      7 |                        4: detection + the 3-call full load |
| Safety/manual full refresh, same head/base |      7 |                 1: full GraphQL, reusing patches and flags |
| Diff tab, F cold files needing full text   | 1 + 2F |                                                     1 + 2F |
| Diff tab, warm content cache               |      0 |                                                          0 |

Additional connection/file pages add requests. Checks-only changes cost detection
plus a checks query. Diff content remains lazy behind the existing `diffFile`
RPC; changing the new view's hydration policy belongs to its client port.

PR list refreshes still cost one GraphQL request: the two searches for a tab
share one query, and concurrent tab refreshes share that request too. The search
nodes now include creator names/avatars, diff totals, up to 100 labels, review
decision, and mergeability alongside the check rollup. There are no per-PR or
per-author reads. New wire fields are optional so cached lists still decode.
Live verification reported 4 GraphQL points for one tab and 8 for both together.

## Operations

All writes use the existing semaphore, pending-operation publication, revision
increments, optimistic patches, and rollback. Title edits, new conversation
comments, thread resolution, and viewed marks confirm from the response without a
full refresh. Conversation comments also patch the PR's `updatedAt` from the
mutation response, so the next detection does not reload them. Review replies
confirm their comment immediately, then use the existing queued-write refresh for
the PR's updated timestamp and dependent metadata. Body edits first patch the
body, then refresh derived references and closing issues. State, merge, and
reviewer writes refresh their wider dependent metadata. A failed write refreshes
after rollback, since a multi-step transition may already have reopened the PR.
Only the final queued write performs a needed refresh. Snapshot patches also push
linked sidebar metadata.

- `pullRequest.updateTitle { repo, number, title }` PATCHes the title.
- `pullRequest.updateBody { repo, number, body }` PATCHes Markdown unchanged.
- `pullRequest.setState { repo, number, state }` accepts open/draft/closed.
  Close/reopen use REST; draft/ready use GraphQL. A live state/draft read decides
  whether a closed PR must reopen before converting to the requested draft state.
  Merged PRs reject state changes.
- `pullRequest.comment { repo, number, body }` adds a conversation comment with
  its authoritative ID, timestamps, URL, and named author.
- `pullRequest.reply { repo, number, commentId, body }` replies to the root review
  comment and preserves thread context on the response patch.
- `pullRequest.resolveThread { repo, number, threadId, resolved }` resolves or
  unresolves the native thread and patches every comment in it.
- `pullRequest.setViewed { repo, number, path, viewed }` marks/unmarks a file using
  the PR node ID and patches its viewed state.
- `pullRequest.commitFiles { repo, sha }` lazily reads a commit's own file changes
  against its first parent. REST pages and classification are cached by repository
  and immutable SHA; successful results and concurrent work share a 64-entry LRU.
  Directory flags and diff/merge-base caches also retain 64 entries, REST page
  metadata retains 512 entries, and raw GraphQL reads retain 32 PR/query shapes.
  It returns `{ files, parentSha }`, with null for a root commit's parent.
- `pullRequest.merge { repo, number, sha, mergeMethod? }` retains the head guard
  and squash default. HTTP 405 reports merge requirements; 409 reports a moved head.
- `pullRequest.setReviewRequest { repo, number, login, requested, kind? }` retains
  user/bot/team support, optimistic requests, undo, and authoritative refresh.
- `pullRequest.uploadAttachment { repo, name, mimeType, base64data }` returns a URL
  without posting or editing. Existing image/video limits remain unchanged.

## Live verification

The production query and introspection verified `TreeEntry.isGenerated`,
`Blob.isBinary`, `CheckRun.isRequired`, `StatusContext.isRequired`, workflow event,
repository merge flags/preference, viewer/update permission, actor names, native
thread anchors and comments, commit parents, file viewed state, and timeline
status events against `jettpbaker/pr-lab`. Mutation verification uses disposable
PRs only; fixtures #1–#5 remain read-only.

## Attachment investigation

The uploader can use `gh auth token --hostname github.com`; browser cookies are
not required. The installed login was an OAuth token with repository scope,
and a read-only repository lookup confirmed write access. No token is logged
or persisted by this operation.

The [official attachment guide](https://docs.github.com/en/github-cli/github-cli/attaching-files-with-github-cli)
and [CLI uploader implementation](https://github.com/cli/cli/blob/trunk/internal/attachments/client.go)
confirm raw-byte POST to `https://uploads.github.com/user-attachments/assets`,
with `name`, `content_type`, and numeric `repository_id` query parameters,
`Content-Type: application/octet-stream`, and token authentication. The JSON
response supplies `url`. OAuth, classic PAT and fine-grained PAT credentials
are supported. Some user-to-server tokens work, with the endpoint deciding;
installation tokens are unsupported. WRITE, MAINTAIN or ADMIN repository
permission is required. The operation checks write access, rejects redirects, and reports
endpoint failures (including non-JSON replies).

## Verification and remaining decisions

Read-only live verification succeeded for the full GraphQL query, including
comparison: one PR refresh cost one point. A repeated conditional repository
read returned the same data without decreasing the reported REST balance.

Offline verification exercised batching, ETags, optimistic title publication,
rollback, pending merge state, 405/409 reasons, stale reads racing a write,
visibility cadence, reviewer and issue mapping, secondary backoff, and the
upload request protocol. No new test files were added; the existing RPC test
fixture gained handlers for the new methods.

Review-finding verification used disposable PRs #10 and #11. A pending review
comment initially appeared as posted; selecting its state and filtering `PENDING`
removed it and kept the posted count at zero. Live conversation comments confirmed
the PR timestamp without a full reload; review replies used the queued-write
refresh. Externally closed PRs reopened correctly before draft/ready conversion.
With 110 conversation comments, real HTTP and GraphQL pagination failures affected
only their PR in a batch; a partial page error reused its previous complete
connection. The pending review, PRs, and disposable branches were cleaned up.

Title/reviewer-request/merge writes and a real asset upload remain unverified. Copilot re-request behavior and private/team
permissions need validation on a suitable PR. The bounded-connection policy,
API names, intervals, and larger-video transport remain reviewable decisions.
