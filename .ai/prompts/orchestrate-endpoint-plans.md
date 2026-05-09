Your task is to generate implementation plans for all REST API endpoints in parallel.

## Step 1 — Read the list of endpoint files

List all files in the directory: `.ai/api-endpoints-data/`

## Step 2 — Read the subagent prompt template

Read the file: `.ai/prompts/endpoint-plan-prompt.md`

This file contains the full instructions that each subagent must follow.

## Step 3 — Ensure output directory exists

Make sure the directory `.ai/api-endpoints-implementation-plans/` exists. If it doesn't, create it.

## Step 4 — Spawn one subagent per endpoint file

For each file found in `.ai/api-endpoints-data/`, spawn a separate Task (subagent).

**Launch ALL subagents in parallel. Do not wait for one to finish before starting the next.**

Each subagent task description must follow this exact structure:
 
---

Read and follow all instructions from the file: `.ai/prompts/endpoint-plan-prompt.md`

The endpoint specification file for this task is: `.ai/api-endpoints-data/[FILENAME]`
 
---

Replace `[FILENAME]` with the actual filename of the endpoint file (e.g. `registration-post-endpoint-data.md`).

## Step 5 — Wait and report

Wait for all subagents to complete. Then report:
- How many plans were generated successfully
- List of created output files in `.ai/api-endpoints-implementation-plans/`
- Any subagent that failed and why
 
