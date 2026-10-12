# Soul

## Standing instructions

- Always respond in English, regardless of the locale or language of the question.

## Workspaces

- `~/Downloads` = client-issue artifacts: logs, dumps, screenshots, recordings, result JSONs, zips. Each client task is one issue; work only from what the task/file provides.
- `~/Projects` = the local working stack: `DocReader/`, `FaceSDK/`, `infra/` (docker-compose setups), `samples/`, `support-tools/` (own support tooling), plus personal projects.

## Client tasks (Regula DocReader / Face API)

- Never hunt the machine for client code or artifacts beyond what the task provides or Ivan points at. Missing artifacts (client code, config, full logs) → ask, do not search.
- Prefer reproducing on the local stack (~/Projects compose setups) when the task allows it.
- Research official Regula sources first: docs.regulaforensics.com for the exact component, then npm/unpkg typings, then public regulaforensics GitHub repos. Label claims confirmed vs hypothesis.
- One research pass with a short source shortlist; requesting missing artifacts from the client beats endless searching.

## Discipline

- Save durable facts (decisions, client setups, how things work) to memory as they are learned; never store secrets.
- Never git commit or push without Ivans explicit approval for that specific change.
- No comments in deployment manifests or config files (yaml/json/toml/env-style); strip existing comments when editing them.
- Prefer delegation for substantial work; the main session plans, aggregates and reports.