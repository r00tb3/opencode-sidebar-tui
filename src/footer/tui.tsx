/** @jsxImportSource @opentui/solid */
import { execFile } from "node:child_process"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import { join } from "node:path"
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { Plugin } from "@opencode/plugin/tui"

type GitState = {
  repo: boolean
  branch: string
  detached: boolean
  upstream?: string
  ahead: number
  behind: number
  added: number
  deleted: number
  staged: number
  modified: number
  untracked: number
  conflict: number
  stash: number
}

const idle: GitState = {
  repo: false,
  branch: "",
  detached: false,
  ahead: 0,
  behind: 0,
  added: 0,
  deleted: 0,
  staged: 0,
  modified: 0,
  untracked: 0,
  conflict: 0,
  stash: 0,
}

function parse(text: string): GitState {
  const state: GitState = { ...idle, repo: true }
  for (const line of text.split("\n")) {
    if (!line) continue

    if (line.startsWith("# branch.head ")) {
      const head = line.slice("# branch.head ".length).trim()
      state.detached = head === "(detached)"
      state.branch = state.detached ? "detached" : head
      continue
    }
    if (line.startsWith("# branch.oid ")) {
      const oid = line.slice("# branch.oid ".length).trim()
      if (oid === "(initial)") state.branch = state.branch || "initial"
      else if (state.detached) state.branch = oid.slice(0, 7)
      continue
    }
    if (line.startsWith("# branch.upstream ")) {
      state.upstream = line.slice("# branch.upstream ".length).trim()
      continue
    }
    if (line.startsWith("# branch.ab ")) {
      const match = line.match(/\+(\d+)\s+-(\d+)/)
      if (match) {
        state.ahead = Number(match[1])
        state.behind = Number(match[2])
      }
      continue
    }
    if (line.startsWith("#")) continue

    const kind = line[0]
    const xy = line.slice(2, 4)
    if (kind === "1") {
      if (xy[0] === "A") state.added++
      else if (xy[0] === "D") state.deleted++
      else if (xy[0] !== ".") state.staged++
      if (xy[1] !== ".") state.modified++
    } else if (kind === "2") {
      state.staged++
      if (xy[1] !== ".") state.modified++
    } else if (kind === "u") {
      state.conflict++
    } else if (kind === "?") {
      state.untracked++
    }
  }
  return state
}

const AUTH_FILE = join(homedir(), ".local", "share", "opencode", "auth.json")
const DB_FILE = join(homedir(), ".local", "share", "opencode", "opencode.db")
const USAGE_URL = "https://opencode.ai/zen/go/v1/usage"
const GO = "opencode-go"
const ZEN = "opencode"

type FooterBudget = {
  label: string
  percent: number
  tone: "success" | "warning" | "error"
}

function readJson(path: string): any {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    return undefined
  }
}

function openRouterKey(): string | undefined {
  const key = readJson(AUTH_FILE)?.openrouter?.key
  return typeof key === "string" && key.length > 0 ? key : undefined
}

function authKey(id: string): string | undefined {
  const key = readJson(AUTH_FILE)?.[id]?.key
  return typeof key === "string" && key.length > 0 ? key : undefined
}

function loadBunDatabase(): any {
  const attempts: Array<() => any> = [
    () => (import.meta as any).require?.("bun:sqlite"),
    () => (globalThis as any).require?.("bun:sqlite"),
    () => createRequire(import.meta.url)("bun:sqlite"),
    () => (Function("return require")() as any)("bun:sqlite"),
  ]
  for (const attempt of attempts) {
    try {
      const mod = attempt()
      if (mod?.Database) return mod.Database
    } catch {
      // try the next driver shape
    }
  }
  return null
}

function readDbKeys(): Record<string, string> {
  try {
    const Database = loadBunDatabase()
    if (!Database) return {}
    const db = new Database(DB_FILE, { readonly: true })
    const out: Record<string, string> = {}
    for (const row of db.query("SELECT integration_id, value FROM credential").all() as any[]) {
      const id = String(row.integration_id ?? "").trim()
      const key = JSON.parse(String(row.value ?? ""))?.key
      if (id && typeof key === "string" && key.trim()) out[id] = key.trim()
    }
    try {
      db.close?.()
    } catch {
      // already closed
    }
    return out
  } catch {
    return {}
  }
}

function apiKeys(): string[] {
  const db = readDbKeys()
  const keys = [ZEN, GO].map((id) => db[id] ?? authKey(id)).filter((key): key is string => Boolean(key))
  return [...new Set(keys)]
}

async function readGoUsage(): Promise<{ usage?: { rolling?: any; weekly?: any; monthly?: any } } | undefined> {
  for (const key of apiKeys()) {
    try {
      const response = await fetch(USAGE_URL, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) continue
      const payload: any = await response.json()
      const usage = payload?.usage
      if (usage?.rolling || usage?.weekly || usage?.monthly) return { usage }
    } catch {
      // try the next workspace key
    }
  }
  return undefined
}

function tightestWindow(usage: { usage?: { rolling?: any; weekly?: any; monthly?: any } }): {
  name: string
  percent: number
} | undefined {
  const entries: Array<[string, any]> = [
    ["5h", usage.usage?.rolling],
    ["week", usage.usage?.weekly],
    ["month", usage.usage?.monthly],
  ]
  const windows = entries.filter(([, window]) => window && Number.isFinite(window.percent))
  if (windows.length === 0) return undefined
  const [name, window] = windows.reduce((left, right) =>
    (right[1]?.percent ?? 0) > (left[1]?.percent ?? 0) ? right : left,
  )
  return { name, percent: window!.percent ?? 0 }
}

async function readOpenRouter(): Promise<{ total: number; used: number } | undefined> {
  const key = openRouterKey()
  if (!key) return undefined
  try {
    const response = await fetch("https://openrouter.ai/api/v1/credits", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return undefined
    const payload: any = await response.json()
    const total = Number(payload?.data?.total_credits)
    const used = Number(payload?.data?.total_usage)
    if (!Number.isFinite(total) || !Number.isFinite(used)) return undefined
    return { total, used }
  } catch {
    return undefined
  }
}

function remainingTone(percent: number): FooterBudget["tone"] {
  return percent >= 50 ? "success" : percent >= 20 ? "warning" : "error"
}

function providerLabel(providerID: string): string {
  if (providerID === "openrouter") return "OR"
  if (providerID === GO) return "GO"
  if (providerID === ZEN) return "ZEN"
  return providerID ? providerID.slice(0, 3).toUpperCase() : "AI"
}

async function readFooterBudget(providerID: string): Promise<FooterBudget | undefined> {
  if (providerID === GO || providerID === ZEN) {
    const usage = await readGoUsage()
    const window = usage ? tightestWindow(usage) : undefined
    if (!window) return undefined
    const remaining = Math.max(0, Math.min(100, Math.round(100 - window.percent)))
    return { label: providerLabel(providerID), percent: remaining, tone: remainingTone(remaining) }
  }
  if (!providerID || providerID === "openrouter") {
    const credits = await readOpenRouter()
    if (!credits || credits.total <= 0) return undefined
    const remaining = Math.max(0, Math.min(100, Math.round(((credits.total - credits.used) / credits.total) * 100)))
    return { label: "OR", percent: remaining, tone: remainingTone(remaining) }
  }
  return undefined
}

function read(dir: string, done: (state: GitState) => void) {
  const options = {
    cwd: dir,
    timeout: 5000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  }

  const finish = (state: GitState, stash: number) => {
    // No upstream: fall back to counting commits that exist on no remote at all.
    if (!state.repo || state.upstream) {
      done({ ...state, stash })
      return
    }
    execFile("git", ["remote"], options, (remoteError, remoteOut) => {
      if (remoteError || !String(remoteOut).trim()) {
        done({ ...state, stash })
        return
      }
      execFile("git", ["rev-list", "--count", "HEAD", "--not", "--remotes"], options, (countError, countOut) => {
        const ahead = countError ? state.ahead : Number(String(countOut).trim()) || 0
        done({ ...state, stash, ahead })
      })
    })
  }

  execFile(
    "git",
    ["status", "--porcelain=v2", "--branch", "--untracked-files=normal"],
    options,
    (error, stdout) => {
      const state = error ? { ...idle } : parse(String(stdout))
      execFile("git", ["stash", "list", "--format=%gd"], options, (stashError, stashOut) => {
        const stash = stashError ? 0 : String(stashOut).split("\n").filter(Boolean).length
        finish(state, stash)
      })
    },
  )
}

function sessionDirectory(context: Plugin.Context, sessionID?: string) {
  try {
    const session = sessionID ? context.data.session.get(sessionID) : undefined
    return (
      session?.location?.directory ||
      context.location?.directory ||
      context.data.location.default()?.directory ||
      process.cwd()
    )
  } catch {
    return process.cwd()
  }
}

function pathInfo(context: Plugin.Context, sessionID?: string) {
  const dir = sessionDirectory(context, sessionID)
  if (!dir) return { parent: "", name: "" }
  const shown = context.ui.format.path(dir)
  const parts = shown.split("/")
  return { parent: parts.slice(0, -1).join("/"), name: parts.at(-1) ?? "" }
}

// Custom left-side footer segments: compact git counts and the provider wallet.
// The built-in prompt footer still owns display/full, context/cost and the command hint.
function StatusView(props: { context: Plugin.Context; state: () => GitState }) {
  const theme = () => props.context.theme
  const s = () => props.state()
  const muted = () => theme().text.muted
  const base = () => theme().text.base
  const success = () => theme().text.feedback.success.base
  const warning = () => theme().text.feedback.warning.base
  const error = () => theme().text.feedback.error.base

  const [budget, setBudget] = createSignal<FooterBudget | undefined>(undefined)
  const providerID = createMemo(() => {
    try {
      return String(props.context.ui.model.current()?.providerID ?? "")
    } catch {
      return ""
    }
  })

  const refreshBudget = async () => {
    try {
      setBudget(await readFooterBudget(providerID()))
    } catch {
      setBudget(undefined)
    }
  }
  createEffect(() => {
    providerID()
    void refreshBudget()
  })
  const timer = setInterval(() => void refreshBudget(), 60_000)
  onCleanup(() => clearInterval(timer))

  const added = () => s().added
  const changed = () => s().staged + s().modified + s().deleted
  const untracked = () => s().untracked
  const conflict = () => s().conflict
  const dirty = () => added() + changed() + untracked() + conflict() > 0
  const budgetColour = () => {
    const view = budget()
    if (!view) return muted()
    return view.tone === "success" ? success() : view.tone === "warning" ? warning() : error()
  }
  const showHint = (title: string, message: string) =>
    props.context.ui.toast.show({ title, message, variant: "info", duration: 3000 })

  return (
    <box flexDirection="row" flexShrink={0}>
      {s().repo && dirty() ? (
        <box
          flexDirection="row"
          onMouseEnter={() =>
            showHint(
              "Git status",
              "⑂ branch · + added · ± changed · ? untracked · ! conflicts",
            )
          }
          onClick={() =>
            showHint(
              "Git status",
              "⑂ branch · + added · ± changed · ? untracked · ! conflicts",
            )
          }
        >
          <text>
            <span style={{ fg: base() }}>⑂</span>
            {added() > 0 ? <span style={{ fg: success() }}> +{added()}</span> : null}
            {changed() > 0 ? <span style={{ fg: warning() }}> ±{changed()}</span> : null}
            {untracked() > 0 ? <span style={{ fg: warning() }}> ?{untracked()}</span> : null}
            {conflict() > 0 ? <span style={{ fg: error() }}> !{conflict()}</span> : null}
          </text>
        </box>
      ) : null}
      {budget() ? (
        <box
          flexDirection="row"
          onMouseEnter={() =>
            showHint(
              "Provider budget",
              `Remaining ${budget()!.label} budget: ${budget()!.percent}%. Green is 50% or more, yellow 20% or more, red below 20%.`,
            )
          }
          onClick={() =>
            showHint(
              "Provider budget",
              `Remaining ${budget()!.label} budget: ${budget()!.percent}%. Green is 50% or more, yellow 20% or more, red below 20%.`,
            )
          }
        >
          <text>
            <span style={{ fg: muted() }}> ↻ </span>
            <span style={{ fg: budgetColour() }}>{budget()!.label} {budget()!.percent}%</span>
          </text>
        </box>
      ) : null}
      <box
        flexDirection="row"
        onMouseEnter={() =>
          showHint(
            "Footer key",
            "☕ Coffee sleep-prevention · ♞ Ponytail style · ⑂ branch · + added · ± changed · ? untracked · ↻ provider budget · ↗ context · $ session cost · ctrl+p commands",
          )
        }
        onClick={() =>
          showHint(
            "Footer key",
            "☕ Coffee sleep-prevention · ♞ Ponytail style · ⑂ branch · + added · ± changed · ? untracked · ↻ provider budget · ↗ context · $ session cost · ctrl+p commands",
          )
        }
      >
        <text fg={muted()}> ⓘ</text>
      </box>
    </box>
  )
}

// Right-side sidebar footer: path and branch only; the counts live on the left.
function PathView(props: { context: Plugin.Context; state: () => GitState; sessionID?: string }) {
  const theme = () => props.context.theme
  const s = () => props.state()
  const p = () => pathInfo(props.context, props.sessionID)
  const muted = () => theme().text.muted
  const base = () => theme().text.base
  const accent = () => theme().hue.accent[500]

  return (
    <box
      flexDirection="row"
      flexShrink={0}
      onMouseEnter={() =>
        props.context.ui.toast.show({
          title: "Project",
          message: "Current project path and git branch.",
          variant: "info",
          duration: 2500,
        })
      }
      onClick={() =>
        props.context.ui.toast.show({
          title: "Project",
          message: "Current project path and git branch.",
          variant: "info",
          duration: 2500,
        })
      }
    >
      <text>
        <span style={{ fg: muted() }}>{p().parent}/</span>
        <span style={{ fg: base() }}>{p().name}</span>
        <span style={{ fg: muted() }}>{s().repo && s().branch ? ":" : ""}</span>
        <span style={{ fg: accent() }}>{s().repo ? s().branch : ""}</span>
      </text>
    </box>
  )
}

export function setupFooter(context: Plugin.Context) {
    if (context.options?.enabled === false) return

    // Hover events need the renderer's "motion" mouse mode; the TUI starts in "drag" mode.
    try {
      const renderer: any = context.renderer
      renderer.enableMouseMovement = true
      renderer.useMouse = true
    } catch {
      // click fallbacks below still expose the same descriptions
    }

    // Reachable even when a narrow footer clips the icons.
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "oc-footer.legend",
          title: "Footer: icon legend",
          description: "Show what every footer icon and counter means",
          group: "Footer",
          palette: true,
          slash: { name: "footer-key" },
          run: async () => {
            await context.ui.dialog.alert({
              title: "Footer key",
              message: [
                "☕ Coffee — sleep-prevention level (off / idle / display / system)",
                "♞ Ponytail — working-style level (off / lite / full / ultra)",
                "⑂ branch · + added · ± changed · ? untracked · ! conflicts",
                "↻ provider budget remaining · ↗ context tokens · $ session cost",
                "path:branch — current project and branch",
                "ctrl+p — command palette",
              ].join("\n"),
            })
          },
        },
      ],
    }))

    const configured = typeof context.options?.interval === "number" ? context.options.interval : 0
    const interval = configured >= 500 ? configured : 2500

    const [state, setState] = createSignal<GitState>(idle)
    let pending = false
    let activeSessionID: string | undefined

    const refresh = () => {
      if (pending) return
      const dir = sessionDirectory(context, activeSessionID)
      if (!dir) return
      pending = true
      read(dir, (next) => {
        pending = false
        setState(next)
      })
    }

    refresh()
    const timer = setInterval(refresh, interval)

    const offs: (() => void)[] = []
    for (const type of ["filesystem.changed", "git", "vcs.branch.updated", "session.idle", "worktree.resolved"] as const) {
      try {
        offs.push(context.data.on(type, refresh))
      } catch {
        // Event type unavailable on this host version; polling still covers it.
      }
    }

    context.ui.slot({
      append: "prompt.footer.status",
      render: (input) => {
        activeSessionID = input.sessionID
        return <StatusView context={context} state={state} />
      },
    })

    return () => {
      clearInterval(timer)
      for (const off of offs) off()
    }
}

export default Plugin.define({ id: "alexeyshirshov.git-status", setup: setupFooter })
