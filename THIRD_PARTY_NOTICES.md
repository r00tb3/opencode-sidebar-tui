# Third-party notices

This repository is a combined, modified distribution. It is not an original
upstream package. The following MIT-licensed works are included in source or
built form.

## opencode-git-status

- Author: Alexey Shirshov
- Source: https://github.com/AlexeyShirshov/skills/tree/main/opencode/plugins/git-status
- License: MIT
- Used for: the prompt-footer git and provider-budget segments.

MIT License

Copyright (c) 2026 Alexey Shirshov

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## opencode-todolist

- Author: aiev
- Source: https://github.com/aiev/opencode-todolist
- License: MIT
- Used for: the optional `todowrite` / `todoread` server plugin and the
  auto-todo prompt. The server entry is modified to support the combined
  package layout.
- Included source: `src/server` and `dist/server`.

MIT License

Copyright (c) 2026 aiev

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Sidebar implementation

The ordered sidebar code in `src/sidebar` is the local implementation used for
this combined build. No separate upstream license file was present in the
local source when this package was assembled. Verify its provenance before
public redistribution.

## Optional companion plugins

These are not bundled in this package. They are separate MIT-licensed
`@rizal72` plugins used by the author's local OpenCode setup:

- `@rizal72/oc-coffee`
- `@rizal72/oc-ponytail-widget`
- `@rizal72/oc-models-pro`

Install them separately if you want the coffee, ponytail, and model-picker
badges.
