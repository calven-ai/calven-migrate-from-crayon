---
name: migrate-from-crayon
description: Export what the user's Crayon account knows about every competitor (battlecard, objection handling, proof points, win/loss stories, profile) into a crayon-export-<date> folder on their machine, as Markdown and JSON with Crayon's citations, with calven-migrate-from-crayon or through the Crayon MCP connector. Use when the user asks to export, back up, download, move or migrate their Crayon battlecards or competitive intelligence, or to move off Crayon, including users who are not technical.
---

# Export everything from Crayon

The goal is a complete `crayon-export-<date>` folder on the user's computer. The user may not be technical: explain each step in plain language, give exact clicks, never ask for passwords, tokens or API keys in the chat, and keep going until every question has been asked about every competitor. The full guide, with the question text, the folder layout and troubleshooting, is https://github.com/calven-ai/calven-migrate-from-crayon/blob/main/MIGRATION.md

Tell the user once, before starting: a Crayon export is partial. Crayon's MCP server answers questions and has no documented tool to list or extract battlecards, so the folder holds Crayon's answers to fixed questions, with citations, not the raw cards. Use only Crayon's official MCP server or API; never open or scrape the Crayon web app.

## If you can run commands on the user's computer (preferred)

Use this even when a Crayon connector is also connected: it keeps every raw reply, writes the coverage report and does not run into chat limits.

1. Check `node --version` is 20 or later. If not, walk the user through installing the LTS version from nodejs.org, then check again.
2. Save to `crayon-export-<date>` in their Documents folder unless they named a place. Ask whether they want every competitor or a named list; pass a list with `--competitors "A, B"`.
3. Run `npx github:calven-ai/calven-migrate-from-crayon --out <folder>` in the background, or with a timeout of at least 30 minutes: the browser sign-in alone can take minutes, and every answer is generated on request. Tell the user first that a browser tab will open for the Crayon sign-in and to approve it.
4. If the user has a Crayon Insights API key and the list URL from their Crayon admin, ask them to set `CRAYON_INSIGHTS_KEY` in their own shell first, then add `--insights-url <url>`. Never put a key or token on the command line. Without the URL, say Crayon has not published the endpoint docs yet.
5. When it finishes, read `<folder>/manifest.json` and `<folder>/coverage.md`. Report in plain words the number of competitors, how many answers came back `answered`, `no_content` and `error`, and any warnings. Do not open answer files unless the user asks.
6. If it fails with `Could not find a tool on the server that takes a question` or `needs arguments this tool does not fill in`, run `npx github:calven-ai/calven-migrate-from-crayon inspect --force`, read `crayon-tools.json`, and rerun with `--ask-tool`, `--question-arg` or `--arg name=value`. Explain the value you chose.

## If you can only use the Crayon connector

Build the same folder from the connector's replies. Copy, never rewrite: no summarising, merging, reordering or cleaning up, and keep every citation.

1. Find the connector tool that takes a question, and note its question argument.
2. Get the competitor list from a tool that lists competitors, or by asking the list question in the guide. Show the user the names and the plan (competitors times five questions) before asking anything else.
3. Ask the five questions from the guide word for word about each competitor. Write every reply exactly as returned, with the arguments sent, to `raw/answers/<competitor>/<question-id>.json` with code before using it.
4. Build `answers.json`, `markdown/` (front matter, the question, the answer and its citations, one file per answer, grouped by competitor, with an `index.md`), `coverage.md` and `manifest.json` from `raw/` with a script, not by retyping. Records follow the `calven-export/v1` schema in the repo's `docs/schema.md`, with `origin: crayon_output`.
5. Work one competitor at a time and report progress. If the chat runs long, save what is done and continue in a new chat.
6. Check that every competitor has one raw file per question; list any gap in `manifest.json` warnings and as `not asked` in `coverage.md`.
7. If the folder is not already on the user's computer (as it is in Cowork), zip it and give them the download link.

Tell the user once: answers are Outputs of Crayon's AI tools, which Crayon's terms let them use for internal business purposes. They should check the gaps in `coverage.md` against Crayon before cancelling, and delete third-party material when the Crayon contract ends.
