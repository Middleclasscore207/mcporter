# CLI Help Menu Snapshot
```
mcporter mcp
Usage: mcporter mcp [options] <command>

Manage configured MCP servers, imports, and ad-hoc discoveries.

Commands:
  list [options] [filter]        Show merged servers (local + imports + ad-hoc cache)
  get <name>                     Inspect a single server with resolved source info
  add [options] <name> [target]  Persist a server definition (URL or stdio command)
  remove [options] <name>        Delete a local entry or copy from an import
  import <kind> [options]        Copy entries from cursor/claude/codex/etc. into config
  login <name|url>               Complete OAuth/auth flows for a server
  logout <name>                  Clear cached credentials for a server
  doctor [options]               Validate config files and report common mistakes
  help [command]                 Show CLI or subcommand help

Global Options:
  --config <path>                Use an explicit config file (default: config/mcporter.json)
  --root <dir>                   Set project root for import discovery (default: cwd)
  --json                         Emit machine-readable output when supported
  -h, --help                     Display help for mcporter mcp

Run `mcporter mcp help add` to see transport flags, ad-hoc persistence tips, and schema docs.
See https://github.com/sweetistics/mcporter/blob/main/docs/config.md for config anatomy, import precedence, and troubleshooting guidance.
```

# Configuration Documentation Plan

## Entry: CLI Help Experience
1. **Help Menu Blueprint**
   - Show `mcporter mcp --help` first: include short blurb on automatic discovery and where config files live.
   - Each subcommand help (`list`, `add`, `remove`, `import`, `login`, `logout`, `doctor`) should include:
     - Inputs (positional + flags), default sources (local config, imports, ad-hoc), and whether the command mutates disk.
     - Examples combining Codex-style positional syntax and Claude-style explicit transports.
   - Add a shared “See also” footer pointing to docs sections for schema, imports, and ad-hoc workflows.
2. **In-CLI Guidance Hooks**
   - When `mcporter mcp add` runs without args, the help text should reference the relevant doc anchors (e.g., `docs/config.md#server-entry-anatomy`).
   - Error messages should include short `mcporter mcp help <verb>` hints so the CLI stays self-documenting.

### Subcommand Parameters
- **list [filter]**
  - `filter`: optional server name, slug, or import source (`source:cursor`) to narrow results.
  - Flags: `--source <local|import|adhoc>`, `--include-schema`, `--json`, `--auto-authorize/--no-auto-authorize`, `--timeout <ms>`, plus ad-hoc selectors shared with other verbs (`--http-url`, `--stdio`, `--stdio-arg`, `--allow-http`, `--env KEY=VAL`, `--cwd <dir>`, `--name <slug>`, `--persist <path>`).
- **get <name>**
  - `name`: required server identifier (local or imported). Accepts URL/stdio descriptors for ad-hoc entries.
  - Flags: `--json`, `--show-source` (reveal path and import stack), `--include-schema`, `--reveal-secrets` (requires explicit confirmation), ad-hoc selectors (`--http-url`, `--stdio`, `--stdio-arg`, `--allow-http`, `--env`, `--cwd`, `--name`, `--persist`).
- **add <name> [target]**
  - `name`: slug to persist. Required.
  - `target`: optional URL or stdio command shortcut; positional to match Codex UX.
  - Flags:
    - `--transport <http|sse|stdio>` (default auto-detect from `target`).
    - `--url <https://…>` or `--command <bin>` with trailing `-- args`; `--stdio`, `--stdio-arg`, `--cwd`, `--allow-http` mirror today’s ad-hoc flags.
    - `--env KEY=VAL`, `--header KEY=VAL`, `--token-cache-dir`, `--description`, `--tag label`, `--client-name`, `--oauth-redirect-url`.
    - `--persist` (explicit path), `--dry-run`, `--yes` to skip prompts, `--copy-from <importKind:name>`.
- **remove <name>**
  - `name`: required; supports `importKind:name` syntax to remove a copied entry.
  - Flags: `--source <local|import>`, `--dry-run`, `--json`, `--yes`.
- **import <kind>**
  - `kind`: one of `cursor`, `claude-code`, `claude-desktop`, `codex`, `windsurf`, `vscode`.
  - Flags: `--path <file>` (override auto-detected file), `--filter <glob>` (select subset), `--copy` (write into local config), `--json`.
- **login <name|url>**
  - Argument accepts registered server names or ad-hoc descriptors (URL/stdio).
  - Flags: `--browser <default|none>`, `--json`, `--force` to re-run OAuth, `--persist` to save inferred settings, ad-hoc selectors (`--http-url`, `--stdio`, `--stdio-arg`, `--env`, `--cwd`, `--allow-http`, `--name`).
- **logout <name>**
  - `name`: server slug.
  - Flags: `--json`, `--all` to clear every cached token.
- **doctor**
  - Flags: `--fix` (auto-correct schema issues), `--json`, `--include-imports`, `--warn-only`.

## Detailed Explanation
### Purpose and Audience
- Equip contributors with a mental model for mcporter’s **auto-detect** stack: repo config, imported editor configs, and ad-hoc CLI selectors.
- Outline how persistence, OAuth promotion, and token caching behave so engineers can move from experimentation to committed JSON confidently.
- Highlight differences vs. Cursor/Claude/Codex semantics to ease migration.

### Proposed Content Flow
1. **Orientation & Quick Start**
   - Minimal `config/mcporter.json` sample.
   - Bullet summary of discovery sources and when each is used.
   - Link to `docs/adhoc.md` for live experimentation.
2. **Discovery & Precedence**
   - Search order (`--config`, repo defaults, `$MCPORTER_CONFIG`, imports, ad-hoc has highest priority for the current session).
   - Table marking read-only vs writable layers and how tie-breaking works.
3. **Ad-hoc & Auto-Persistence**
   - Behavior of `--http-url`, `--stdio`, bare URLs, slug derivation, OAuth upgrades, and `--persist`.
   - How persisted entries fold back into `mcpServers`.
4. **Schema Overview**
   - Top-level keys with descriptions (`mcpServers`, `imports`, `tokenCacheDir`, tags).
   - Interpolation syntax and inheritance.
5. **Server Entry Anatomy**
   - Transport-specific fields with validation cues.
   - Security recommendations for env/header usage and token cache placement.
6. **Imports & Auto-Merge**
   - Source paths per import kind, priority ordering, and override semantics.
   - Guidance on copying import entries locally (new CLI helper).
7. **CLI Management (`mcporter mcp …`)**
   - Summaries of each verb, including help snippets and examples reflecting both concise and explicit styles.
8. **Project vs. Machine Layers**
   - Repo layout advice, machine-specific overrides, CI considerations, and token storage.
9. **Validation & Troubleshooting**
   - Runtime warnings, `autoAuthorize` behavior, and the envisioned `mcporter config doctor`.
10. **Appendix & References**
    - Links to schema files, migration docs, call syntax, and adhoc references.

## Implementation Plan
1. Finalize help menu copy directly in the CLI, ensuring anchors exist in `docs/config.md`.
2. Draft the detailed sections per the flow above, pulling examples from `config/mcporter.json` and `docs/adhoc.md`.
3. Cross-link README, `docs/call-syntax.md`, and CLI help to the new doc.
4. Add regression tests (snapshot or golden files) to keep help text and docs in sync once the CLI verbs land.

## Outstanding Coverage Items
- Document how `--persist` reuses the same merge pipeline (`pathsForImport`) so users understand which file is mutated when persisting ad-hoc or imported servers.
- Emphasize that `--allow-http` is mandatory for cleartext URLs and that `--env KEY=VAL` entries merge with (and override) config-defined `env`.
- Spell out the automatic OAuth promotion for ad-hoc HTTP servers (see `docs/adhoc.md`) and ensure `mcporter mcp login` help text reflects that behavior.

## Import Locations Reference
- **Codex (`codex`)**: mcporter reads Codex servers exclusively from `.codex/config.toml`—first from the project root, then from the user’s home directory (e.g., `~/.codex/config.toml`). The legacy `.codex/mcp.toml` filename is no longer consulted, so users must follow Codex’s documented default.
