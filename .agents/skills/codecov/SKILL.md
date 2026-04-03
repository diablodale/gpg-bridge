---
name: codecov
description: Fetch and analyze code coverage from Codecov API. Use when asked about test coverage, uncovered lines, low-coverage files, or coverage comparisons between commits or PRs.
---

# Codecov Coverage Skill

Fetches and analyzes code coverage data from the Codecov API for a given repository.

## Inputs Required

- `owner`: Codecov owner username (e.g. `diablodale`)
- `repo`: Repository name (e.g. `gpg-bridge`)
- `task`: What coverage information is needed (overall totals, file list ranked by coverage, missed lines in a specific file, PR comparison, etc.)
- `branch` or `sha` (optional): Scope to a specific branch or commit; defaults to head of default branch

## Process

1. Load `reference/api-endpoints.md` to identify the correct endpoint and its query parameters for the task.
   - If deeper parameter/schema details are needed, consult `reference/schema.yaml` (OpenAPI 3.0 YAML, full spec)

2. Select the endpoint that best matches the task:
   - Overall coverage percentage → `totals/`
   - All files ranked by coverage → `report/`
   - Missed lines in one specific file → `file_report/{path}/`
   - PR or commit diff comparison → `compare/`

3. Make the API request using any available tool that supports HTTP REST with JSON.
   Refer to `reference/api-endpoints.md` for the base URL, required headers, and query parameter names.

4. Parse the JSON response. Extract only the fields relevant to the task.
   - For missed lines: filter `line_coverage` entries where `status == 1` (miss; 0=hit, 1=miss, 2=partial).
   - For file rankings: sort by `totals.coverage` ascending.

5. Present findings concisely, prioritizing actionable information.
   Do not dump raw JSON unless explicitly requested.

## Output

- Coverage totals: percentage, lines, hits, misses
- File list: table sorted by coverage ascending, showing file name, coverage %, and miss count
- Missed lines: list of line numbers with a note on what is uncovered
- PR comparison: coverage delta, impacted files, base vs head totals
