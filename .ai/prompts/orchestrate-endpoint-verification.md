Your task is to verify all generated API endpoint implementation plans against the project API plan and PRD, using one subagent per file.

## Step 1 — Read the list of implementation plan files

List all files in the directory: `.ai/api-endpoints-implementation-plans/`

## Step 2 — Read the subagent prompt template

Read the file: `.ai/prompts/endpoint-verification-prompt.md`

This file contains the full instructions that each subagent must follow.

## Step 3 — Ensure output directory exists

Make sure the directory `.ai/api-endpoints-verification-reports/` exists. If it doesn't, create it.

## Step 4 — Spawn one subagent per implementation plan file

For each file found in `.ai/api-endpoints-implementation-plans/`, spawn a separate Task (subagent).

**Launch ALL subagents in parallel. Do not wait for one to finish before starting the next.**

Each subagent task description must follow this exact structure:

---

Read and follow all instructions from the file: `.ai/prompts/endpoint-verification-prompt.md`

The endpoint implementation plan file for this task is: `.ai/api-endpoints-implementation-plans/[FILENAME]`

---

Replace `[FILENAME]` with the actual filename of the implementation plan file (e.g. `registration-post-endpoint-implementation-plan.md`).

## Step 5 — Wait and report

Wait for all subagents to complete. Then produce a summary report directly in chat:

- Total number of plans verified
- How many received status PASSED
- How many received status PASSED WITH WARNINGS
- How many received status FAILED
- For any FAILED or PASSED WITH WARNINGS: list the filename and a one-line summary of the main issue found
