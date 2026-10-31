# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0]

### Added

- Footer shows the provider serving the current model; clicking it opens the
  model picker, so switching providers takes one click.
- Sidebar and footer are a single installable package with one entry point.

### Changed

- Package renamed to `opencode-sidebar-tui`.
- Sidebar redesigned: uppercase section labels, actions beside the label,
  counts pinned to the right edge, content indented one column, and a thin rule
  between sections.
- One marker vocabulary across every list: `•` active, `·` idle, `x` done,
  `*` pinned.
- MCP rows show the server name only, with usage moved to a quiet right-hand
  meta column; plugin rows do the same.
- Counts are single numbers (`13`) instead of fractions (`13/160`).
- Todo task text wraps instead of truncating, so long tasks stay readable.

### Fixed

- Skill dots appeared minutes after a skill was loaded. The message index only
  re-scanned the newest message, so a skill call written into an earlier
  message was never counted until the turn ended. Every message is now checked
  as it grows, with each tool call counted exactly once.
- Sidebar symbols had been flattened to `?` and U+FFFD by a lossy write; the
  damaged glyphs were replaced with characters that always render.
- Section rules wrapped on narrow panes and dropped a stray dash onto the next
  line.
- Budget panel printed the low-budget warning twice, once as a colour and once
  as text.

## [0.2.0]

### Added

- Provider chip in the footer with OpenRouter vendor resolution.

### Changed

- Package renamed to `opencode-statusdeck`.

## [0.1.0]

### Added

- Ordered sidebar with MCP, Budget, Context, Plugins, Skills and Todo.
- Git status and provider budget footer.
- Optional server-side todo and auto-todo plugin.
