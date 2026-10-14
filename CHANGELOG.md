# Changelog

## 0.1.0

- Crayon export through the official MCP server: five questions per competitor (battlecard, objection handling, proof points, win/loss stories, profile), answers kept verbatim with citations, raw responses archived, coverage report.
- The ask tool, its question argument and the competitor list are discovered at runtime; `--ask-tool`, `--question-arg`, `--list-tool`, `--competitors` and `--questions-file` override them.
- Optional Insights API path (`--insights-key`, `--insights-url`) built as an adapter, pending Crayon's endpoint docs. Pages by next link, cursor or page number.
- Browser sign-in with OAuth and PKCE, or an access token. Tokens revoked after export.
- `inspect` writes the server's tool list without exporting content.
