---
name: GitHub GraphQL PR Comments
description: GitHub REST API does not expose outdated/resolved status on review comments — GraphQL is required. Covers databaseId vs id, error handling, and pagination.
type: reference
---

# GitHub GraphQL for PR Review Comments

## Problem

GitHub's REST API (`/repos/{owner}/{repo}/pulls/{number}/comments`) does not expose the `outdated` field on review comments. The `outdated` boolean (true when the commented line no longer exists in the latest commit) is only available via the GraphQL API on `PullRequestReviewComment.outdated`.

A separate concept, `isResolved` on `PullRequestReviewThread`, represents explicit user resolution — not automatic code-change detection. These are distinct.

## Solution

Fetch PR review comments via `gh api graphql` instead of the REST endpoint.

## Key Patterns

### Use `databaseId`, not `id`

GraphQL's default `id` field returns an **opaque global node ID** (base64 string). The REST API and frontend expect numeric IDs. Always request `databaseId` explicitly:

```graphql
comments(first: 100) {
  nodes {
    databaseId      # numeric ID compatible with REST
    pullRequestReview { databaseId }  # also needed on parent review
    author { login }
    outdated
    ...
  }
}
```

### GraphQL Error Handling

`gh api graphql` exits with code 0 even on partial errors. Always check for errors before accessing data:

```rust
#[derive(Deserialize)]
struct GhGraphQLError {
    message: String,
}

#[derive(Deserialize)]
struct GraphQLResponse<T> {
    data: Option<T>,       // Option — can be null on error
    errors: Option<Vec<GhGraphQLError>>,
}

// Check errors first, then unwrap data
if let Some(errors) = response.errors {
    return Err(format!("GraphQL errors: {}", errors[0].message));
}
let data = response.data.ok_or("GraphQL returned null data")?;
```

### Ghost Author Handling

Authors can be `null` in GraphQL when the account was deleted. Use `map_or_else` to preserve the comment with a "ghost" author instead of dropping it:

```rust
let author = node.author.map_or_else(|| "ghost".into(), |a| a.login);
```

### Pagination

Use `first: 100` to match existing patterns. Log a warning when `pageInfo.hasNextPage` is true — full cursor-based pagination is a known limitation but acceptable for typical PR sizes.

## Files

- `crates/orkestra-networking/src/interactions/command/query.rs` — `fetch_graphql_comments()` function
