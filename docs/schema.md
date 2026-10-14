# calven-export/v1 schema

`answers.json` and `insights.json` are arrays of records. Every field is present; a value Crayon did not provide is `null` (or `[]` for tags and citations). The fields match the [calven-migrate-from-klue](https://github.com/calven-ai/calven-migrate-from-klue/blob/main/docs/schema.md) export, plus `question`, `status`, `citations` and `error`.

| field | type | notes |
| --- | --- | --- |
| `schema` | string | `calven-export/v1` |
| `source_system` | string | `crayon` |
| `kind` | string | `answer` (MCP server) or `insight` (Insights API) |
| `id` | string | answer: `<competitor-slug>--<question-id>`; insight: Crayon's id |
| `title` | string | answer: `<competitor>: <question label>` |
| `competitor` | object | `{ id, name }`; for an insight, the first tagged competitor (all of them stay in `source`) |
| `section` | string | answer: the question id; insight: the insight type |
| `question` | string | answer only: the exact question sent to Crayon |
| `status` | string | answer only: `answered`, `no_content` (Crayon said it had nothing) or `error` |
| `body_html` | string | the body exactly as Crayon returned it, when it is HTML |
| `body_markdown` | string | the answer exactly as Crayon returned it, or the body converted from HTML |
| `citations` | object[] | answer only: `{ title, url, snippet }`, from Crayon's citation fields, resource links and links in the answer text |
| `tags` | string[] | |
| `url` | string | insight: the source link |
| `author` | string | insight: author, owner or reviewer role |
| `origin` | string | `crayon_output`, `customer`, `crayon_or_third_party` or `unknown`; see the README |
| `created_at`, `updated_at` | string | answer: when it was asked; insight: as Crayon formats them |
| `error` | string | answer only: why the question failed |
| `source` | object | the full response or item as Crayon returned it |

Fields are matched by name across the spellings vendors use (`updated_at`, `updatedAt`). An insight with no body field gets a Markdown file that shows the whole item as JSON.
