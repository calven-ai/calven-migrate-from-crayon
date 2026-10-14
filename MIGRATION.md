# Export everything from Crayon with Claude

This guide gets what your Crayon account can tell you about every competitor (battlecard, objection handling, proof points, win/loss stories, profile) into a folder on your laptop, without you touching a terminal. It is written to be read by a person and followed by an AI assistant such as Claude at the same time.

**Not technical?** You don't need to read all of this. Paste the prompt from [Start here](#start-here) into Claude and it does the work, checking with you along the way.

**A Crayon export is partial.** Crayon's MCP server answers questions; it has no documented tool to list or extract battlecards. The folder holds Crayon's answers to a fixed set of questions per competitor, word for word with Crayon's citations, not the raw cards. `coverage.md` shows which questions got an answer.

> This is an independent open-source project by Calven AI, LLC, not affiliated with, endorsed by or sponsored by Crayon, Inc. The full disclaimer is in the [README](README.md#disclaimer).

## Start here

Copy this into a new chat with Claude, then answer its questions:

```text
I want to migrate my battlecards and competitive intel out of Crayon into a
folder on my laptop. Follow the guide at
https://github.com/calven-ai/calven-migrate-from-crayon/blob/main/MIGRATION.md
I'm not technical, so explain each step in plain language and tell me
exactly what to click.
```

At the end you have one folder, `crayon-export-<date>`, laid out as described in [What you end up with](#what-you-end-up-with).

## For the AI assistant

If a user gave you this repository or this file, your job is to leave them with a complete export folder on their own computer. They may never have used a terminal. Follow these rules for the whole session.

1. **Finish the job.** Keep going until every question has been asked about every competitor and `coverage.md` is complete. Don't stop at a sample or ask the user to do the repetitive part.
2. **Copy, never rewrite.** Crayon's answers move exactly as Crayon returns them, citations included. Don't summarise, merge, reorder, translate or "clean up". If you can't copy something exactly, leave it out and list it in the warnings.
3. **Ask the questions as written.** Use the question text in [The questions](#the-questions) word for word, so the folder matches what the export program produces.
4. **Plain language, one step at a time.** Say "a program on your computer", not "CLI". Give exact clicks or one command, then wait.
5. **Never ask for passwords, tokens or API keys in the chat.** Sign-ins happen in the user's own browser.
6. **Say plainly that the export is partial.** It holds Crayon's answers, not the raw cards. Point the user at the gaps in `coverage.md` before they cancel Crayon.
7. **Use only Crayon's official MCP server or API.** Never open, click through or scrape the Crayon web app: Crayon's terms forbid scripts that scrape its Services.
8. **Make no claims about Crayon** beyond what this guide and Crayon's published terms say.

## Choose your path

Work out which situation you are in, and take the first that fits.

| You are | Path | Where the folder appears |
| --- | --- | --- |
| Claude Code, or the Code tab of the Claude desktop app (you can run commands on the user's computer) | **A. Run the export program** | Directly on the laptop |
| Claude in Cowork, with the Crayon connector and a folder on the user's computer shared with you | **B. Ask through the Crayon connector** | Directly in the shared folder |
| Claude in claude.ai or the desktop chat, with the Crayon connector | **B. Ask through the Crayon connector** | A zip the user downloads and double-clicks |
| None of these, or no Crayon connector | Help the user add the connector (below), then Path B | |

Prefer Path A when it is available, even if a Crayon connector is also connected. The program asks every question on its own, keeps Crayon's raw replies and citations, writes the coverage report, and large workspaces don't run into chat limits. It is also the only path for the optional Insights API. Path B works anywhere Claude has the Crayon connector, but you are copying the answers yourself, so follow its rules closely.

**Adding the Crayon connector.** In Claude: **Settings → Connectors → Add custom connector**. Name it `Crayon`, paste `https://mcp.crayon.co/mcp/`, click **Add**, then **Connect** and sign in to Crayon. In a new chat, enable Crayon from the tools menu. On a Team or Enterprise plan an owner may need to add it first. If sign-in fails, the user's Crayon workspace may block third-party apps; a Crayon admin can allow it.

**Who should sign in.** The answers only draw on what the signed-in Crayon account can see. A Crayon admin sees the most. Mention this once before starting.

## Path A: run the export program

The program in this repository runs on the user's computer, signs in with their own Crayon account and writes files only to their computer.

1. **Check Node.js.** Run `node --version`. If it is missing or older than 20, tell the user to install the LTS version from [nodejs.org](https://nodejs.org) (download, double-click, accept the defaults), then check again.
2. **Pick the folder.** Default: `crayon-export-<today's date>` in their Documents folder. Ask only if they seem to care. Ask whether they want every competitor or a named list; pass a list with `--competitors "Acme, Globex"`.
3. **Run it.** Run `npx github:calven-ai/calven-migrate-from-crayon --out <folder>` in the background or with a timeout of at least 30 minutes: every answer is generated on request. Tell the user first: "A browser tab will open asking you to sign in to Crayon and approve read access. Approve it, then come back here."
4. **Report.** Read `<folder>/manifest.json` and `<folder>/coverage.md` and tell the user, in plain words, how many competitors were covered, how many answers came back answered, with no content or failed, and any warnings. Remind them the export is answers, not the raw cards. Offer to open the folder for them. Don't open answer files unless asked.

If the user has a Crayon Insights API key and the list URL from their Crayon admin, ask them to set `CRAYON_INSIGHTS_KEY` in their own terminal, then add `--insights-url <url>`. Never ask for the key in the chat. Without the URL, say Crayon has not published the endpoint docs yet. For errors, see [When something goes wrong](#when-something-goes-wrong).

## Path B: ask through the Crayon connector

Build the same folder the program would, using the Crayon connector's tools and your file or code tools. The aim is that the user can't tell which path produced it.

1. **Look at the tools.** List the Crayon connector's tools and pick the one that takes a question. Note the name of its question argument, and whether it also takes a competitor name.
2. **Get the competitor list.** Use a tool that lists competitors if there is one. Otherwise ask the question tool the list question in [The questions](#the-questions). Show the user the names and the plan (competitors times five questions) and let them add or remove names before you start.
3. **Save Crayon's replies as they come.** For every question you ask, write the tool's reply exactly as returned, with the arguments you sent, to `raw/answers/<competitor>/<question-id>.json` with code, before doing anything else with it. These files are the source of truth for the rest of the steps.
4. **Build the files from `raw/`, with code.** Write a short script that reads `raw/` and produces `answers.json`, the Markdown files, `coverage.md` and `manifest.json` in the layout below. Doing it with a script, not by retyping, is what keeps the answers and citations exact. Mark an answer `no_content` when Crayon says it has nothing, and `error` when the tool fails.
5. **Work in batches.** Go one competitor at a time. After each, tell the user how far along you are. If the chat gets long, save what is done and say how to continue in a new chat from the next competitor.
6. **Reconcile.** Every competitor needs one raw file per question. Any missing question goes in `warnings` with the competitor name, and shows as `not asked` in `coverage.md`.
7. **Hand it over.** In Cowork, the folder is already on the laptop; say where. In a chat, zip the folder and give the user the download link, then tell them: "Click the link, then double-click the zip to open the folder."

## The questions

Replace `{competitor}` with the competitor's name. These match what the export program asks.

| id | question |
| --- | --- |
| `battlecard` | Give me the full battlecard for {competitor}: every section and talking point, as written in Crayon. |
| `objection-handling` | What objections do prospects raise when they compare us with {competitor}, and how should a rep handle each one? |
| `proof-points` | What customer proof points, case studies and quotes do we have against {competitor}? |
| `win-loss-stories` | What win and loss stories do we have against {competitor}? Include the deal, the outcome and the reasons. |
| `profile` | Give me the competitor profile for {competitor}: overview, products, pricing, positioning, strengths, weaknesses and recent news. |

The list question, only if no tool lists competitors: "List the name of every competitor tracked in this Crayon account. Reply with one competitor name per line and nothing else."

## What you end up with

```
crayon-export-2026-10-14/
  manifest.json      counts, tools used, coverage, origin counts, warnings
  coverage.md        which question got an answer for which competitor
  answers.json       every answer
  markdown/
    index.md         table of contents by competitor
    answers/<competitor>/<question-id>.md
  raw/               Crayon's reply to every question, with the arguments sent
```

Each Markdown file starts with front matter (title, competitor, question, status, origin, date), then the question asked, the answer exactly as Crayon returned it and a list of its citations. The JSON records follow [docs/schema.md](docs/schema.md). Path A also writes `tools.json`, the tools Crayon's server offered, and with the Insights API, `insights.json` and `markdown/insights/`.

Every answer carries `origin: crayon_output`: Crayon's terms let the customer use Outputs of Crayon's AI tools for internal business purposes. Insights from the Insights API are marked `customer` (win/loss, deals, call clips), `crayon_or_third_party` (reviews, news, web content) or `unknown`. Tell the user once: check items before reusing them outside the company, and delete third-party material when the Crayon contract ends.

## When something goes wrong

| What you see | What it means | What to do |
| --- | --- | --- |
| `node: command not found` | Node.js isn't installed | Install the LTS version from nodejs.org, then try again |
| The browser tab never opens | The program can't reach a browser | Rerun with `--no-browser` and open the printed link in any browser on the same computer |
| Sign-in fails, or Crayon says the app isn't allowed | The Crayon workspace blocks third-party apps | Ask a Crayon admin to allow it |
| `Could not find a tool on the server that takes a question` | Crayon's tools are named differently than expected | Run `npx github:calven-ai/calven-migrate-from-crayon inspect --force`, read `crayon-tools.json`, rerun with `--ask-tool <name>` (and `--question-arg <name>`) and explain the choice |
| `needs arguments this tool does not fill in` | Crayon's server wants an extra setting | Find it in `crayon-tools.json`, rerun with `--arg name=value` and explain the value chosen |
| `did not return a competitor list` | Crayon gave no list | Ask the user for the names and rerun with `--competitors` |
| Many answers marked `no content` | The signed-in role sees little, or Crayon has nothing on those questions | Ask a Crayon admin to run it; check the gaps in Crayon before cancelling |
| The chat gets slow or forgets earlier answers (Path B) | The workspace is too big for one chat | Save what is done, start a new chat with the same prompt and continue from the next competitor |

If counts or coverage look wrong, [open an issue](https://github.com/calven-ai/calven-migrate-from-crayon/issues) with `manifest.json` or `coverage.md` (no answer content).
