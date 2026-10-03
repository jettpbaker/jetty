# Pull request data layer

`server/src/pull-request-graphql.ts` exports the field selections
(`pullRequestGraphqlFields` for a full refresh, `checkRollupFields` for running
checks, `pullRequestStateFields` for change detection), `pullRequestGraphqlQuery`,
`mapPullRequestGraphql`, and `mapReviewers`. List queries and mapping live in
`server/src/pull-requests.ts` as `pullRequestListGraphqlQuery` and
`mapPullRequestList`.

The new snapshot data is additive, so stored snapshots from older versions
still decode. `reviewRequests` contains pending users, bots and teams;
`reviewers` uses GraphQL `latestReviews` with `latestOpinionatedReviews` overriding
plain comments, so a comment after an approval does not hide the approval. REST
reviews remain the bounded activity history. `state: AWAITING` overrides an older
review when someone is explicitly requested again, while `latestReviewState` preserves that prior
review. Logins keep GitHub's casing and bots keep REST's `[bot]` suffix, so a
reviewer matches across REST and GraphQL. Copilot, which GitHub names `Copilot`
on comments and `copilot-pull-request-reviewer[bot]` on reviews and requests,
is one reviewer with login `Copilot`; writes send the bot login. Team identities
use `organization/slug`, and include `asCodeOwner`.

Closing issues carry repository identity and `open`, `completed` or
`not_planned` state. REOPENED is open; DUPLICATE is not planned. Suggested users
carry names as well as their existing identity fields. The existing assignable
user search remains separate, with a five-minute cache; suggestions are not
another search endpoint. Mergeability preserves GitHub's enum values.
Top-level conversation comments (`issueComments`) come from the same query,
newest 100, keeping REST's `[bot]` login suffix. Checks stop at GitHub's first
100; past that `checkRunsTotalCount` and the rollup state carry the rest.

The optional `references` array resolves description mentions (`#123` and
`owner/repo#123`) as issues or PRs, with repository, number, kind, state, title
and URL. Fenced and inline code, duplicates and the PR itself are excluded;
each description is capped at 30 references. Issues use the closing-issue state
fold; PRs use `open`, `draft`, `merged` or `closed`. Unresolvable items are omitted.
Normal refreshes add aliases from the cached body's reference list to the existing
GraphQL query. First loads and edits fetch newly mentioned targets in one small
follow-up before publishing, including the immediate refresh after any write.
Null targets count as attempted, so they do not trigger repeated follow-ups.
Reference aliases are separate from PR aliases, keeping their NOT_FOUND and field
errors out of PR error handling. There is currently no description write operation.

Reference reads have no connections, so they add no primary rate-limit cost to
the existing query; the reference-only follow-up costs the one-point minimum.
GitHub's [point calculation](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api#predicting-the-point-value-of-a-query)
counts connection requests, divides by 100 and rounds, with a minimum of one.
The existing `[pr-rate]` log still records the returned `rateLimit.cost`.

When GitHub answers with errors on some fields, those fields keep their previous
value: the server keeps the last raw `pullRequest` per PR and query shape and
copies the errored fields back before mapping. An error that nulls the whole PR
keeps the previous read; only GitHub's `NOT_FOUND` reads as not found.

## Refresh policy

| Context             | PR refresh                    | Running checks only              |
| ------------------- | ----------------------------- | -------------------------------- |
| Focused PR view     | 30 seconds                    | 10 seconds                       |
| Blurred PR view     | 2 minutes                     | 30 seconds                       |
| Linked PRs          | On change, detected every 30s | Rollup state in the same query   |
| PR list tabs        | 2 minutes, batched search     | 30 seconds, aliased rollup reads |
| Hidden clients      | Paused                        | Paused                           |
| Closed or merged PR | 30 minutes                    | Paused                           |

Linked PRs (the sidebar marks) share one aliased query for every active link
that reads `updatedAt` and the check rollup state; a PR is fully refreshed only
when either differs from its stored snapshot. That query costs about one point
regardless of how many PRs are linked.

A visible client keeps shared data fresh for hidden clients too. Subscriptions
send cached state first, and later updates arrive as hub pushes; the poll timer
itself emits nothing. Browser focus/visibility is wired in the connection layer,
without changing components. The server wakes every five seconds to check
deadlines; that timer does not itself call GitHub.

Concurrent full refresh jobs batch into one aliased GraphQL query, while
retaining the existing visible/prefetch priority limits. A fetch publishes its
own result, so a subscription restarting mid-fetch (focus, blur, navigation)
never drops it. In-flight REST reads are shared and use ETags. Existing REST
PR/history/files/repository reads remain for the current view's data; new
metadata, conversation comments and checks share the GraphQL read.
Concurrent list tabs use a single aliased search query. Snapshot publication is
serialized, and revisions discard reads that overlap our writes.

GraphQL connections are bounded at 100. `truncatedConnections` names omitted
pages; review threads fetch only the root comment, with resolution inherited by
REST replies. The overall check rollup remains available even if individual
checks are truncated. REST history retains its existing five-page bound.
`behindBy` is obtained inside the same query using the cached head SHA and live
base ref. It is null on the first read, if comparison is unavailable, or when
that SHA no longer matches the PR's head. A push landing between the GraphQL
and REST reads of one refresh re-reads the GraphQL half once at the new head; a
second push inside that window leaves the checks briefly stale until the next
poll.

Both PR and list snapshots expose `rateLimit`: GraphQL cost/remaining/reset,
REST remaining/reset, backoff deadline, full cadence, and check cadence. Either
budget below 500 slows cadence fourfold. Exhaustion honours reset, secondary
limits honour Retry-After, and absent guidance starts exponential backoff at
60 seconds (capped at 15 minutes). Writes run one at a time, queueing rather
than failing, and the last queued write to a PR refreshes it immediately after
its request completes, unless GitHub requires backoff. Limit and cadence
changes are logged with `[pr-rate]`.

## Operations

- `pullRequest.updateTitle { repo, number, title }`: optimistically publishes the
  cached title, PATCHes GitHub, rolls back on rejection, then refreshes.
- `pullRequest.merge { repo, number, sha, mergeMethod? }`: defaults to squash,
  sends the head SHA guard, and exposes `pendingOperation: merge`. HTTP 405
  explains merge requirements; HTTP 409 asks the user to refresh the moved head.
- `pullRequest.setReviewRequest { repo, number, login, requested, kind? }`:
  preserves existing user calls, accepts bots, and uses `kind: team` with a team
  slug. Copilot writes use `copilot-pull-request-reviewer[bot]`. Changes are
  optimistic, roll back on rejection, and refresh after the write. A secondary
  rate limit on a write reports the backoff rather than a permissions error.
- `pullRequest.uploadAttachment { repo, name, mimeType, base64data }`: returns
  `{ url }`, without posting a comment or editing a PR body. Images are limited
  to 10 MiB; videos to 48 MiB within the existing RPC payload budget. Supporting
  GitHub's full 100 MiB video allowance would require a streamed transport.

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

Real title/review/merge writes, a real asset upload, and an actual secondary-limit
response were not performed. Copilot re-request behavior and private/team
permissions need validation on a suitable PR. The bounded-connection policy,
API names, intervals, and larger-video transport remain reviewable decisions.
