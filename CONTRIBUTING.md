# Contributing

Thanks for taking a look. This is a single-author plugin for OpenCode V2, and
small, focused changes are the easiest to review.

## Before you start

- Open an issue for anything larger than a typo or a small fix, so the shape of
  the change is agreed before code is written.
- Check that the host still exposes the slots this plugin uses
  (`sidebar.content`, `sidebar.footer`, `prompt.footer.status`). A missing slot
  is a host change, not a plugin bug.

## Working on it

```bash
git clone <this repo>
cd opencode-sidebar-tui
npm run pack:check
```

There is no build step. OpenCode loads `src/tui.tsx` and transpiles it itself.
Never commit a prebuilt TUI bundle: bundling ahead of time turns reactive
children into one eager render and every list comes out empty.

To try a change, point a development OpenCode config at the checkout:

```json
{ "plugins": ["C:/path/to/opencode-sidebar-tui"] }
```

Restart OpenCode for the TUI half to reload. The plugin writes a trace to
`%TEMP%\oc-sidebar.log` on Windows, which is the quickest way to see whether it
loaded and what data it found.

## Style

- TypeScript, tabs for indentation, no semicolon-heavy style changes.
- Keep the sidebar at 42 columns in mind: every row must stay readable when the
  host pane is narrow. Long text wraps or truncates with `…`, never overflows.
- Use the existing marker vocabulary rather than inventing new glyphs.
- Prefer deleting code to adding options. This plugin is display-only; new
  configuration needs a clear user-facing reason.
- Comments explain why, not what.

## Submitting

- One change per pull request, with the reason in the description.
- Update `CHANGELOG.md` under "Unreleased" for anything user-visible.
- Include what you ran to verify it, and a screenshot of the sidebar when the
  change is visual.

## License

By contributing you agree that your changes are released under the MIT license
in [LICENSE](LICENSE).
