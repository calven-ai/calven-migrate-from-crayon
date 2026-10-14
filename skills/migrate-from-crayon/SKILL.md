---
name: migrate-from-crayon
description: Export the user's own Crayon battlecard content, objection handling, proof points, win/loss stories and competitor profiles to Markdown and JSON files on their machine with calven-migrate-from-crayon. Use when the user asks to export, back up, download or migrate their Crayon battlecards or competitive intelligence, or to move off Crayon.
---

# Export Crayon battlecards and competitive intel

Run the export as a command. Do not ask Crayon questions through a Crayon connector and write the answers out yourself: that paraphrases, drops citations and runs out of context on large workspaces.

1. Check `node --version` is 20 or later. If not, tell the user to install Node.js and stop.
2. Ask where to save the export if the user has not said. Default: `./crayon-export-<date>`. Ask whether they want every competitor or a named list; pass a list with `--competitors "A, B"`.
3. Run `npx github:calven-ai/calven-migrate-from-crayon --out <folder>` in the background, or with a timeout of at least 30 minutes: the browser sign-in alone can take minutes, and every answer is generated on request. A browser tab opens for the Crayon sign-in; tell the user to approve it.
4. If the user has a Crayon Insights API key and the list URL from their Crayon admin, ask them to set `CRAYON_INSIGHTS_KEY` in their own shell first, then add `--insights-url <url>`. Never ask for a key or token in the chat or put it on the command line. Without the URL, say Crayon has not published the endpoint docs yet.
5. When it finishes, read `<folder>/manifest.json` and `<folder>/coverage.md`. Report the counts, how many answers came back `answered`, `no_content` and `error`, and any warnings. Do not open answer files unless the user asks.
6. If it fails with `Could not find a tool on the server that takes a question` or `needs arguments this tool does not fill in`, run `npx github:calven-ai/calven-migrate-from-crayon inspect --force`, read `crayon-tools.json`, and rerun with `--ask-tool`, `--question-arg` or `--arg name=value`. Explain the value you chose.

Tell the user once: a Crayon export is partial. It holds Crayon's answers to fixed questions, not the raw cards, so they should check the gaps in `coverage.md` against Crayon before cancelling.
