# CLI Commit

A VS Code extension that adds a ✨ sparkle next to the Git commit message box. Click it to generate a commit message from your staged diff using the **Claude CLI** or **Codex CLI** you already have installed — no extra API keys.

- Sparkle on the Source Control commit field
- Claude or Codex, with any model the CLI accepts — no fixed list to go stale
- Recent commits included so the model can match this repository's style
- Optional workspace instructions in the system prompt for repo-specific conventions
- Tools, MCP servers, and skills disabled so the call stays cheap and non-interactive
- Falls back to the other CLI if the selected one hits a rate, session, or usage limit

## Requirements

- VS Code 1.90 or later
- A Git repository
- Either:
  - [Claude Code](https://code.claude.com/docs) CLI (`claude`) authenticated, or
  - [Codex CLI](https://github.com/openai/codex) (`codex`) authenticated

## Use

1. Open this folder in VS Code, run `npm install`, then `npm run compile`.
2. Press F5 (**Run Extension**) to launch an Extension Development Host.
3. Stage some changes, open Source Control, and click the ✨ next to the commit message box.
4. Review the generated message and commit as usual.

You can also run **CLI Commit: Generate Commit Message** from the Command Palette.

## Choosing a model

Both model settings are free text passed straight to the CLI, so a new model never needs an
extension update. Run **CLI Commit: Select Model** from the Command Palette to pick one for the
active provider; it writes your choice to user settings and always offers a custom-id entry.

For Claude, prefer the aliases `haiku`, `sonnet`, `opus`, and `fable`: the CLI resolves each to
the latest model of that tier, so they never go stale. Full names like `claude-fable-5` work too.

For Codex, the picker reads `models_cache.json` from `$CODEX_HOME` (or `~/.codex`), the registry
the Codex CLI itself refreshes from the server — so new models appear without an extension
release. If that file is missing the picker falls back to a short built-in list.

`cliCommit.codexModel` takes a full id such as `gpt-5.6-terra`. Left empty (the default) the
extension reads the top-level `model` key from `config.toml`, and if that is unset omits `-m`
entirely so the CLI picks its own default. The old `sol` / `terra` / `luna` shorthands still
resolve, for settings written before 0.2.0.

For repo-specific style, set `cliCommit.instructions` in that workspace's `.vscode/settings.json`. It is appended to the system prompt and wins over matching recent-commit style when they conflict:

```json
{
  "cliCommit.instructions": "Use Conventional Commits. Prefix with JIRA-123 style tickets when the branch name has one. Imperative mood. No trailers."
}
```

## Settings

| Setting                             | Default   | Purpose                                                          |
| ----------------------------------- | --------- | ---------------------------------------------------------------- |
| `cliCommit.provider`                | `claude`  | `claude` or `codex`                                              |
| `cliCommit.claudeModel`             | `sonnet`  | Alias or full name for `claude --model`; empty = CLI default     |
| `cliCommit.codexModel`              | _(empty)_ | Model id for `codex -m`; empty = `config.toml`, then CLI default |
| `cliCommit.effort`                  | `low`     | Reasoning effort for the selected CLI                            |
| `cliCommit.instructions`            | _(empty)_ | Extra system-prompt instructions (workspace-overridable)         |
| `cliCommit.recentCommitCount`       | `8`       | Recent commit subjects included for style                        |
| `cliCommit.fallbackToUnstaged`      | `true`    | Use the working tree diff when nothing is staged                 |
| `cliCommit.fallbackToOtherProvider` | `true`    | If Claude fails, try Codex (and the reverse)                     |
| `cliCommit.timeoutSeconds`          | `90`      | How long to wait for the CLI                                     |
| `cliCommit.claudePath`              | _(auto)_  | Absolute path if VS Code cannot see `claude`                     |
| `cliCommit.codexPath`               | _(auto)_  | Absolute path if VS Code cannot see `codex`                      |
| `cliCommit.debug`                   | `false`   | Log prompts and raw CLI output                                   |

## How the CLIs are invoked

### Claude

```text
claude -p --output-format json [--model <alias>] --effort <level>
  --tools "" --restricted --strict-mcp-config --mcp-config '{"mcpServers":{}}'
  --setting-sources "" --disable-slash-commands --no-session-persistence
  --no-chrome --permission-mode dontAsk --system-prompt "<commit-message writer>"
```

The user prompt (diff, files, recent commits) is passed on stdin. Tools and MCP servers are disabled so Claude does not load skills or spend tokens on an agent session. `--bare` is not used, because that mode refuses Claude Code OAuth.

The parser reads the commit text from Claude's JSON `result` field, including when the CLI emits a stream-event array, JSONL, or assistant `message.content[].text`.

### Codex

```text
codex exec --sandbox read-only --ephemeral --ignore-user-config
  --ignore-rules --skip-git-repo-check --color never
  [-m <model>] -C <repo>
  -c model_reasoning_effort="<level>" -c mcp_servers={}
  -o <tempfile> -
```

`--ignore-user-config` skips MCP servers from `~/.codex/config.toml` while still using stored auth.
Because that also discards your default model, the extension reads the `model` key back out of
that file when `cliCommit.codexModel` is empty. The sandbox is read-only. The last agent message is read from `-o`.

If the selected provider fails — rate limits, session or usage caps, timeouts, a missing binary — the extension automatically tries the other CLI. Cancel stays cancel. Turn this off with `cliCommit.fallbackToOtherProvider`.

## Troubleshooting

- **Sparkle does nothing / CLI not found.** VS Code.app often has a thinner `PATH` than your terminal. Set `cliCommit.claudePath` or `cliCommit.codexPath` to the output of `command -v claude` / `command -v codex`.
- **Empty or garbage message.** Enable `cliCommit.debug`, then check **View → Output → CLI Commit**.
- **Authentication.** Run `claude -p "hello"` or `codex exec "hello"` in a terminal first.

## Credits

The initial Claudesona fan art was by [thebes](https://github.com/vgel).

This project is unofficial and is not affiliated with Anthropic, OpenAI, or Google.

## Licence

MIT
