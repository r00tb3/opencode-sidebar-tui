/** @jsxImportSource @opentui/solid */
// One ordered sidebar content block: MCP, Budget, Context, Plugins, Skills, Todo.
// The built-in sidebar sections are disabled in cli.json so this block owns the
// content order; the Todo server tool remains available for real todo data.
import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { TextAttributes } from "@opentui/core"
import { appendFileSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { normalizeTodos } from "./todos.js"
import { buildTiming, timingSummary } from "./timing.js"

const AUTH_FILE = join(homedir(), ".local", "share", "opencode", "auth.json")
const DB_FILE = join(homedir(), ".local", "share", "opencode", "opencode.db")
const USAGE_URL = "https://opencode.ai/zen/go/v1/usage"
const BAR_WIDTH = 24
const ZEN = "opencode"
const GO = "opencode-go"

type Budget = { total: number; used: number }
type Window = { status?: string; percent?: number; resetsAt?: string }
type GoUsage = { usage?: { rolling?: Window; weekly?: Window; monthly?: Window } }
type BudgetView = {
	title: string
	percent: number
	barLabel: string
	detail: string
	note: string
	reset?: string
	tone: "success" | "warning" | "error" | "accent"
}
type SkillUsage = { count: number; lastUsed: number }
type SidebarSettings = {
	collapsed: Record<string, boolean>
	expanded: Record<string, boolean>
	pinned: Record<string, boolean>
	showCompleted: boolean
	compact: boolean
}

function trace(message: string): void {
	try {
		appendFileSync(join(tmpdir(), "oc-sidebar.log"), `${new Date().toISOString()} ${message}\n`)
	} catch {
		// diagnostics are optional
	}
}

function readSessionUsageFromDb(): any[] {
	try {
		const Database = loadBunDatabase()
		if (!Database) return []
		const db = new Database(DB_FILE, { readonly: true })
		const columns =
			"id, title, cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, model, time_updated, parent_id"
		let rows: any[] = []
		try {
			rows = db
				.query(`SELECT ${columns} FROM session_v2 ORDER BY time_updated DESC LIMIT 500`)
				.all()
		} catch {
			rows = db
				.query(`SELECT ${columns} FROM session ORDER BY time_updated DESC LIMIT 500`)
				.all()
		}
		try {
			db.close?.()
		} catch {
			// already closed
		}
		return rows.map((row) => {
			let model: any = {}
			try {
				model = JSON.parse(String(row.model ?? "{}"))
			} catch {
				// keep the unknown model
			}
			return {
				id: String(row.id ?? ""),
				title: row.title ?? row.id ?? "session",
				cost: Number(row.cost) || 0,
				tokens: {
					input: Number(row.tokens_input) || 0,
					output: Number(row.tokens_output) || 0,
					reasoning: Number(row.tokens_reasoning) || 0,
					cache: {
						read: Number(row.tokens_cache_read) || 0,
						write: Number(row.tokens_cache_write) || 0,
					},
				},
				model: {
					providerID: model?.providerID ?? model?.provider ?? "?",
					id: model?.id ?? model?.modelID ?? "?",
				},
				parentID: row.parent_id ?? undefined,
				time: { updated: Number(row.time_updated) || 0 },
			}
		})
	} catch {
		return []
	}
}

let sessionMessageCache:
	| { sessionID: string; count: number; updated: number; messages: any[] }
	| undefined

function readSessionMessagesFromDb(sessionID: string): any[] {
	try {
		const Database = loadBunDatabase()
		if (!Database) return []
		const db = new Database(DB_FILE, { readonly: true })
		const meta = db
			.query("SELECT count(*) AS count, max(time_updated) AS updated FROM session_message WHERE session_id = ?")
			.get(sessionID) as any
		const count = Number(meta?.count ?? 0)
		const updated = Number(meta?.updated ?? 0)
		if (
			sessionMessageCache &&
			sessionMessageCache.sessionID === sessionID &&
			sessionMessageCache.count === count &&
			sessionMessageCache.updated === updated
		) {
			try {
				db.close?.()
			} catch {
				// already closed
			}
			return sessionMessageCache.messages
		}
		const rows = db
			.query("SELECT data FROM session_message WHERE session_id = ? ORDER BY seq")
			.all(sessionID) as any[]
		try {
			db.close?.()
		} catch {
			// already closed
		}
		const messages: any[] = []
		for (const row of rows) {
			try {
				messages.push(JSON.parse(String(row.data ?? "{}")))
			} catch {
				// skip malformed rows
			}
		}
		sessionMessageCache = { sessionID, count, updated, messages }
		return messages
	} catch {
		return []
	}
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

async function readGoUsage(): Promise<GoUsage | undefined> {
	const keys = apiKeys()
	for (const key of keys) {
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

function tightestWindow(usage: GoUsage): { name: string; percent: number; resetsAt?: string } | undefined {
	const entries: Array<[string, Window | undefined]> = [
		["5h", usage.usage?.rolling],
		["week", usage.usage?.weekly],
		["month", usage.usage?.monthly],
	]
	const windows = entries.filter(([, window]) => window && Number.isFinite(window.percent))
	if (windows.length === 0) return undefined
	const [name, window] = windows.reduce((left, right) =>
		(right[1]?.percent ?? 0) > (left[1]?.percent ?? 0) ? right : left,
	)
	return { name, percent: window!.percent ?? 0, resetsAt: window!.resetsAt }
}

async function readOpenRouter(): Promise<Budget | undefined> {
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

function formatInt(value: number): string {
	return new Intl.NumberFormat("en-US").format(Math.max(0, Math.round(value)))
}

function formatMoney(value: number): string {
	return `$${value.toFixed(2)}`
}

function safeNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function messageTokenCount(message: any): number {
	const input = safeNumber(message?.tokens?.input)
	const output = safeNumber(message?.tokens?.output)
	const reasoning = safeNumber(message?.tokens?.reasoning)
	const cacheRead = safeNumber(message?.tokens?.cache?.read)
	const cacheWrite = safeNumber(message?.tokens?.cache?.write)
	return input + output + reasoning + cacheRead + cacheWrite
}

function until(value: string | undefined): string | undefined {
	if (!value) return undefined
	const at = new Date(value).getTime()
	if (!Number.isFinite(at)) return undefined
	const ms = at - Date.now()
	if (ms <= 0) return undefined
	const days = Math.floor(ms / 86_400_000)
	const hours = Math.floor((ms % 86_400_000) / 3_600_000)
	const minutes = Math.floor((ms % 3_600_000) / 60_000)
	if (days > 0) return `${days}d ${hours}h`
	if (hours > 0) return `${hours}h ${minutes}m`
	return `${minutes}m`
}

async function readBudgetView(providerID: string, sessionCost: number): Promise<BudgetView> {
	if (providerID === GO || providerID === ZEN) {
		const usage = await readGoUsage()
		const window = usage ? tightestWindow(usage) : undefined
		if (window) {
			const used = Math.max(0, Math.min(100, window.percent))
			const remaining = 100 - used
			const reset = until(window.resetsAt)
			return {
				title: providerID === GO ? "Budget - OpenCode Go" : "Budget - OpenCode Free",
				percent: remaining,
				barLabel: `${remaining}% left`,
				detail: `${window.name} ${used}% used`,
				note: providerID === GO ? "OpenCode Go quota" : "OpenCode Free/Zen quota",
				reset,
				tone: remaining >= 50 ? "success" : remaining >= 20 ? "warning" : "error",
			}
		}
		return {
			title: providerID === GO ? "Budget - OpenCode Go" : "Budget - OpenCode Free",
			percent: providerID === ZEN ? 100 : 0,
			barLabel: providerID === ZEN ? "Free" : "No quota",
			detail: providerID === ZEN ? "Free tier - no quota reported" : "No Go/Zen workspace key",
			note: `Session ${formatMoney(sessionCost)}`,
			tone: "accent",
		}
	}

	if (!providerID || providerID === "openrouter") {
		const credits = await readOpenRouter()
		if (credits && credits.total > 0) {
			const remaining = Math.max(0, credits.total - credits.used)
			const percent = Math.round((remaining / credits.total) * 100)
			return {
				title: "Budget - OpenRouter",
				percent,
				barLabel: `${percent}% left`,
				detail: `${formatMoney(remaining)} left of ${formatMoney(credits.total)}`,
				note: `OpenRouter - ${formatMoney(credits.used)} used`,
				tone: percent >= 50 ? "success" : percent >= 20 ? "warning" : "error",
			}
		}
		return {
			title: "Budget - OpenRouter",
			percent: 0,
			barLabel: "No data",
			detail: "No OpenRouter credit data",
			note: `Session ${formatMoney(sessionCost)}`,
			tone: "accent",
		}
	}

	return {
		title: `Budget - ${providerID}`,
		percent: 0,
		barLabel: "No data",
		detail: `No budget source for ${providerID}`,
		note: `Session ${formatMoney(sessionCost)}`,
		tone: "accent",
	}
}

const statusHealthy = (status: string) => status === "active" || status === "connected"
const statusProblem = (status: string) => status === "failed" || status === "error" || status === "disconnected"

function timestampOf(part: any, message: any): number {
	const candidates = [
		part?.time?.created,
		part?.time?.ran,
		part?.time?.completed,
		part?.state?.time?.created,
		part?.state?.time?.ran,
		part?.state?.time?.completed,
	]
	for (const value of candidates) if (typeof value === "number") return value
	if (typeof message?.time === "number") return message.time
	const created = message?.time?.created
	return typeof created === "number" ? created : 0
}

function compactNumber(value: number): string {
	const number = Math.max(0, Math.round(value))
	if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1)}M`
	if (number >= 1_000) return `${Math.round(number / 1_000)}K`
	return String(number)
}

function clipText(value: unknown, width: number): string {
	const text = String(value ?? "")
	return text.length <= width ? text : text.slice(0, Math.max(1, width - 1)) + "…"
}

function buildUsageReport(sessions: any[]) {
	const total = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }
	const models = new Map<string, { cost: number; input: number; output: number }>()
	for (const session of sessions) {
		total.cost += safeNumber(session?.cost)
		total.input += safeNumber(session?.tokens?.input)
		total.output += safeNumber(session?.tokens?.output)
		total.reasoning += safeNumber(session?.tokens?.reasoning)
		total.cacheRead += safeNumber(session?.tokens?.cache?.read)
		total.cacheWrite += safeNumber(session?.tokens?.cache?.write)
		const key = `${session?.model?.providerID ?? "?"}/${session?.model?.id ?? session?.model?.modelID ?? "?"}`
		const row = models.get(key) ?? { cost: 0, input: 0, output: 0 }
		row.cost += safeNumber(session?.cost)
		row.input += safeNumber(session?.tokens?.input)
		row.output += safeNumber(session?.tokens?.output)
		models.set(key, row)
	}
	const topModels = [...models.entries()].toSorted((left, right) => right[1].cost - left[1].cost).slice(0, 5)
	const recent = sessions
		.slice()
		.toSorted((left, right) => safeNumber(right?.time?.updated) - safeNumber(left?.time?.updated))
		.slice(0, 5)
	return { total, topModels, recent }
}

function UsageReport(props: { context: Plugin.Context; sessions: any[]; onClose: () => void }) {
	const theme = () => props.context.theme
	const text = () => theme().text.base
	const muted = () => theme().text.muted
	const accent = () => theme().text.action.primary.base
	const line = () => theme().border?.base ?? theme().text.muted
	const report = buildUsageReport(props.sessions)

	const SummaryRow = (row: { label: string; value: string }) => (
		<box flexDirection="row" justifyContent="space-between" gap={1}>
			<text fg={muted()}>{row.label}</text>
			<box flexShrink={1} minWidth={0}>
				<text fg={text()} wrapMode="wrap">{row.value}</text>
			</box>
		</box>
	)
	const Cell = (cell: { width: number; align?: "left" | "right"; header?: boolean; children: any }) => (
		<box width={cell.width} flexShrink={0} justifyContent={cell.align === "right" ? "flex-end" : "flex-start"}>
			<text fg={cell.header ? muted() : text()} attributes={cell.header ? TextAttributes.BOLD : undefined}>
				{cell.children}
			</text>
		</box>
	)

	return (
		<box flexDirection="column" gap={1} width="100%">
			<box flexDirection="row" justifyContent="space-between" gap={1}>
				<text fg={text()} attributes={TextAttributes.BOLD}>Usage — all sessions</text>
				<box flexDirection="row" onMouseDown={props.onClose}>
					<text fg={accent()}>Close</text>
				</box>
			</box>
			<box flexDirection="column">
				<SummaryRow label="Sessions" value={`${props.sessions.length} including inactive`} />
				<SummaryRow label="Spend" value={formatMoney(report.total.cost)} />
				<SummaryRow label="Tokens" value={`${compactNumber(report.total.input)} in / ${compactNumber(report.total.output)} out`} />
				<SummaryRow label="Reasoning" value={compactNumber(report.total.reasoning)} />
				<SummaryRow label="Cache" value={`${compactNumber(report.total.cacheRead)} read / ${compactNumber(report.total.cacheWrite)} write`} />
			</box>
			<text fg={muted()} attributes={TextAttributes.BOLD}>Models</text>
			<box flexDirection="row" gap={1}>
				<Cell width={18} header>MODEL</Cell>
				<Cell width={9} align="right" header>SPEND</Cell>
				<Cell width={4} align="right" header>IN</Cell>
				<Cell width={4} align="right" header>OUT</Cell>
			</box>
			<box height={1} width="100%" backgroundColor={line()} />
			{report.topModels.map(([name, row]) => (
				<box flexDirection="row" gap={1}>
					<Cell width={18}>{clipText(name, 18)}</Cell>
					<Cell width={9} align="right">{formatMoney(row.cost)}</Cell>
					<Cell width={4} align="right">{compactNumber(row.input)}</Cell>
					<Cell width={4} align="right">{compactNumber(row.output)}</Cell>
				</box>
			))}
			<text fg={muted()} attributes={TextAttributes.BOLD}>Recent sessions</text>
			<box flexDirection="row" gap={1}>
				<Cell width={28} header>SESSION</Cell>
				<Cell width={9} align="right" header>SPEND</Cell>
			</box>
			<box height={1} width="100%" backgroundColor={line()} />
			{report.recent.map((session) => (
				<box flexDirection="row" gap={1}>
					<Cell width={28}>{clipText(session?.title ?? session?.id ?? "session", 28)}</Cell>
					<Cell width={9} align="right">{formatMoney(safeNumber(session?.cost))}</Cell>
				</box>
			))}
		</box>
	)
}

function Sidebar(props: { sessionID: string }) {
	const context = usePlugin()
	trace(`sidebar mount ${props.sessionID || "(none)"}`)
	const theme = () => context.theme
	const text = () => theme().text.base
	const muted = () => theme().text.muted
	const accent = () => theme().text.action.primary.base
	const success = () => theme().text.feedback.success.base
	const warning = () => theme().text.feedback.warning.base
	const error = () => theme().text.feedback.error.base
	const toneColour = (tone: BudgetView["tone"]) =>
		tone === "success" ? success() : tone === "warning" ? warning() : tone === "error" ? error() : accent()

	const [settings, updateSettings] = context.storage.store<SidebarSettings>("oc-sidebar.settings", {
		initial: { collapsed: {}, expanded: {}, pinned: {}, showCompleted: false, compact: false },
	})
	const toggleSection = (id: string) =>
		void updateSettings((draft) => {
			draft.collapsed[id] = !draft.collapsed[id]
		})
	const toggleExpanded = (id: string) =>
		void updateSettings((draft) => {
			draft.expanded[id] = !draft.expanded[id]
		})
	const toggleShowCompleted = () =>
		void updateSettings((draft) => {
			draft.showCompleted = !draft.showCompleted
		})
	const toggleCompact = () =>
		void updateSettings((draft) => {
			draft.compact = !draft.compact
		})
	const resetLayout = () =>
		void updateSettings((draft) => {
			draft.collapsed = {}
			draft.expanded = {}
			draft.showCompleted = false
			draft.compact = false
		})
	const resetPins = () =>
		void updateSettings((draft) => {
			draft.pinned = {}
		})
	const togglePin = (id: string) => {
		const pinned = !(settings.pinned?.[id] ?? false)
		void updateSettings((draft) => {
			draft.pinned ??= {}
			draft.pinned[id] = pinned
		})
		context.ui.toast.show({
			title: "Skills",
			message: `${pinned ? "Pinned" : "Unpinned"} ${id}`,
			variant: "info",
			duration: 1800,
		})
	}
	const listLimit = () => {
		if (settings.compact) return 4
		try {
			const height = Number((context.renderer as any)?.height)
			if (Number.isFinite(height) && height > 0) return Math.max(3, Math.min(8, Math.floor(height / 12)))
		} catch {
			// fall back to the compact limit
		}
		return 6
	}
	const shown = (list: any[], id: string) => (settings.expanded?.[id] ? list : list.slice(0, listLimit()))

	const session = createMemo(() => {
		try {
			return context.data.session.get(props.sessionID)
		} catch {
			return undefined
		}
	})
	const location = createMemo(() => {
		try {
			const sessionLocation = session()?.location
			if (sessionLocation?.directory) return sessionLocation
			if (context.location?.directory) return context.location
			const fallback = context.data.location.default()
			if (fallback?.directory) return fallback
			const directory = sessionLocation?.directory ?? context.location?.directory ?? fallback?.directory ?? process.cwd()
			return directory ? { directory } : undefined
		} catch {
			return undefined
		}
	})
	const messages = createMemo(() => {
		try {
			return (context.data.session.message.list(props.sessionID) ?? []) as any[]
		} catch (error) {
			trace(`messages unavailable: ${error instanceof Error ? error.message : String(error)}`)
			return []
		}
	})
	const [usageTick, setUsageTick] = createSignal(0)
	createEffect(() => {
		props.sessionID
		const timer = setInterval(() => {
			try {
				void context.data.session.message.sync(props.sessionID)
			} catch {
				// the database poll below still covers the sidebar
			}
			setUsageTick((value) => value + 1)
		}, 2_000)
		onCleanup(() => clearInterval(timer))
	})
	const usageMessages = createMemo(() => {
		usageTick()
		const loaded = messages()
		const fromDb = readSessionMessagesFromDb(props.sessionID)
		return fromDb.length >= loaded.length ? fromDb : loaded
	})
	const providerID = createMemo(() => {
		try {
			return String(context.ui.model.current()?.providerID ?? "")
		} catch {
			return ""
		}
	})

	createEffect(() => {
		try {
			void context.data.session.message.sync(props.sessionID)
		} catch (error) {
			trace(`message sync failed: ${error instanceof Error ? error.message : String(error)}`)
		}
	})
	createEffect(() => {
		try {
			void context.data.location.model.sync(location())
		} catch {
			// retried when the location becomes available
		}
	})
	createEffect(() => {
		if (settings.collapsed?.mcp) return
		try {
			void context.data.location.mcp.server.sync(location())
		} catch {
			// retried when the location becomes available
		}
	})
	createEffect(() => {
		if (settings.collapsed?.mcp) return
		try {
			void context.data.location.mcp.resource.sync(location())
		} catch {
			// retried when the location becomes available
		}
	})
	createEffect(() => {
		if (settings.collapsed?.skills) return
		try {
			void context.data.location.skill.sync(location())
		} catch {
			// retried when the location becomes available
		}
	})

	const mcp = createMemo(() => {
		try {
			return context.data.location.mcp.server.list(location()) ?? []
		} catch {
			return []
		}
	})
	const mcpResources = createMemo(() => {
		try {
			return context.data.location.mcp.resource.list(location()) ?? []
		} catch {
			return []
		}
	})
	const mcpStatus = (server: any) => {
		const status = typeof server?.status === "string" ? server.status : server?.status?.status
		return typeof status === "string" && status ? status : "unknown"
	}
	const mcpActive = (server: any) => statusHealthy(mcpStatus(server))
	const mcpProblem = (server: any) => statusProblem(mcpStatus(server))
	const mcpRank = (server: any) => (mcpProblem(server) ? 0 : mcpActive(server) ? 1 : 2)
	const mcpResourceServer = (resource: any) =>
		String(resource?.server ?? resource?.serverID ?? resource?.serverId ?? "")
	const mcpResourcesFor = (server: any) => {
		const id = String(server?.id ?? server?.name ?? "")
		if (!id) return 0
		return mcpResources().filter((resource: any) => mcpResourceServer(resource) === id).length
	}
	const mcpSorted = createMemo(() =>
		mcp()
			.slice()
			.toSorted((left: any, right: any) => {
				return (
					mcpRank(left) - mcpRank(right) ||
					String(left?.name ?? left?.id ?? "").localeCompare(String(right?.name ?? right?.id ?? ""))
				)
			}),
	)
	const skills = createMemo(() => {
		try {
			return context.data.location.skill.list(location()) ?? []
		} catch {
			return []
		}
	})
	let indexSession = ""
	let indexProcessed = 0
	let indexLastMessage: any
	let indexSkills = new Map<string, SkillUsage>()
	let indexToolUsage = new Map<string, number>()
	let indexTodos: any[] | undefined
	let indexTodoAt = 0
	let indexWrites: Array<{ at: number; todos: any[] }> = []
	let indexTiming: any = undefined
	let indexTodoParts = new Set<string>()
	let indexView: {
		skills: Map<string, SkillUsage>
		tools: Map<string, number>
		todos: any[] | undefined
		timing: any
	} = {
		skills: indexSkills,
		tools: indexToolUsage,
		todos: undefined,
		timing: undefined,
	}

	const resetIndex = () => {
		indexSession = props.sessionID
		indexProcessed = 0
		indexLastMessage = undefined
		indexSkills = new Map()
		indexToolUsage = new Map()
		indexTodos = undefined
		indexTodoAt = 0
		indexWrites = []
		indexTiming = undefined
		indexTodoParts = new Set()
		indexView = { skills: indexSkills, tools: indexToolUsage, todos: undefined, timing: undefined }
	}

	const processMessage = (message: any, todoOnly: boolean): boolean => {
		let changed = false
		const content = message?.content
		if (!Array.isArray(content)) return false
		for (const part of content) {
			if (part?.type !== "tool") continue
			const name = String(part?.name ?? "")
			if (!todoOnly && name) {
				indexToolUsage.set(name, (indexToolUsage.get(name) ?? 0) + 1)
				changed = true
			}
			if (!todoOnly && (name === "skill" || name.endsWith(".skill"))) {
				const input = part?.state?.input
				const keys = [
					...new Set(
						[input?.id, input?.name].filter(
							(value): value is string => typeof value === "string" && value.length > 0,
						),
					),
				]
				if (keys.length > 0) {
					for (const key of keys) {
						const usage = indexSkills.get(key) ?? { count: 0, lastUsed: 0 }
						usage.count += 1
						usage.lastUsed = Math.max(usage.lastUsed, timestampOf(part, message))
						indexSkills.set(key, usage)
					}
					changed = true
				}
			}
			if (name === "todowrite" && part?.state?.status === "completed") {
				try {
					const key = `${message?.id ?? ""}:${part?.id ?? ""}`
					if (key !== ":" && indexTodoParts.has(key)) continue
					if (key !== ":") indexTodoParts.add(key)
					const list = normalizeTodos(part.state.input)
					const at = timestampOf(part, message)
					indexWrites.push({ at, todos: list })
					indexTiming = buildTiming(indexWrites)
					if (!indexTodos || at >= indexTodoAt) {
						indexTodos = list
						indexTodoAt = at
					}
					changed = true
				} catch {
					// skip malformed historical writes
				}
			}
		}
		return changed
	}

	const messageIndex = createMemo(() => {
		const list = usageMessages()
		if (indexSession !== props.sessionID || list.length < indexProcessed) resetIndex()
		let changed = false
		for (let i = indexProcessed; i < list.length; i++) {
			if (processMessage(list[i], false)) changed = true
		}
		const last = list.at(-1)
		if (last && indexProcessed === list.length && last !== indexLastMessage) {
			// In-place completion of the newest tool call: refresh todo writes without recounting skills.
			if (processMessage(last, true)) changed = true
		}
		indexLastMessage = last
		indexProcessed = list.length
		if (changed) indexView = { skills: indexSkills, tools: indexToolUsage, todos: indexTodos, timing: indexTiming }
		return indexView
	})
	const skillUsage = createMemo(() => messageIndex().skills)
	const toolUsage = createMemo(() => messageIndex().tools)
	const PLUGIN_TOOLS: Record<string, string[]> = {
		"aiev.todolist": ["todowrite", "todoread"],
		"opencode-todolist": ["todowrite", "todoread"],
	}
	const pluginToolCalls = (plugin: any) => {
		const names = PLUGIN_TOOLS[String(plugin?.id ?? "")] ?? []
		return names.reduce((sum, name) => sum + (toolUsage().get(name) ?? 0), 0)
	}
	const mcpToolCalls = (server: any) => {
		const name = String(server?.name ?? server?.id ?? "").toLowerCase()
		if (!name) return 0
		let total = 0
		for (const [tool, count] of toolUsage()) {
			const lower = tool.toLowerCase()
			if (lower === name || lower.startsWith(`${name}_`) || lower.startsWith(`${name}.`) || lower.startsWith(`${name}:`)) {
				total += count
			}
		}
		return total
	}
	const todoTiming = createMemo(() => messageIndex().timing)
	const [now, setNow] = createSignal(Date.now())
	createEffect(() => {
		const timing = todoTiming()
		if (!timing?.current) return
		setNow(Date.now())
		const timer = setInterval(() => setNow(Date.now()), 1000)
		onCleanup(() => clearInterval(timer))
	})
	const timeLabel = () => timingSummary(todoTiming(), now())
	const modelList = () => {
		try {
			return context.data.location.model.list(location()) ?? []
		} catch {
			return []
		}
	}

	const [plugins, setPlugins] = createSignal<any[]>([])
	const refreshPlugins = async (loc: any, force = false) => {
		if (!force && settings.collapsed?.plugins) return
		try {
			const response = await context.client.plugin.list(loc ? { location: loc } : ({} as any))
			setPlugins(response?.data ?? [])
		} catch (error) {
			trace(`plugin list failed: ${error instanceof Error ? error.message : String(error)}`)
			setPlugins([])
		}
	}
	createEffect(() => {
		const loc = location()
		if (settings.collapsed?.plugins) return
		void refreshPlugins(loc)
		const timer = setInterval(() => void refreshPlugins(loc), 15_000)
		onCleanup(() => clearInterval(timer))
	})
	const pluginRank = (plugin: any) => {
		const status = plugin?.state?.status
		return status === "failed" ? 0 : status === "active" ? 1 : 2
	}
	const visiblePlugins = createMemo(() =>
		plugins()
			.filter((plugin: any) => plugin?.source?.type !== "builtin")
			.toSorted((left: any, right: any) => {
				return (
					pluginRank(left) - pluginRank(right) ||
					String(left?.id ?? "").localeCompare(String(right?.id ?? ""))
				)
			}),
	)

	createEffect(() => {
		trace(
			`data loc=${(location() as any)?.directory ?? "(none)"} mcp=${mcp().length} resources=${mcpResources().length} skills=${skills().length} plugins=${visiblePlugins().length} messages=${messages().length} usage=${usageMessages().length}`,
		)
	})

	const todos = createMemo(() => messageIndex().todos ?? [])

	const sessionCost = createMemo(() => {
		const fromSession = safeNumber(session()?.cost)
		if (fromSession > 0) return fromSession
		return messages()
			.filter((message) => message?.type === "assistant")
			.reduce((sum, message) => sum + safeNumber(message?.cost), 0)
	})
	const usage = createMemo(() => {
		const lastAssistant = messages().findLast((message) => {
			const output = safeNumber(message?.tokens?.output)
			return message?.type === "assistant" && output > 0
		})
		if (!lastAssistant) return { tokens: 0, contextWindow: 0, percent: 0, cacheRate: 0, tps: 0 }
		const tokens = messageTokenCount(lastAssistant)
		const provider = lastAssistant?.model?.providerID
		const modelID = lastAssistant?.model?.id
		const model = modelList().find(
			(item: any) => item.providerID === provider && (item.id === modelID || item.modelID === modelID),
		)
		const contextWindow = safeNumber(model?.limit?.context)
		const percent = contextWindow > 0 ? Math.round((tokens / contextWindow) * 100) : 0
		const cacheRead = safeNumber(lastAssistant?.tokens?.cache?.read)
		const cacheWrite = safeNumber(lastAssistant?.tokens?.cache?.write)
		const input = safeNumber(lastAssistant?.tokens?.input)
		const cacheDenom = cacheRead + cacheWrite + input
		const cacheRate = cacheDenom > 0 ? Math.round((cacheRead / cacheDenom) * 100) : 0
		const output = safeNumber(lastAssistant?.tokens?.output) + safeNumber(lastAssistant?.tokens?.reasoning)
		const started = safeNumber(lastAssistant?.time?.created)
		const ended = safeNumber(lastAssistant?.time?.completed ?? lastAssistant?.time?.streamed)
		const seconds = ended > started ? (ended - started) / 1000 : 0
		const tps = seconds > 0 ? output / seconds : 0
		return { tokens, contextWindow, percent, cacheRate, tps }
	})

	const [budget, setBudget] = createSignal<BudgetView | undefined>(undefined)
	const [budgetStale, setBudgetStale] = createSignal(false)
	let budgetFailures = 0
	let budgetRetryAt = 0
	const refreshBudget = async (force = false) => {
		if (!force && (settings.collapsed?.budget || Date.now() < budgetRetryAt)) return
		const pid = providerID()
		const cost = sessionCost()
		try {
			const view = await readBudgetView(pid, cost)
			trace(`budget ${view.title} ${view.barLabel}`)
			setBudget(view)
			setBudgetStale(false)
			budgetFailures = 0
			budgetRetryAt = 0
		} catch (error) {
			budgetFailures += 1
			budgetRetryAt = Date.now() + Math.min(5 * 60_000, 5_000 * 2 ** Math.min(budgetFailures, 6))
			trace(`budget failed (${budgetFailures}): ${error instanceof Error ? error.message : String(error)}`)
			if (!budget()) {
				setBudget({
					title: `Budget - ${pid || "OpenRouter"}`,
					percent: 0,
					barLabel: "No data",
					detail: "Budget lookup failed",
					note: `Session ${formatMoney(cost)}`,
					tone: "accent",
				})
			}
			setBudgetStale(true)
		}
	}
	createEffect(() => {
		providerID()
		sessionCost()
		if (!settings.collapsed?.budget) void refreshBudget(true)
	})
	const timer = setInterval(() => {
		if (!settings.collapsed?.budget) void refreshBudget()
	}, 60_000)
	onCleanup(() => clearInterval(timer))

	const Bar = (props: { percent: () => number; colour: () => string }) => {
		const filled = () => {
			const percent = Math.max(0, Math.min(100, props.percent()))
			return Math.max(0, Math.min(BAR_WIDTH, Math.round((percent / 100) * BAR_WIDTH)))
		}
		const track = () =>
			theme().background?.raised?.high ??
			theme().background?.raised?.base ??
			theme().border?.base ??
			"#2a2a2a"
		return (
			<box flexDirection="row" flexShrink={0} height={1}>
				{filled() > 0 ? <box width={filled()} height={1} backgroundColor={props.colour()} /> : null}
				{BAR_WIDTH - filled() > 0 ? (
					<box width={BAR_WIDTH - filled()} height={1} backgroundColor={track()} />
				) : null}
			</box>
		)
	}

	// Brackets stay; active/used gets a centered green bullet, inactive keeps an empty bracket.
	const Dot = (props: { on: () => boolean }) => (
		<box flexDirection="row" flexShrink={0} height={1}>
			<text fg={muted()}>[</text>
			<text fg={props.on() ? success() : muted()}>{props.on() ? "•" : " "}</text>
			<text fg={muted()}>]</text>
		</box>
	)

	const StatusDot = (props: { status: () => string }) => (
		<box flexDirection="row" flexShrink={0} height={1}>
			<text fg={muted()}>[</text>
			<text fg={statusHealthy(props.status()) ? success() : statusProblem(props.status()) ? error() : muted()}>
				{statusHealthy(props.status()) ? "•" : statusProblem(props.status()) ? "×" : " "}
			</text>
			<text fg={muted()}>]</text>
		</box>
	)

	const Panel = (props: { id: string; title: string; count?: string; action?: any; children: any }) => {
		const collapsed = () => settings.collapsed?.[props.id] ?? false
		return (
			<box flexDirection="column">
				<box flexDirection="row" gap={1}>
					<box flexDirection="row" onMouseDown={() => toggleSection(props.id)}>
						<text fg={text()} attributes={TextAttributes.BOLD}>
							{collapsed() ? "▸" : "▾"} {props.title}
						</text>
					</box>
					{props.count ? <text fg={muted()}>{props.count}</text> : null}
					{props.action ?? null}
				</box>
				{collapsed() ? null : <box flexDirection="column">{props.children}</box>}
			</box>
		)
	}

	const More = (props: { id: string; total: number; visible: number }) => {
		const expanded = () => settings.expanded?.[props.id] ?? false
		if (props.total === 0) return null
		if (expanded()) {
			return (
				<box flexDirection="row" onMouseDown={() => toggleExpanded(props.id)}>
					<text fg={muted()}>- less</text>
				</box>
			)
		}
		if (props.total <= props.visible) return null
		return (
			<box flexDirection="row" onMouseDown={() => toggleExpanded(props.id)}>
				<text fg={muted()}>{`+${props.total - props.visible} more`}</text>
			</box>
		)
	}

	const openSkillSearch = async () => {
		const list = skills()
		if (list.length === 0) {
			context.ui.toast.show({ title: "Skills", message: "No skills found", variant: "info", duration: 1800 })
			return
		}
		const options = list.map((skill: any) => ({
			title: String(skill?.name ?? skill?.id ?? "skill"),
			value: String(skill?.id ?? ""),
			description: typeof skill?.description === "string" ? skill.description : undefined,
		}))
		try {
			const picked = await context.ui.dialog.select({
				title: "Skills — select to pin or unpin",
				placeholder: "Search skills",
				options,
				search: (query, items) => {
					const q = query.trim().toLowerCase()
					if (!q) return items
					return items.filter((item) => `${item.title} ${item.description ?? ""}`.toLowerCase().includes(q))
				},
			})
			if (picked) togglePin(picked)
		} catch (error) {
			trace(`skill search failed: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	const showPluginDetails = async (plugin: any) => {
		const status = String(plugin?.state?.status ?? "unknown")
		const version = plugin?.version ?? plugin?.source?.version ?? "—"
		const source =
			plugin?.source?.type === "local"
				? plugin.source.path
				: plugin?.source?.type === "package"
					? `${plugin.source.target}${plugin.source.version ? "@" + plugin.source.version : ""}`
					: plugin?.source?.type ?? "unknown"
		const features = plugin?.features ?? {}
		const lines = [
			`status: ${status}`,
			`version: ${version}`,
			`source: ${source}`,
			`tool calls: ${pluginToolCalls(plugin)}`,
			`server: ${features.server ? "yes" : "no"}  tui: ${features.tui ? "yes" : "no"}  rpc: ${features.rpc ? "yes" : "no"}`,
		]
		if (plugin?.state?.error) lines.push(`error: ${plugin.state.error}`)
		try {
			await context.ui.dialog.alert({
				title: `Plugin — ${plugin?.id ?? "unknown"}`,
				message: lines.join("\n"),
			})
		} catch (error) {
			trace(`plugin details failed: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	const refreshMCP = async () => {
		const loc = location()
		try {
			await Promise.allSettled([
				context.data.location.mcp.server.sync(loc),
				context.data.location.mcp.resource.sync(loc),
			])
		} catch (error) {
			trace(`mcp refresh failed: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	const showMCPDetails = async (server: any) => {
		const name = String(server?.name ?? server?.id ?? "server")
		const lines = [
			`status: ${mcpStatus(server)}`,
			`resources: ${mcpResourcesFor(server)} / ${mcpResources().length} total`,
			`tool calls: ${mcpToolCalls(server)}`,
		]
		if (server?.error) {
			lines.push(`error: ${typeof server.error === "string" ? server.error : JSON.stringify(server.error)}`)
		}
		try {
			await context.ui.dialog.alert({ title: `MCP — ${name}`, message: lines.join("\n") })
		} catch (error) {
			trace(`mcp details failed: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	const openConfigAudit = async () => {
		const plugins = visiblePlugins()
		const failedPlugins = plugins.filter((plugin: any) => plugin?.state?.status === "failed")
		const inactivePlugins = plugins.filter(
			(plugin: any) => plugin?.state?.status !== "active" && plugin?.state?.status !== "failed",
		)
		const quietServerPlugins = plugins.filter(
			(plugin: any) => plugin?.state?.status === "active" && plugin?.features?.server && pluginToolCalls(plugin) === 0,
		)
		const failedMCPs = mcp().filter(mcpProblem)
		const inactiveMCPs = mcp().filter((server: any) => !mcpActive(server) && !mcpProblem(server))
		const quietMCPs = mcp().filter(
			(server: any) => mcpActive(server) && mcpToolCalls(server) === 0 && mcpResourcesFor(server) === 0,
		)
		const lines: string[] = []
		const add = (items: any[], label: string, name: (item: any) => string) => {
			if (items.length === 0) return
			const shown = items.slice(0, 8).map(name).join(", ")
			lines.push(`${label} (${items.length}): ${shown}${items.length > 8 ? " …" : ""}`)
		}
		add(failedPlugins, "Failed plugins", (plugin) => String(plugin?.id ?? "unknown"))
		add(inactivePlugins, "Inactive plugins", (plugin) => String(plugin?.id ?? "unknown"))
		add(failedMCPs, "MCP errors", (server) => String(server?.name ?? server?.id ?? "unknown"))
		add(inactiveMCPs, "MCP inactive", (server) => String(server?.name ?? server?.id ?? "unknown"))
		add(quietMCPs, "MCP with no session calls/resources", (server) => String(server?.name ?? server?.id ?? "unknown"))
		add(quietServerPlugins, "Server plugins with no tracked tool calls", (plugin) => String(plugin?.id ?? "unknown"))
		if (lines.length === 0) lines.push("No failed, inactive, or unused entries in this session.")
		else lines.push("", "No tracked tool calls does not mean a TUI-only plugin is unused.")
		try {
			await context.ui.dialog.alert({ title: "Config audit", message: lines.join("\n") })
		} catch (error) {
			trace(`config audit failed: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	const [allSessions, setAllSessions] = createSignal<any[]>([])
	const refreshSessionUsage = () => {
		const rows = readSessionUsageFromDb()
		trace(`session usage rows: ${rows.length}`)
		if (rows.length > 0) setAllSessions(rows)
	}
	createEffect(() => {
		if (settings.collapsed?.budget) return
		refreshSessionUsage()
		const timer = setInterval(refreshSessionUsage, 60_000)
		onCleanup(() => clearInterval(timer))
	})

	const sessionUsageSummary = createMemo(() => {
		const sessions = allSessions().length > 0 ? allSessions() : (context.data.session.list() ?? [])
		const cost = sessions.reduce((sum, session: any) => sum + safeNumber(session?.cost), 0)
		return sessions.length > 0 ? `${sessions.length} · ${formatMoney(cost)}` : "usage"
	})

	const showCrossSessionUsage = async () => {
		trace("cross-session usage requested")
		let sessions: any[] = allSessions()
		if (sessions.length === 0) {
			sessions = readSessionUsageFromDb()
			if (sessions.length > 0) setAllSessions(sessions)
		}
		if (sessions.length === 0) {
			sessions = context.data.session.list() ?? []
		}
		if (sessions.length === 0) {
			try {
				const client: any = context.client as any
				const list = client.session?.list
				if (typeof list === "function") {
					let response: any
					try {
						response = await list.call(client.session, {})
					} catch {
						response = await list.call(client.session)
					}
					sessions = response?.data ?? []
				}
			} catch (error) {
				trace(`session list fallback failed: ${error instanceof Error ? error.message : String(error)}`)
			}
		}
		if (sessions.length === 0) {
			context.ui.toast.show({
				title: "Usage",
				message: "No sessions returned by the host",
				variant: "warning",
				duration: 2500,
			})
			return
		}
		const report = buildUsageReport(sessions)
		const recent = sessions
			.slice()
			.toSorted((left, right) => safeNumber(right?.time?.updated) - safeNumber(left?.time?.updated))
			.slice(0, 5)
		const options = [
			{
				title: "Sessions",
				value: "summary:sessions",
				description: `${sessions.length} including inactive`,
				category: "Summary",
			},
			{
				title: "Spend",
				value: "summary:spend",
				description: formatMoney(report.total.cost),
				category: "Summary",
			},
			{
				title: "Tokens",
				value: "summary:tokens",
				description: `${compactNumber(report.total.input)} in · ${compactNumber(report.total.output)} out`,
				category: "Summary",
			},
			{
				title: "Cache",
				value: "summary:cache",
				description: `${compactNumber(report.total.cacheRead)} read · ${compactNumber(report.total.cacheWrite)} write`,
				category: "Summary",
			},
			...report.topModels.map(([key, row], index) => ({
				title: key,
				value: `model:${index}`,
				description: `${formatMoney(row.cost)} · ${compactNumber(row.input)} in · ${compactNumber(row.output)} out`,
				category: "Models",
			})),
			...recent.map((session, index) => ({
				title: String(session?.title ?? session?.id ?? "session"),
				value: `recent:${index}`,
				description: `${formatMoney(safeNumber(session?.cost))} · ${session?.model?.providerID ?? "?"}/${session?.model?.id ?? "?"}`,
				category: "Recent sessions",
			})),
		]
		try {
			await context.ui.dialog.select({
				title: "Usage — all sessions",
				placeholder: "Search summary, models, or recent sessions",
				options,
				search: (query, items) => {
					const q = query.trim().toLowerCase()
					if (!q) return items
					return items.filter((item) =>
						`${item.title} ${item.description ?? ""} ${item.category ?? ""}`.toLowerCase().includes(q),
					)
				},
			})
		} catch (error) {
			trace(`cross-session usage failed: ${error instanceof Error ? error.message : String(error)}`)
			context.ui.toast.show({
				title: "Usage",
				message: `${sessions.length} sessions · ${formatMoney(report.total.cost)} total`,
				variant: "warning",
				duration: 3000,
			})
		}
	}

	const openSidebarSettings = async () => {
		const section = (id: string, label: string) => ({
			title: `${label}: ${settings.collapsed?.[id] ? "collapsed" : "expanded"}`,
			value: id,
			description: "Toggle this section",
		})
		for (;;) {
			let picked: string | undefined
			try {
				picked = await context.ui.dialog.select<string>({
					title: "Sidebar settings",
					placeholder: "Choose a setting",
					options: [
						section("mcp", "MCP"),
						section("budget", "Budget"),
						section("context", "Context"),
						section("plugins", "Plugins"),
						section("skills", "Skills"),
						section("todo", "Todo"),
						{
							title: `Completed todos: ${settings.showCompleted ? "shown" : "hidden"}`,
							value: "completed",
							description: "Show or hide completed todos",
						},
						{
							title: `Compact lists: ${settings.compact ? "on" : "off"}`,
							value: "compact",
							description: "Use four-item section limits",
						},
						{ title: "Reset section layout", value: "reset-layout", description: "Expand all sections and disable compact mode" },
						{ title: "Reset pinned skills", value: "reset-pins", description: "Clear all skill pins" },
					],
				})
			} catch (error) {
				trace(`sidebar settings failed: ${error instanceof Error ? error.message : String(error)}`)
				return
			}
			if (!picked) return
			if (picked === "completed") toggleShowCompleted()
			else if (picked === "compact") toggleCompact()
			else if (picked === "reset-layout") resetLayout()
			else if (picked === "reset-pins") resetPins()
			else toggleSection(picked)
			context.ui.toast.show({ title: "Sidebar settings", message: "Updated", variant: "info", duration: 1200 })
		}
	}

	context.keymap.layer(() => ({
		mode: "global",
		commands: [
			{
				id: "oc-sidebar.settings",
				title: "Sidebar: settings",
				description: "Toggle sections, compact lists, completed todos, and pinned skills",
				group: "Sidebar",
				palette: true,
				slash: { name: "sidebar" },
				run: () => void openSidebarSettings(),
			},
			{
				id: "oc-sidebar.usage",
				title: "Usage: cross-session spend",
				description: "Spend, tokens, and model breakdown across loaded sessions",
				group: "Sidebar",
				palette: true,
				slash: { name: "usage" },
				run: () => void showCrossSessionUsage(),
			},
		],
	}))

	const MCPPanel = () => {
		const list = () => mcpSorted()
		const visible = () => shown(list(), "mcp")
		const activeCount = () => list().filter(mcpActive).length
		const failedCount = () => list().filter(mcpProblem).length
		const count = () => `${activeCount()}/${list().length}${failedCount() ? ` !${failedCount()}` : ""}`
		return (
			<Panel
				id="mcp"
				title="MCP"
				count={list().length > 0 ? count() : undefined}
				action={
					<box flexDirection="row" onMouseDown={() => void refreshMCP()}>
						<text fg={muted()}>[r]</text>
					</box>
				}
			>
				{list().length === 0 ? (
					<text fg={muted()}>None</text>
				) : (
					visible().map((server: any) => {
						const status = mcpStatus(server)
						const problem = mcpProblem(server)
						const resources = mcpResourcesFor(server)
						const calls = mcpToolCalls(server)
						const label = `${server?.name ?? server?.id ?? "server"} - ${status}${resources > 0 ? ` · ${resources} res` : ""}${calls > 0 ? ` · ${calls} calls` : ""}`
						return (
							<box flexDirection="row" gap={1}>
								<box
									flexDirection="row"
									gap={1}
									flexGrow={1}
									flexShrink={1}
									minWidth={0}
									onMouseDown={() => void showMCPDetails(server)}
								>
									<StatusDot status={() => status} />
									<text fg={problem ? error() : muted()} wrapMode="none">{clipText(label, 20)}</text>
								</box>
							</box>
						)
					})
				)}
				<More id="mcp" total={list().length} visible={visible().length} />
			</Panel>
		)
	}

	const BudgetPanel = () => {
		const view = () => budget()
		const warning = () => {
			const value = view()
			if (!value) return ""
			if (value.tone === "error") return "Low budget"
			if (value.tone === "warning") return "Budget low"
			return ""
		}
		return (
			<Panel
				id="budget"
				title="Budget"
				action={
					<box flexDirection="row" onMouseDown={() => void showCrossSessionUsage()}>
						<text fg={muted()}>Σ</text>
					</box>
				}
			>
				<box flexDirection="row" gap={1} height={1}>
					<Bar percent={() => view()?.percent ?? 0} colour={() => (view() ? toneColour(view()!.tone) : muted())} />
					<text fg={view() ? toneColour(view()!.tone) : muted()}>{view()?.barLabel ?? "Loading..."}</text>
				</box>
				<text fg={muted()} wrapMode="none">{clipText(view()?.detail ?? "", 22)}</text>
				{view()?.reset ? <text fg={muted()} wrapMode="none">{clipText(`resets ${view()!.reset}`, 22)}</text> : null}
				<text fg={muted()} wrapMode="none">{clipText(view()?.note ?? "", 22)}</text>
				{budgetStale() ? <text fg={toneColour("warning")}>stale</text> : null}
				{warning() ? <text fg={toneColour(view()!.tone)}>{warning()}</text> : null}
				<box flexDirection="row" onMouseDown={() => void showCrossSessionUsage()}>
					<text fg={accent()}>Σ {sessionUsageSummary()}</text>
				</box>
			</Panel>
		)
	}

	const ContextPanel = () => {
		const state = () => usage()
		const limitText = () => (state().contextWindow > 0 ? compactNumber(state().contextWindow) : "--")
		const colour = () => (state().percent >= 90 ? error() : state().percent >= 70 ? warning() : accent())
		const warningText = () =>
			state().percent >= 90 ? "Context high" : state().percent >= 70 ? "Context >70%" : ""
		const warningColour = () => (state().percent >= 90 ? error() : warning())
		return (
			<Panel id="context" title="Context">
				<box flexDirection="row" gap={1} height={1}>
					<Bar percent={() => state().percent} colour={() => colour()} />
					<text fg={colour()}>{state().percent}%</text>
				</box>
				<text fg={muted()} wrapMode="none">{`${compactNumber(state().tokens)} / ${limitText()} · ${formatMoney(sessionCost())}`}</text>
				<text fg={muted()}>{`cache ${state().cacheRate}% · ${state().tps.toFixed(1)} t/s`}</text>
				{warningText() ? <text fg={warningColour()}>{warningText()}</text> : null}
			</Panel>
		)
	}

	const PluginsPanel = () => {
		const list = () => visiblePlugins()
		const visible = () => shown(list(), "plugins")
		const activeCount = () => list().filter((plugin: any) => plugin?.state?.status === "active").length
		const failedCount = () => list().filter((plugin: any) => plugin?.state?.status === "failed").length
		const count = () => `${activeCount()}/${list().length}${failedCount() ? ` !${failedCount()}` : ""}`
		return (
			<Panel
				id="plugins"
				title="Plugins"
				count={list().length > 0 ? count() : undefined}
				action={
					<>
						<box flexDirection="row" onMouseDown={() => void openConfigAudit()}>
							<text fg={muted()}>[!]</text>
						</box>
						<box flexDirection="row" onMouseDown={() => void refreshPlugins(location(), true)}>
							<text fg={muted()}>[r]</text>
						</box>
					</>
				}
			>
				{list().length === 0 ? (
					<text fg={muted()}>None</text>
				) : (
					visible().map((plugin: any) => {
						const status = String(plugin?.state?.status ?? "unknown")
						const failed = status === "failed"
						const version = plugin?.version ?? plugin?.source?.version
						const calls = pluginToolCalls(plugin)
						const label = `${plugin?.id ?? plugin?.name ?? "plugin"}${version ? " " + version : ""}${calls > 0 ? ` · ${calls} calls` : ""}${failed ? " ! failed" : ""}`
						return (
							<box flexDirection="row" gap={1}>
								<box
									flexDirection="row"
									gap={1}
									flexGrow={1}
									flexShrink={1}
									minWidth={0}
									onMouseDown={() => void showPluginDetails(plugin)}
								>
									<StatusDot status={() => status} />
									<text fg={failed ? error() : muted()} wrapMode="none">{clipText(label, 20)}</text>
								</box>
							</box>
						)
					})
				)}
				<More id="plugins" total={list().length} visible={visible().length} />
			</Panel>
		)
	}

	const SkillsPanel = () => {
		const usageOf = (skill: any) => {
			const id = String(skill?.id ?? "")
			const name = String(skill?.name ?? "")
			return skillUsage().get(id) ?? skillUsage().get(name)
		}
		const isPinned = (skill: any) =>
			settings.pinned?.[String(skill?.id ?? "")] === true ||
			settings.pinned?.[String(skill?.name ?? "")] === true
		const list = () =>
			skills()
				.slice()
				.toSorted((left: any, right: any) => {
					const leftUsage = usageOf(left)
					const rightUsage = usageOf(right)
					return (
						Number(isPinned(right)) - Number(isPinned(left)) ||
						(rightUsage?.count ?? 0) - (leftUsage?.count ?? 0) ||
						(rightUsage?.lastUsed ?? 0) - (leftUsage?.lastUsed ?? 0) ||
						String(left?.name ?? left?.id ?? "").localeCompare(String(right?.name ?? right?.id ?? ""))
					)
				})
		const visible = () =>
			settings.expanded?.skills ? list() : list().slice(0, listLimit())
		const usedCount = () => list().filter((skill: any) => (usageOf(skill)?.count ?? 0) > 0).length
		return (
			<Panel
				id="skills"
				title="Skills"
				count={list().length > 0 ? `${usedCount()}/${list().length}` : undefined}
				action={
					<box flexDirection="row" onMouseDown={() => void openSkillSearch()}>
						<text fg={muted()}>[?]</text>
					</box>
				}
			>
				{list().length === 0 ? (
					<text fg={muted()}>None</text>
				) : (
					visible().map((skill: any) => {
						const id = String(skill?.id ?? "")
						const isUsed = (usageOf(skill)?.count ?? 0) > 0
						const pinned = isPinned(skill)
						return (
							<box flexDirection="row" gap={1}>
								<box
									flexDirection="row"
									gap={1}
									flexGrow={1}
									flexShrink={1}
									minWidth={0}
									onMouseDown={() => togglePin(id)}
								>
									<Dot on={() => isUsed} />
									<text fg={muted()} wrapMode="none">{clipText(skill?.name ?? skill?.id ?? "skill", 18)}</text>
									<text fg={pinned ? success() : muted()}>{pinned ? "★" : "☆"}</text>
								</box>
							</box>
						)
					})
				)}
				<More id="skills" total={list().length} visible={visible().length} />
			</Panel>
		)
	}

	const TodoPanel = () => {
		const list = () => todos()
		const showCompleted = () => settings.showCompleted ?? false
		const completed = () => list().filter((todo: any) => todo?.status === "completed")
		const open = () => list().filter((todo: any) => todo?.status !== "completed")
		const filtered = () => (showCompleted() ? list() : open())
		const visible = () => {
			if (showCompleted()) return filtered()
			return settings.expanded?.todo ? filtered().slice(0, 8) : filtered().slice(0, listLimit())
		}
		const percent = () => (list().length > 0 ? Math.round((completed().length / list().length) * 100) : 0)
		const count = () => `${completed().length}/${list().length}`
		const progress = () => `${percent()}%${timeLabel() ? ` · ${timeLabel()}` : ""}`
		const TodoMark = (props: { status: string | undefined }) => {
			if (props.status === "completed") return <text fg={success()}>[x]</text>
			if (props.status === "cancelled") return <text fg={muted()}>[-]</text>
			return <Dot on={() => props.status === "in_progress"} />
		}
		return (
			<Panel id="todo" title="Todo" count={list().length > 0 ? count() : undefined}>
				{list().length === 0 ? (
					<text fg={muted()}>No todos</text>
				) : (
					<>
						<text fg={muted()}>{progress()}</text>
						{visible().length === 0 ? <text fg={muted()}>All done</text> : null}
						{visible().map((todo: any) => (
							<box flexDirection="row" gap={1}>
								<TodoMark status={todo?.status} />
								<text fg={muted()}>{todo?.content ?? ""}</text>
							</box>
						))}
						{completed().length > 0 ? (
							<box flexDirection="row" onMouseDown={toggleShowCompleted}>
								<text fg={muted()}>
									{showCompleted() ? "Hide completed" : `Show ${completed().length} completed`}
								</text>
							</box>
						) : null}
					</>
				)}
				<More id="todo" total={filtered().length} visible={visible().length} />
			</Panel>
		)
	}

	return (
		<box flexDirection="column" gap={1}>
			<MCPPanel />
			<BudgetPanel />
			<ContextPanel />
			<PluginsPanel />
			<SkillsPanel />
			<TodoPanel />
		</box>
	)
}

export function setupSidebar(context: Plugin.Context) {
	context.ui.slot({
		append: "sidebar.content",
		render: (input) => <Sidebar sessionID={input.sessionID} />,
	})
}

export default Plugin.define({ id: "oc-sidebar.tui", setup: setupSidebar })
