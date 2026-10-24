# opencode-statusdeck

**A combined, modified OpenCode V2 distribution, not an upstream original.**

This package brings together three pieces that normally live as separate
OpenCode extensions and adds behavior that none of the upstream versions
provide:

- an ordered sidebar with MCP, Budget, Context, Plugins, Skills, and Todo;
- a prompt-footer contribution with git status and provider budget;
- an optional server-side todo/auto-todo plugin.

It is maintained as a small local distribution. The package name is
`opencode-statusdeck`; no npm or GitHub release has been published yet.

The name is deliberate: the plain `opencode-sidebar` name already belongs to an
unrelated tmux sidebar launcher on npm, and "statusdeck" describes what is
actually shipped - a deck of status panels plus a status footer.

The local checkout folder is still `~/opencode-combo`; that is only a path.
Rename it whenever you like and update the two install paths below to match.

## What is combined

| Piece | Upstream | What changed here |
| --- | --- | --- |
| Sidebar | Local `oc-sidebar` implementation | Keeps the order MCP, Budget, Context, Plugins, Skills, Todo; live skill/plugin usage; used items sort upward; `+N more` expands inline; no row copy buttons. |
| Footer | `opencode-git-status` by Alexey Shirshov (MIT) | Merged into the same TUI entrypoint; keeps git and provider-budget segments; removes the extra custom path so `path:branch` appears once; option reads are defensive. |
| Auto-todo | `opencode-todolist` by aiev (MIT) | Server entry is packaged as an optional part of this package; the `todowrite`/`todoread` tools and auto-todo prompt remain. |

The coffee, ponytail, and model-picker widgets are **not bundled**. They are
separate `@rizal72` companion plugins and remain optional.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the upstream notices.
The sidebar source had no separate upstream LICENSE or README when this
distribution was assembled; verify its provenance before public
redistribution.

## Features

- Sidebar sections stay in this exact order: **MCP, Budget, Context, Plugins,
  Skills, Todo**.
- Active skills and plugins move above inactive ones and show a status dot.
  Skill usage updates as the model loads skills.
- Skills show a compact list and an inline `+N more` control instead of
  opening a separate dialog.
- Todo updates are shown in the sidebar. With **Show completed** enabled, all
  tasks are listed; bracket indicators remain visible.
- The server plugin makes the model create a short todo list for multi-step
  requests without waiting for the user to ask.
- MCP, Plugins, and Skills have no copy buttons or copy icons.
- The sidebar Budget row keeps the `Σ` session-cost marker. The bottom footer
  keeps the coffee/ponytail badges from their companion plugins and one
  `path:branch` display.
- The footer shows the provider serving the current model: for OpenRouter it
  resolves the vendor from the model id (`anthropic/claude-...` shows
  `◇ anthropic`), otherwise it shows the provider id. Clicking it opens the
  model picker, so a provider switch takes one click.
- Sidebar settings are kept under plugin id `oc-sidebar.tui` and storage key
  `oc-sidebar.settings`, matching the previous local sidebar.

## Requirements

- OpenCode V2, tested with `2.1.3` (the package uses V2 plugin APIs).
- Windows is the tested platform. The code uses `~/.local/share/opencode` for
  the OpenCode database and auth file, which is how the tested installation is
  laid out; other platforms are likely but not verified.
- `git` on `PATH` for the footer git segment.
- Provider-budget display is currently meaningful for OpenCode Go, OpenCode
  Zen, and OpenRouter. Other providers simply omit that segment.

## Install

Back up the two config files first:

```text
~/.config/opencode/cli.json
~/.config/opencode/opencode.jsonc
```

Restart OpenCode after changing plugin entries. Existing sessions, auth, MCP
configuration, and sidebar preferences are not modified by this package.

### 1. TUI sidebar and footer

Until the package is published, point `cli.json` at this local folder. Replace
the old `oc-sidebar` and `oc-git-status` entries with one entry:

```jsonc
{
  "plugins": [
    "-opencode.sidebar.context",
    "-opencode.sidebar.mcp",
    "-opencode.sidebar.todo",
    "-opencode.sidebar.footer",
    "-opencode.plugins",
    "-aiev.todolist.tui",
    "C:/Users/r00tb3/opencode-combo"
  ]
}
```

When the package is published, replace the last entry with the pinned package
name, for example:

```jsonc
"opencode-statusdeck@0.2.0"
```

The package's plugin id remains `oc-sidebar.tui`, so the previous sidebar
settings file can be reused.

### 2. Optional auto-todo server

Add the package to `opencode.jsonc` only if you want the `todowrite` /
`todoread` tools and the automatic todo prompt:

```jsonc
{
  "plugins": ["C:/Users/r00tb3/opencode-combo"]
}
```

When published, use the same pinned package name:

```jsonc
{
  "plugins": ["opencode-statusdeck@0.2.0"]
}
```

Remove the old `opencode-todolist` server entry and the old
`aiev.todolist.tui` TUI entry. Do not load both the old plugin and this
package; they register the same todo tools.

The TUI-only install is valid: skip step 2 and keep using your existing todo
tools. The sidebar still renders whatever todo data is already in the session
store.

## Settings and compatibility

- Plugin id: `oc-sidebar.tui`
- Settings key: `oc-sidebar.settings`
- Existing settings such as `showCompleted` and section expansion are
  expected to survive the switch because the id and key are unchanged.
- The footer reads `interval` from plugin options; the default is 2500 ms.
  A value below 500 ms is clamped to the default.

## Rollback

1. Restore `cli.json` and `opencode.jsonc` from your backup.
2. Remove the package entry from both files.
3. Restart OpenCode.

The package does not delete sessions, auth, MCP state, or settings. The local
backup used during packaging is in
`C:\Users\r00tb3\opencode-combo-backup-20261024-115256`.

## Development

```bash
bun run build       # builds dist/tui.js from src/tui.tsx
npm pack --dry-run  # inspect the published files
npm pack            # create the installable tarball
```

The server side is currently shipped from the prebuilt `dist/server` output
and its vendored source in `src/server`. The TUI build externalizes the host
packages (`@opencode/plugin/tui`, `solid-js`, `@opentui/*`) so OpenCode
provides them at runtime. Local-directory installs use the root `index.ts` and
`tui.tsx` shims; npm installs use the package export map.

## Known limitations

- V2-only; this is not a V1 plugin.
- The Windows-tested install assumes OpenCode's data and auth files are under
  `~/.local/share/opencode`.
- The provider-budget segment depends on provider-specific endpoints and
  credentials.
- Auto-todo is a model instruction, not a deterministic scheduler; behavior
  depends on the active model following the prompt.
- The package is local-only until a release name, scope, and provenance review
  are approved.

## License

MIT for this distribution. Upstream MIT notices are reproduced in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
