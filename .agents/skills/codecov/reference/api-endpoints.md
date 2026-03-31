# Codecov API Endpoint Reference

Base URL: `https://api.codecov.io/api/v2/github/<owner>/repos/<repo>/`

All requests: set `Accept: application/json`. Never use `app.codecov.io` or `fetch_webpage` — those return HTML.

## Coverage totals

`GET .../totals/`

Returns top-level `totals` + per-file breakdown. `totals` fields: `files`, `lines`, `hits`, `misses`, `partials`, `coverage` (%), `branches`, `methods`, `complexity`.

Query params: `branch`, `sha`, `path` (prefix filter), `flag`, `component_id`

## Coverage report — all files with line data

`GET .../report/`

Returns `totals` + `files[]` array. Each file has `totals` and `line_coverage`.

`line_coverage`: array of `[lineNumber, hitCount]` pairs — hit=0, miss=1, partial=2. Filter `hitCount == 0` for uncovered lines.

Query params: `branch`, `sha`, `path` (prefix filter), `flag`, `component_id`

## File coverage report — single file

`GET .../file_report/{path}/`

Returns `FileReport`: `name`, `totals`, `line_coverage`, `commit_sha`, `commit_file_url`.

Query params: `branch`, `sha`

## Coverage report tree

`GET .../report/tree`

Hierarchical directory rollup. Query params: `branch`, `sha`, `path` (start, default root), `depth` (default 1), `flag`, `component_id`

## Compare two commits or a pull request

`GET .../compare/`

Query params: `base` + `head` (SHAs), or `pullid` (integer)

Sub-endpoints: `.../compare/file/{file_path}`, `.../compare/impacted_files`, `.../compare/flags`, `.../compare/components`, `.../compare/segments/{file_path}`

## Commits list

`GET .../commits/`

Paginated list of commits with coverage totals. Query params: `branch`, `page`, `page_size`

## Branches list

`GET .../branches/`

Paginated list of branches with head commit coverage. Query params: `page`, `page_size`

## Flags list

`GET .../flags/`

Paginated list of coverage flags and their percentages. Query params: `page`, `page_size`

## Pulls list

`GET .../pulls/`

Paginated list of PRs with coverage comparison info. Query params: `page`, `page_size`, `state` (open/closed/merged)
