# Changelog

## Unreleased

- `MIGRATION.md`: a guide Claude follows end to end, so a user with no terminal experience ends up with the export folder on their laptop. Covers running the CLI, and asking the same questions through the Crayon MCP connector in Cowork, claude.ai or the desktop chat.
- README: a copy-paste prompt for non-technical users and the three ways Claude can run the export.
- migrate-from-crayon skill: adds the connector path, built from saved replies with code rather than retyped.

## 0.1.0

- Crayon export through the official MCP server: five questions per competitor (battlecard, objection handling, proof points, win/loss stories, profile), answers kept verbatim with citations, raw responses archived, coverage report.
- The ask tool, its question argument and the competitor list are discovered at runtime; `--ask-tool`, `--question-arg`, `--list-tool`, `--competitors` and `--questions-file` override them.
- Optional Insights API path (`--insights-key`, `--insights-url`) built as an adapter, pending Crayon's endpoint docs. Pages by next link, cursor or page number.
- Browser sign-in with OAuth and PKCE, or an access token. Tokens revoked after export.
- `inspect` writes the server's tool list without exporting content.
