# Security policy

Do not open a public issue for a vulnerability, an exposed credential, or a report that contains export content.

Email `security@calven.ai` with the affected file, the observed and expected behavior, reproduction steps with secrets removed, and the practical impact.

## How the tool handles access

- It uses only Crayon's official MCP server and, if you pass a key, Crayon's official Insights API. It never opens or scrapes the Crayon web app.
- It signs in through Crayon's own OAuth server with PKCE, on a redirect to `127.0.0.1`, asking for the read-only `mcp:read` scope.
- Tokens, the registered client and any Insights API key stay in memory and are never written to disk. Calven never receives them.
- After an OAuth export the tool revokes its tokens, and says so if the server does not allow it. An access token or Insights API key you pass is left alone.
- Each sign-in registers a new OAuth client with Crayon, named `calven-migrate-from-crayon`. Once its tokens are revoked it holds no access.
- The local sign-in page only acts on a request carrying the state this run created; any other request gets an error reply and changes nothing.
- Every OAuth endpoint the server names, and the Insights API URL, must use https. The Insights API key is never sent to a host other than the one in `--insights-url`, even if a response points there.
- It talks only to Crayon and writes only to the output folder. It sends nothing to Calven.
