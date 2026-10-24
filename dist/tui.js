// @bun
// src/tui.tsx
import { Plugin as Plugin3 } from "@opencode/plugin/tui";

// src/sidebar/tui.tsx
import { Plugin, usePlugin } from "@opencode/plugin/tui";
import { TextAttributes } from "@opentui/core";
import { appendFileSync, readFileSync } from "fs";
import { createRequire } from "module";
import { homedir, tmpdir } from "os";
import { join } from "path";
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";

// src/sidebar/todos.js
var TODO_STATUSES = ["pending", "in_progress", "completed", "cancelled"];
var TODO_PRIORITIES = ["high", "medium", "low"];
var MAX_TODOS = 100;
var MAX_TODO_CONTENT_LENGTH = 500;
function normalizeTodos(input) {
  if (input === null || typeof input !== "object" || !("todos" in input)) {
    throw new Error("todowrite requires a `todos` array");
  }
  const todos = input.todos;
  if (!Array.isArray(todos)) {
    throw new Error("`todos` must be an array");
  }
  if (todos.length > MAX_TODOS) {
    throw new Error(`at most ${MAX_TODOS} todos per list (got ${todos.length})`);
  }
  return todos.map((entry, index) => {
    if (entry === null || typeof entry !== "object") {
      throw new Error(`todo #${index + 1} must be an object`);
    }
    const item = entry;
    const content = typeof item.content === "string" ? item.content.trim() : "";
    if (!content) {
      throw new Error(`todo #${index + 1} requires a non-empty \`content\` string`);
    }
    if (content.length > MAX_TODO_CONTENT_LENGTH) {
      throw new Error(`todo #${index + 1} \`content\` is over ${MAX_TODO_CONTENT_LENGTH} characters`);
    }
    if (!TODO_STATUSES.includes(item.status)) {
      throw new Error(`todo #${index + 1} has invalid \`status\` (expected one of: ${TODO_STATUSES.join(", ")})`);
    }
    const todo = { content, status: item.status };
    if (item.priority !== undefined) {
      if (!TODO_PRIORITIES.includes(item.priority)) {
        throw new Error(`todo #${index + 1} has invalid \`priority\` (expected one of: ${TODO_PRIORITIES.join(", ")})`);
      }
      todo.priority = item.priority;
    }
    return todo;
  });
}
function hasOpenTodos(todos) {
  return todos.some((todo) => todo.status === "pending" || todo.status === "in_progress");
}

// src/sidebar/timing.js
function applyTodoWrite(state, todos, at) {
  const previous = state ?? {};
  const current = previous.current;
  const hasOpen = hasOpenTodos(todos);
  if (current) {
    const openBefore = current.items.filter((item) => item.status === "pending" || item.status === "in_progress");
    const continues = todos.some((todo) => openBefore.some((item) => item.content === todo.content));
    if (openBefore.length > 0 && hasOpen && !continues) {
      return { current: startRun(todos, at), last: closeRun(current, at, true) };
    }
  }
  if (!current) {
    if (!hasOpen)
      return previous;
    return { ...previous, current: startRun(todos, at) };
  }
  const run = { ...current, items: mergeItems(current.items, todos, at) };
  if (todos.length === 0) {
    return { ...previous, current: undefined, last: closeRun(run, at, true) };
  }
  if (!hasOpen) {
    return { ...previous, current: undefined, last: closeRun(run, at, false) };
  }
  return { ...previous, current: run };
}
function buildTiming(writes) {
  let state = {};
  for (const write of writes) {
    if (typeof write.at !== "number")
      continue;
    state = applyTodoWrite(state, write.todos, write.at);
  }
  return state;
}
function runElapsed(run, now) {
  return (run.endedAt ?? now) - run.startedAt;
}
function hasCompletedItem(run) {
  return run.items.some((item) => item.completedAt !== undefined);
}
function timingSummary(state, now) {
  const current = state?.current;
  if (current)
    return `running for ${formatDuration(runElapsed(current, now))}`;
  const last = state?.last;
  if (!last || last.endedAt === undefined)
    return;
  if (!last.abandoned && !hasCompletedItem(last))
    return;
  const label = last.abandoned ? "previous list abandoned after" : "finished in";
  return `${label} ${formatDuration(runElapsed(last, now))}`;
}
function formatDuration(ms) {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  if (hours > 0)
    return `${hours}h${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0)
    return `${minutes}m${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}
function startRun(todos, at) {
  return { startedAt: at, items: todos.map((todo) => initialItem(todo, at)) };
}
function initialItem(todo, at) {
  const item = { content: todo.content, status: todo.status };
  if (todo.status === "in_progress")
    item.startedAt = at;
  if (todo.status === "completed")
    item.completedAt = at;
  return item;
}
function mergeItems(existing, todos, at) {
  const byContent = new Map(existing.map((item) => [item.content, item]));
  return todos.map((todo) => {
    const previous = byContent.get(todo.content);
    const item = previous ? { ...previous, status: todo.status } : { content: todo.content, status: todo.status };
    if (todo.status === "in_progress" && item.startedAt === undefined)
      item.startedAt = at;
    if (todo.status === "completed" && item.completedAt === undefined)
      item.completedAt = at;
    return item;
  });
}
function closeRun(run, at, abandoned) {
  return { ...run, endedAt: at, ...abandoned ? { abandoned: true } : {} };
}

// src/sidebar/tui.tsx
import { jsxDEV, Fragment } from "@opentui/solid/jsx-dev-runtime";
var AUTH_FILE = join(homedir(), ".local", "share", "opencode", "auth.json");
var DB_FILE = join(homedir(), ".local", "share", "opencode", "opencode.db");
var USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
var BAR_WIDTH = 24;
var ZEN = "opencode";
var GO = "opencode-go";
function trace(message) {
  try {
    appendFileSync(join(tmpdir(), "oc-sidebar.log"), `${new Date().toISOString()} ${message}
`);
  } catch {}
}
function readSessionUsageFromDb() {
  try {
    const Database = loadBunDatabase();
    if (!Database)
      return [];
    const db = new Database(DB_FILE, { readonly: true });
    const columns = "id, title, cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write, model, time_updated, parent_id";
    let rows = [];
    try {
      rows = db.query(`SELECT ${columns} FROM session_v2 ORDER BY time_updated DESC LIMIT 500`).all();
    } catch {
      rows = db.query(`SELECT ${columns} FROM session ORDER BY time_updated DESC LIMIT 500`).all();
    }
    try {
      db.close?.();
    } catch {}
    return rows.map((row) => {
      let model = {};
      try {
        model = JSON.parse(String(row.model ?? "{}"));
      } catch {}
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
            write: Number(row.tokens_cache_write) || 0
          }
        },
        model: {
          providerID: model?.providerID ?? model?.provider ?? "?",
          id: model?.id ?? model?.modelID ?? "?"
        },
        parentID: row.parent_id ?? undefined,
        time: { updated: Number(row.time_updated) || 0 }
      };
    });
  } catch {
    return [];
  }
}
var sessionMessageCache;
function readSessionMessagesFromDb(sessionID) {
  try {
    const Database = loadBunDatabase();
    if (!Database)
      return [];
    const db = new Database(DB_FILE, { readonly: true });
    const meta = db.query("SELECT count(*) AS count, max(time_updated) AS updated FROM session_message WHERE session_id = ?").get(sessionID);
    const count = Number(meta?.count ?? 0);
    const updated = Number(meta?.updated ?? 0);
    if (sessionMessageCache && sessionMessageCache.sessionID === sessionID && sessionMessageCache.count === count && sessionMessageCache.updated === updated) {
      try {
        db.close?.();
      } catch {}
      return sessionMessageCache.messages;
    }
    const rows = db.query("SELECT data FROM session_message WHERE session_id = ? ORDER BY seq").all(sessionID);
    try {
      db.close?.();
    } catch {}
    const messages = [];
    for (const row of rows) {
      try {
        messages.push(JSON.parse(String(row.data ?? "{}")));
      } catch {}
    }
    sessionMessageCache = { sessionID, count, updated, messages };
    return messages;
  } catch {
    return [];
  }
}
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return;
  }
}
function openRouterKey() {
  const key = readJson(AUTH_FILE)?.openrouter?.key;
  return typeof key === "string" && key.length > 0 ? key : undefined;
}
function authKey(id) {
  const key = readJson(AUTH_FILE)?.[id]?.key;
  return typeof key === "string" && key.length > 0 ? key : undefined;
}
function loadBunDatabase() {
  const attempts = [
    () => import.meta.require?.("bun:sqlite"),
    () => globalThis.require?.("bun:sqlite"),
    () => createRequire(import.meta.url)("bun:sqlite"),
    () => Function("return require")()("bun:sqlite")
  ];
  for (const attempt of attempts) {
    try {
      const mod = attempt();
      if (mod?.Database)
        return mod.Database;
    } catch {}
  }
  return null;
}
function readDbKeys() {
  try {
    const Database = loadBunDatabase();
    if (!Database)
      return {};
    const db = new Database(DB_FILE, { readonly: true });
    const out = {};
    for (const row of db.query("SELECT integration_id, value FROM credential").all()) {
      const id = String(row.integration_id ?? "").trim();
      const key = JSON.parse(String(row.value ?? ""))?.key;
      if (id && typeof key === "string" && key.trim())
        out[id] = key.trim();
    }
    try {
      db.close?.();
    } catch {}
    return out;
  } catch {
    return {};
  }
}
function apiKeys() {
  const db = readDbKeys();
  const keys = [ZEN, GO].map((id) => db[id] ?? authKey(id)).filter((key) => Boolean(key));
  return [...new Set(keys)];
}
async function readGoUsage() {
  const keys = apiKeys();
  for (const key of keys) {
    try {
      const response = await fetch(USAGE_URL, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(1e4)
      });
      if (!response.ok)
        continue;
      const payload = await response.json();
      const usage = payload?.usage;
      if (usage?.rolling || usage?.weekly || usage?.monthly)
        return { usage };
    } catch {}
  }
  return;
}
function tightestWindow(usage) {
  const entries = [
    ["5h", usage.usage?.rolling],
    ["week", usage.usage?.weekly],
    ["month", usage.usage?.monthly]
  ];
  const windows = entries.filter(([, window2]) => window2 && Number.isFinite(window2.percent));
  if (windows.length === 0)
    return;
  const [name, window] = windows.reduce((left, right) => (right[1]?.percent ?? 0) > (left[1]?.percent ?? 0) ? right : left);
  return { name, percent: window.percent ?? 0, resetsAt: window.resetsAt };
}
async function readOpenRouter() {
  const key = openRouterKey();
  if (!key)
    return;
  try {
    const response = await fetch("https://openrouter.ai/api/v1/credits", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(1e4)
    });
    if (!response.ok)
      return;
    const payload = await response.json();
    const total = Number(payload?.data?.total_credits);
    const used = Number(payload?.data?.total_usage);
    if (!Number.isFinite(total) || !Number.isFinite(used))
      return;
    return { total, used };
  } catch {
    return;
  }
}
function formatMoney(value) {
  return `$${value.toFixed(2)}`;
}
function safeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function messageTokenCount(message) {
  const input = safeNumber(message?.tokens?.input);
  const output = safeNumber(message?.tokens?.output);
  const reasoning = safeNumber(message?.tokens?.reasoning);
  const cacheRead = safeNumber(message?.tokens?.cache?.read);
  const cacheWrite = safeNumber(message?.tokens?.cache?.write);
  return input + output + reasoning + cacheRead + cacheWrite;
}
function until(value) {
  if (!value)
    return;
  const at = new Date(value).getTime();
  if (!Number.isFinite(at))
    return;
  const ms = at - Date.now();
  if (ms <= 0)
    return;
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor(ms % 86400000 / 3600000);
  const minutes = Math.floor(ms % 3600000 / 60000);
  if (days > 0)
    return `${days}d ${hours}h`;
  if (hours > 0)
    return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
async function readBudgetView(providerID, sessionCost) {
  if (providerID === GO || providerID === ZEN) {
    const usage = await readGoUsage();
    const window = usage ? tightestWindow(usage) : undefined;
    if (window) {
      const used = Math.max(0, Math.min(100, window.percent));
      const remaining = 100 - used;
      const reset = until(window.resetsAt);
      return {
        title: providerID === GO ? "Budget - OpenCode Go" : "Budget - OpenCode Free",
        percent: remaining,
        barLabel: `${remaining}% left`,
        detail: `${window.name} ${used}% used`,
        note: providerID === GO ? "OpenCode Go quota" : "OpenCode Free/Zen quota",
        reset,
        tone: remaining >= 50 ? "success" : remaining >= 20 ? "warning" : "error"
      };
    }
    return {
      title: providerID === GO ? "Budget - OpenCode Go" : "Budget - OpenCode Free",
      percent: providerID === ZEN ? 100 : 0,
      barLabel: providerID === ZEN ? "Free" : "No quota",
      detail: providerID === ZEN ? "Free tier - no quota reported" : "No Go/Zen workspace key",
      note: `Session ${formatMoney(sessionCost)}`,
      tone: "accent"
    };
  }
  if (!providerID || providerID === "openrouter") {
    const credits = await readOpenRouter();
    if (credits && credits.total > 0) {
      const remaining = Math.max(0, credits.total - credits.used);
      const percent = Math.round(remaining / credits.total * 100);
      return {
        title: "Budget - OpenRouter",
        percent,
        barLabel: `${percent}% left`,
        detail: `${formatMoney(remaining)} left of ${formatMoney(credits.total)}`,
        note: `OpenRouter - ${formatMoney(credits.used)} used`,
        tone: percent >= 50 ? "success" : percent >= 20 ? "warning" : "error"
      };
    }
    return {
      title: "Budget - OpenRouter",
      percent: 0,
      barLabel: "No data",
      detail: "No OpenRouter credit data",
      note: `Session ${formatMoney(sessionCost)}`,
      tone: "accent"
    };
  }
  return {
    title: `Budget - ${providerID}`,
    percent: 0,
    barLabel: "No data",
    detail: `No budget source for ${providerID}`,
    note: `Session ${formatMoney(sessionCost)}`,
    tone: "accent"
  };
}
var statusHealthy = (status) => status === "active" || status === "connected";
var statusProblem = (status) => status === "failed" || status === "error" || status === "disconnected";
function timestampOf(part, message) {
  const candidates = [
    part?.time?.created,
    part?.time?.ran,
    part?.time?.completed,
    part?.state?.time?.created,
    part?.state?.time?.ran,
    part?.state?.time?.completed
  ];
  for (const value of candidates)
    if (typeof value === "number")
      return value;
  if (typeof message?.time === "number")
    return message.time;
  const created = message?.time?.created;
  return typeof created === "number" ? created : 0;
}
function compactNumber(value) {
  const number = Math.max(0, Math.round(value));
  if (number >= 1e6)
    return `${(number / 1e6).toFixed(1)}M`;
  if (number >= 1000)
    return `${Math.round(number / 1000)}K`;
  return String(number);
}
function clipText(value, width) {
  const text = String(value ?? "");
  return text.length <= width ? text : text.slice(0, Math.max(1, width - 1)) + "\u2026";
}
function buildUsageReport(sessions) {
  const total = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  const models = new Map;
  for (const session of sessions) {
    total.cost += safeNumber(session?.cost);
    total.input += safeNumber(session?.tokens?.input);
    total.output += safeNumber(session?.tokens?.output);
    total.reasoning += safeNumber(session?.tokens?.reasoning);
    total.cacheRead += safeNumber(session?.tokens?.cache?.read);
    total.cacheWrite += safeNumber(session?.tokens?.cache?.write);
    const key = `${session?.model?.providerID ?? "?"}/${session?.model?.id ?? session?.model?.modelID ?? "?"}`;
    const row = models.get(key) ?? { cost: 0, input: 0, output: 0 };
    row.cost += safeNumber(session?.cost);
    row.input += safeNumber(session?.tokens?.input);
    row.output += safeNumber(session?.tokens?.output);
    models.set(key, row);
  }
  const topModels = [...models.entries()].toSorted((left, right) => right[1].cost - left[1].cost).slice(0, 5);
  const recent = sessions.slice().toSorted((left, right) => safeNumber(right?.time?.updated) - safeNumber(left?.time?.updated)).slice(0, 5);
  return { total, topModels, recent };
}
function Sidebar(props) {
  const context = usePlugin();
  trace(`sidebar mount ${props.sessionID || "(none)"}`);
  const theme = () => context.theme;
  const text = () => theme().text.base;
  const muted = () => theme().text.muted;
  const accent = () => theme().text.action.primary.base;
  const success = () => theme().text.feedback.success.base;
  const warning = () => theme().text.feedback.warning.base;
  const error = () => theme().text.feedback.error.base;
  const toneColour = (tone) => tone === "success" ? success() : tone === "warning" ? warning() : tone === "error" ? error() : accent();
  const [settings, updateSettings] = context.storage.store("oc-sidebar.settings", {
    initial: { collapsed: {}, expanded: {}, pinned: {}, showCompleted: false, compact: false }
  });
  const toggleSection = (id) => void updateSettings((draft) => {
    draft.collapsed[id] = !draft.collapsed[id];
  });
  const toggleExpanded = (id) => void updateSettings((draft) => {
    draft.expanded[id] = !draft.expanded[id];
  });
  const toggleShowCompleted = () => void updateSettings((draft) => {
    draft.showCompleted = !draft.showCompleted;
  });
  const toggleCompact = () => void updateSettings((draft) => {
    draft.compact = !draft.compact;
  });
  const resetLayout = () => void updateSettings((draft) => {
    draft.collapsed = {};
    draft.expanded = {};
    draft.showCompleted = false;
    draft.compact = false;
  });
  const resetPins = () => void updateSettings((draft) => {
    draft.pinned = {};
  });
  const togglePin = (id) => {
    const pinned = !(settings.pinned?.[id] ?? false);
    updateSettings((draft) => {
      draft.pinned ??= {};
      draft.pinned[id] = pinned;
    });
    context.ui.toast.show({
      title: "Skills",
      message: `${pinned ? "Pinned" : "Unpinned"} ${id}`,
      variant: "info",
      duration: 1800
    });
  };
  const listLimit = () => {
    if (settings.compact)
      return 4;
    try {
      const height = Number(context.renderer?.height);
      if (Number.isFinite(height) && height > 0)
        return Math.max(3, Math.min(8, Math.floor(height / 12)));
    } catch {}
    return 6;
  };
  const shown = (list, id) => settings.expanded?.[id] ? list : list.slice(0, listLimit());
  const session = createMemo(() => {
    try {
      return context.data.session.get(props.sessionID);
    } catch {
      return;
    }
  });
  const location = createMemo(() => {
    try {
      const sessionLocation = session()?.location;
      if (sessionLocation?.directory)
        return sessionLocation;
      if (context.location?.directory)
        return context.location;
      const fallback = context.data.location.default();
      if (fallback?.directory)
        return fallback;
      const directory = sessionLocation?.directory ?? context.location?.directory ?? fallback?.directory ?? process.cwd();
      return directory ? { directory } : undefined;
    } catch {
      return;
    }
  });
  const messages = createMemo(() => {
    try {
      return context.data.session.message.list(props.sessionID) ?? [];
    } catch (error2) {
      trace(`messages unavailable: ${error2 instanceof Error ? error2.message : String(error2)}`);
      return [];
    }
  });
  const [usageTick, setUsageTick] = createSignal(0);
  createEffect(() => {
    props.sessionID;
    const timer2 = setInterval(() => {
      try {
        context.data.session.message.sync(props.sessionID);
      } catch {}
      setUsageTick((value) => value + 1);
    }, 2000);
    onCleanup(() => clearInterval(timer2));
  });
  const usageMessages = createMemo(() => {
    usageTick();
    const loaded = messages();
    const fromDb = readSessionMessagesFromDb(props.sessionID);
    return fromDb.length >= loaded.length ? fromDb : loaded;
  });
  const providerID = createMemo(() => {
    try {
      return String(context.ui.model.current()?.providerID ?? "");
    } catch {
      return "";
    }
  });
  createEffect(() => {
    try {
      context.data.session.message.sync(props.sessionID);
    } catch (error2) {
      trace(`message sync failed: ${error2 instanceof Error ? error2.message : String(error2)}`);
    }
  });
  createEffect(() => {
    try {
      context.data.location.model.sync(location());
    } catch {}
  });
  createEffect(() => {
    if (settings.collapsed?.mcp)
      return;
    try {
      context.data.location.mcp.server.sync(location());
    } catch {}
  });
  createEffect(() => {
    if (settings.collapsed?.mcp)
      return;
    try {
      context.data.location.mcp.resource.sync(location());
    } catch {}
  });
  createEffect(() => {
    if (settings.collapsed?.skills)
      return;
    try {
      context.data.location.skill.sync(location());
    } catch {}
  });
  const mcp = createMemo(() => {
    try {
      return context.data.location.mcp.server.list(location()) ?? [];
    } catch {
      return [];
    }
  });
  const mcpResources = createMemo(() => {
    try {
      return context.data.location.mcp.resource.list(location()) ?? [];
    } catch {
      return [];
    }
  });
  const mcpStatus = (server) => {
    const status = typeof server?.status === "string" ? server.status : server?.status?.status;
    return typeof status === "string" && status ? status : "unknown";
  };
  const mcpActive = (server) => statusHealthy(mcpStatus(server));
  const mcpProblem = (server) => statusProblem(mcpStatus(server));
  const mcpRank = (server) => mcpProblem(server) ? 0 : mcpActive(server) ? 1 : 2;
  const mcpResourceServer = (resource) => String(resource?.server ?? resource?.serverID ?? resource?.serverId ?? "");
  const mcpResourcesFor = (server) => {
    const id = String(server?.id ?? server?.name ?? "");
    if (!id)
      return 0;
    return mcpResources().filter((resource) => mcpResourceServer(resource) === id).length;
  };
  const mcpSorted = createMemo(() => mcp().slice().toSorted((left, right) => {
    return mcpRank(left) - mcpRank(right) || String(left?.name ?? left?.id ?? "").localeCompare(String(right?.name ?? right?.id ?? ""));
  }));
  const skills = createMemo(() => {
    try {
      return context.data.location.skill.list(location()) ?? [];
    } catch {
      return [];
    }
  });
  let indexSession = "";
  let indexProcessed = 0;
  let indexLastMessage;
  let indexSkills = new Map;
  let indexToolUsage = new Map;
  let indexTodos;
  let indexTodoAt = 0;
  let indexWrites = [];
  let indexTiming = undefined;
  let indexTodoParts = new Set;
  let indexView = {
    skills: indexSkills,
    tools: indexToolUsage,
    todos: undefined,
    timing: undefined
  };
  const resetIndex = () => {
    indexSession = props.sessionID;
    indexProcessed = 0;
    indexLastMessage = undefined;
    indexSkills = new Map;
    indexToolUsage = new Map;
    indexTodos = undefined;
    indexTodoAt = 0;
    indexWrites = [];
    indexTiming = undefined;
    indexTodoParts = new Set;
    indexView = { skills: indexSkills, tools: indexToolUsage, todos: undefined, timing: undefined };
  };
  const processMessage = (message, todoOnly) => {
    let changed = false;
    const content = message?.content;
    if (!Array.isArray(content))
      return false;
    for (const part of content) {
      if (part?.type !== "tool")
        continue;
      const name = String(part?.name ?? "");
      if (!todoOnly && name) {
        indexToolUsage.set(name, (indexToolUsage.get(name) ?? 0) + 1);
        changed = true;
      }
      if (!todoOnly && (name === "skill" || name.endsWith(".skill"))) {
        const input = part?.state?.input;
        const keys = [
          ...new Set([input?.id, input?.name].filter((value) => typeof value === "string" && value.length > 0))
        ];
        if (keys.length > 0) {
          for (const key of keys) {
            const usage2 = indexSkills.get(key) ?? { count: 0, lastUsed: 0 };
            usage2.count += 1;
            usage2.lastUsed = Math.max(usage2.lastUsed, timestampOf(part, message));
            indexSkills.set(key, usage2);
          }
          changed = true;
        }
      }
      if (name === "todowrite" && part?.state?.status === "completed") {
        try {
          const key = `${message?.id ?? ""}:${part?.id ?? ""}`;
          if (key !== ":" && indexTodoParts.has(key))
            continue;
          if (key !== ":")
            indexTodoParts.add(key);
          const list = normalizeTodos(part.state.input);
          const at = timestampOf(part, message);
          indexWrites.push({ at, todos: list });
          indexTiming = buildTiming(indexWrites);
          if (!indexTodos || at >= indexTodoAt) {
            indexTodos = list;
            indexTodoAt = at;
          }
          changed = true;
        } catch {}
      }
    }
    return changed;
  };
  const messageIndex = createMemo(() => {
    const list = usageMessages();
    if (indexSession !== props.sessionID || list.length < indexProcessed)
      resetIndex();
    let changed = false;
    for (let i = indexProcessed;i < list.length; i++) {
      if (processMessage(list[i], false))
        changed = true;
    }
    const last = list.at(-1);
    if (last && indexProcessed === list.length && last !== indexLastMessage) {
      if (processMessage(last, true))
        changed = true;
    }
    indexLastMessage = last;
    indexProcessed = list.length;
    if (changed)
      indexView = { skills: indexSkills, tools: indexToolUsage, todos: indexTodos, timing: indexTiming };
    return indexView;
  });
  const skillUsage = createMemo(() => messageIndex().skills);
  const toolUsage = createMemo(() => messageIndex().tools);
  const PLUGIN_TOOLS = {
    "aiev.todolist": ["todowrite", "todoread"],
    "opencode-todolist": ["todowrite", "todoread"]
  };
  const pluginToolCalls = (plugin) => {
    const names = PLUGIN_TOOLS[String(plugin?.id ?? "")] ?? [];
    return names.reduce((sum, name) => sum + (toolUsage().get(name) ?? 0), 0);
  };
  const mcpToolCalls = (server) => {
    const name = String(server?.name ?? server?.id ?? "").toLowerCase();
    if (!name)
      return 0;
    let total = 0;
    for (const [tool, count] of toolUsage()) {
      const lower = tool.toLowerCase();
      if (lower === name || lower.startsWith(`${name}_`) || lower.startsWith(`${name}.`) || lower.startsWith(`${name}:`)) {
        total += count;
      }
    }
    return total;
  };
  const todoTiming = createMemo(() => messageIndex().timing);
  const [now, setNow] = createSignal(Date.now());
  createEffect(() => {
    const timing = todoTiming();
    if (!timing?.current)
      return;
    setNow(Date.now());
    const timer2 = setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => clearInterval(timer2));
  });
  const timeLabel = () => timingSummary(todoTiming(), now());
  const modelList = () => {
    try {
      return context.data.location.model.list(location()) ?? [];
    } catch {
      return [];
    }
  };
  const [plugins, setPlugins] = createSignal([]);
  const refreshPlugins = async (loc, force = false) => {
    if (!force && settings.collapsed?.plugins)
      return;
    try {
      const response = await context.client.plugin.list(loc ? { location: loc } : {});
      setPlugins(response?.data ?? []);
    } catch (error2) {
      trace(`plugin list failed: ${error2 instanceof Error ? error2.message : String(error2)}`);
      setPlugins([]);
    }
  };
  createEffect(() => {
    const loc = location();
    if (settings.collapsed?.plugins)
      return;
    refreshPlugins(loc);
    const timer2 = setInterval(() => void refreshPlugins(loc), 15000);
    onCleanup(() => clearInterval(timer2));
  });
  const pluginRank = (plugin) => {
    const status = plugin?.state?.status;
    return status === "failed" ? 0 : status === "active" ? 1 : 2;
  };
  const visiblePlugins = createMemo(() => plugins().filter((plugin) => plugin?.source?.type !== "builtin").toSorted((left, right) => {
    return pluginRank(left) - pluginRank(right) || String(left?.id ?? "").localeCompare(String(right?.id ?? ""));
  }));
  createEffect(() => {
    trace(`data loc=${location()?.directory ?? "(none)"} mcp=${mcp().length} resources=${mcpResources().length} skills=${skills().length} plugins=${visiblePlugins().length} messages=${messages().length} usage=${usageMessages().length}`);
  });
  const todos = createMemo(() => messageIndex().todos ?? []);
  const sessionCost = createMemo(() => {
    const fromSession = safeNumber(session()?.cost);
    if (fromSession > 0)
      return fromSession;
    return messages().filter((message) => message?.type === "assistant").reduce((sum, message) => sum + safeNumber(message?.cost), 0);
  });
  const usage = createMemo(() => {
    const lastAssistant = messages().findLast((message) => {
      const output2 = safeNumber(message?.tokens?.output);
      return message?.type === "assistant" && output2 > 0;
    });
    if (!lastAssistant)
      return { tokens: 0, contextWindow: 0, percent: 0, cacheRate: 0, tps: 0 };
    const tokens = messageTokenCount(lastAssistant);
    const provider = lastAssistant?.model?.providerID;
    const modelID = lastAssistant?.model?.id;
    const model = modelList().find((item) => item.providerID === provider && (item.id === modelID || item.modelID === modelID));
    const contextWindow = safeNumber(model?.limit?.context);
    const percent = contextWindow > 0 ? Math.round(tokens / contextWindow * 100) : 0;
    const cacheRead = safeNumber(lastAssistant?.tokens?.cache?.read);
    const cacheWrite = safeNumber(lastAssistant?.tokens?.cache?.write);
    const input = safeNumber(lastAssistant?.tokens?.input);
    const cacheDenom = cacheRead + cacheWrite + input;
    const cacheRate = cacheDenom > 0 ? Math.round(cacheRead / cacheDenom * 100) : 0;
    const output = safeNumber(lastAssistant?.tokens?.output) + safeNumber(lastAssistant?.tokens?.reasoning);
    const started = safeNumber(lastAssistant?.time?.created);
    const ended = safeNumber(lastAssistant?.time?.completed ?? lastAssistant?.time?.streamed);
    const seconds = ended > started ? (ended - started) / 1000 : 0;
    const tps = seconds > 0 ? output / seconds : 0;
    return { tokens, contextWindow, percent, cacheRate, tps };
  });
  const [budget, setBudget] = createSignal(undefined);
  const [budgetStale, setBudgetStale] = createSignal(false);
  let budgetFailures = 0;
  let budgetRetryAt = 0;
  const refreshBudget = async (force = false) => {
    if (!force && (settings.collapsed?.budget || Date.now() < budgetRetryAt))
      return;
    const pid = providerID();
    const cost = sessionCost();
    try {
      const view = await readBudgetView(pid, cost);
      trace(`budget ${view.title} ${view.barLabel}`);
      setBudget(view);
      setBudgetStale(false);
      budgetFailures = 0;
      budgetRetryAt = 0;
    } catch (error2) {
      budgetFailures += 1;
      budgetRetryAt = Date.now() + Math.min(5 * 60000, 5000 * 2 ** Math.min(budgetFailures, 6));
      trace(`budget failed (${budgetFailures}): ${error2 instanceof Error ? error2.message : String(error2)}`);
      if (!budget()) {
        setBudget({
          title: `Budget - ${pid || "OpenRouter"}`,
          percent: 0,
          barLabel: "No data",
          detail: "Budget lookup failed",
          note: `Session ${formatMoney(cost)}`,
          tone: "accent"
        });
      }
      setBudgetStale(true);
    }
  };
  createEffect(() => {
    providerID();
    sessionCost();
    if (!settings.collapsed?.budget)
      refreshBudget(true);
  });
  const timer = setInterval(() => {
    if (!settings.collapsed?.budget)
      refreshBudget();
  }, 60000);
  onCleanup(() => clearInterval(timer));
  const Bar = (props2) => {
    const filled = () => {
      const percent = Math.max(0, Math.min(100, props2.percent()));
      return Math.max(0, Math.min(BAR_WIDTH, Math.round(percent / 100 * BAR_WIDTH)));
    };
    const track = () => theme().background?.raised?.high ?? theme().background?.raised?.base ?? theme().border?.base ?? "#2a2a2a";
    return /* @__PURE__ */ jsxDEV("box", {
      flexDirection: "row",
      flexShrink: 0,
      height: 1,
      children: [
        filled() > 0 ? /* @__PURE__ */ jsxDEV("box", {
          width: filled(),
          height: 1,
          backgroundColor: props2.colour()
        }, undefined, false, undefined, this) : null,
        BAR_WIDTH - filled() > 0 ? /* @__PURE__ */ jsxDEV("box", {
          width: BAR_WIDTH - filled(),
          height: 1,
          backgroundColor: track()
        }, undefined, false, undefined, this) : null
      ]
    }, undefined, true, undefined, this);
  };
  const Dot = (props2) => /* @__PURE__ */ jsxDEV("box", {
    flexDirection: "row",
    flexShrink: 0,
    height: 1,
    children: [
      /* @__PURE__ */ jsxDEV("text", {
        fg: muted(),
        children: "["
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV("text", {
        fg: props2.on() ? success() : muted(),
        children: props2.on() ? "\u2022" : " "
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV("text", {
        fg: muted(),
        children: "]"
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
  const StatusDot = (props2) => /* @__PURE__ */ jsxDEV("box", {
    flexDirection: "row",
    flexShrink: 0,
    height: 1,
    children: [
      /* @__PURE__ */ jsxDEV("text", {
        fg: muted(),
        children: "["
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV("text", {
        fg: statusHealthy(props2.status()) ? success() : statusProblem(props2.status()) ? error() : muted(),
        children: statusHealthy(props2.status()) ? "\u2022" : statusProblem(props2.status()) ? "\xD7" : " "
      }, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV("text", {
        fg: muted(),
        children: "]"
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
  const Panel = (props2) => {
    const collapsed = () => settings.collapsed?.[props2.id] ?? false;
    return /* @__PURE__ */ jsxDEV("box", {
      flexDirection: "column",
      children: [
        /* @__PURE__ */ jsxDEV("box", {
          flexDirection: "row",
          gap: 1,
          children: [
            /* @__PURE__ */ jsxDEV("box", {
              flexDirection: "row",
              onMouseDown: () => toggleSection(props2.id),
              children: /* @__PURE__ */ jsxDEV("text", {
                fg: text(),
                attributes: TextAttributes.BOLD,
                children: [
                  collapsed() ? "\u25B8" : "\u25BE",
                  " ",
                  props2.title
                ]
              }, undefined, true, undefined, this)
            }, undefined, false, undefined, this),
            props2.count ? /* @__PURE__ */ jsxDEV("text", {
              fg: muted(),
              children: props2.count
            }, undefined, false, undefined, this) : null,
            props2.action ?? null
          ]
        }, undefined, true, undefined, this),
        collapsed() ? null : /* @__PURE__ */ jsxDEV("box", {
          flexDirection: "column",
          children: props2.children
        }, undefined, false, undefined, this)
      ]
    }, undefined, true, undefined, this);
  };
  const More = (props2) => {
    const expanded = () => settings.expanded?.[props2.id] ?? false;
    if (props2.total === 0)
      return null;
    if (expanded()) {
      return /* @__PURE__ */ jsxDEV("box", {
        flexDirection: "row",
        onMouseDown: () => toggleExpanded(props2.id),
        children: /* @__PURE__ */ jsxDEV("text", {
          fg: muted(),
          children: "- less"
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this);
    }
    if (props2.total <= props2.visible)
      return null;
    return /* @__PURE__ */ jsxDEV("box", {
      flexDirection: "row",
      onMouseDown: () => toggleExpanded(props2.id),
      children: /* @__PURE__ */ jsxDEV("text", {
        fg: muted(),
        children: `+${props2.total - props2.visible} more`
      }, undefined, false, undefined, this)
    }, undefined, false, undefined, this);
  };
  const openSkillSearch = async () => {
    const list = skills();
    if (list.length === 0) {
      context.ui.toast.show({ title: "Skills", message: "No skills found", variant: "info", duration: 1800 });
      return;
    }
    const options = list.map((skill) => ({
      title: String(skill?.name ?? skill?.id ?? "skill"),
      value: String(skill?.id ?? ""),
      description: typeof skill?.description === "string" ? skill.description : undefined
    }));
    try {
      const picked = await context.ui.dialog.select({
        title: "Skills \u2014 select to pin or unpin",
        placeholder: "Search skills",
        options,
        search: (query, items) => {
          const q = query.trim().toLowerCase();
          if (!q)
            return items;
          return items.filter((item) => `${item.title} ${item.description ?? ""}`.toLowerCase().includes(q));
        }
      });
      if (picked)
        togglePin(picked);
    } catch (error2) {
      trace(`skill search failed: ${error2 instanceof Error ? error2.message : String(error2)}`);
    }
  };
  const showPluginDetails = async (plugin) => {
    const status = String(plugin?.state?.status ?? "unknown");
    const version = plugin?.version ?? plugin?.source?.version ?? "\u2014";
    const source = plugin?.source?.type === "local" ? plugin.source.path : plugin?.source?.type === "package" ? `${plugin.source.target}${plugin.source.version ? "@" + plugin.source.version : ""}` : plugin?.source?.type ?? "unknown";
    const features = plugin?.features ?? {};
    const lines = [
      `status: ${status}`,
      `version: ${version}`,
      `source: ${source}`,
      `tool calls: ${pluginToolCalls(plugin)}`,
      `server: ${features.server ? "yes" : "no"}  tui: ${features.tui ? "yes" : "no"}  rpc: ${features.rpc ? "yes" : "no"}`
    ];
    if (plugin?.state?.error)
      lines.push(`error: ${plugin.state.error}`);
    try {
      await context.ui.dialog.alert({
        title: `Plugin \u2014 ${plugin?.id ?? "unknown"}`,
        message: lines.join(`
`)
      });
    } catch (error2) {
      trace(`plugin details failed: ${error2 instanceof Error ? error2.message : String(error2)}`);
    }
  };
  const refreshMCP = async () => {
    const loc = location();
    try {
      await Promise.allSettled([
        context.data.location.mcp.server.sync(loc),
        context.data.location.mcp.resource.sync(loc)
      ]);
    } catch (error2) {
      trace(`mcp refresh failed: ${error2 instanceof Error ? error2.message : String(error2)}`);
    }
  };
  const showMCPDetails = async (server) => {
    const name = String(server?.name ?? server?.id ?? "server");
    const lines = [
      `status: ${mcpStatus(server)}`,
      `resources: ${mcpResourcesFor(server)} / ${mcpResources().length} total`,
      `tool calls: ${mcpToolCalls(server)}`
    ];
    if (server?.error) {
      lines.push(`error: ${typeof server.error === "string" ? server.error : JSON.stringify(server.error)}`);
    }
    try {
      await context.ui.dialog.alert({ title: `MCP \u2014 ${name}`, message: lines.join(`
`) });
    } catch (error2) {
      trace(`mcp details failed: ${error2 instanceof Error ? error2.message : String(error2)}`);
    }
  };
  const openConfigAudit = async () => {
    const plugins2 = visiblePlugins();
    const failedPlugins = plugins2.filter((plugin) => plugin?.state?.status === "failed");
    const inactivePlugins = plugins2.filter((plugin) => plugin?.state?.status !== "active" && plugin?.state?.status !== "failed");
    const quietServerPlugins = plugins2.filter((plugin) => plugin?.state?.status === "active" && plugin?.features?.server && pluginToolCalls(plugin) === 0);
    const failedMCPs = mcp().filter(mcpProblem);
    const inactiveMCPs = mcp().filter((server) => !mcpActive(server) && !mcpProblem(server));
    const quietMCPs = mcp().filter((server) => mcpActive(server) && mcpToolCalls(server) === 0 && mcpResourcesFor(server) === 0);
    const lines = [];
    const add = (items, label, name) => {
      if (items.length === 0)
        return;
      const shown2 = items.slice(0, 8).map(name).join(", ");
      lines.push(`${label} (${items.length}): ${shown2}${items.length > 8 ? " \u2026" : ""}`);
    };
    add(failedPlugins, "Failed plugins", (plugin) => String(plugin?.id ?? "unknown"));
    add(inactivePlugins, "Inactive plugins", (plugin) => String(plugin?.id ?? "unknown"));
    add(failedMCPs, "MCP errors", (server) => String(server?.name ?? server?.id ?? "unknown"));
    add(inactiveMCPs, "MCP inactive", (server) => String(server?.name ?? server?.id ?? "unknown"));
    add(quietMCPs, "MCP with no session calls/resources", (server) => String(server?.name ?? server?.id ?? "unknown"));
    add(quietServerPlugins, "Server plugins with no tracked tool calls", (plugin) => String(plugin?.id ?? "unknown"));
    if (lines.length === 0)
      lines.push("No failed, inactive, or unused entries in this session.");
    else
      lines.push("", "No tracked tool calls does not mean a TUI-only plugin is unused.");
    try {
      await context.ui.dialog.alert({ title: "Config audit", message: lines.join(`
`) });
    } catch (error2) {
      trace(`config audit failed: ${error2 instanceof Error ? error2.message : String(error2)}`);
    }
  };
  const [allSessions, setAllSessions] = createSignal([]);
  const refreshSessionUsage = () => {
    const rows = readSessionUsageFromDb();
    trace(`session usage rows: ${rows.length}`);
    if (rows.length > 0)
      setAllSessions(rows);
  };
  createEffect(() => {
    if (settings.collapsed?.budget)
      return;
    refreshSessionUsage();
    const timer2 = setInterval(refreshSessionUsage, 60000);
    onCleanup(() => clearInterval(timer2));
  });
  const sessionUsageSummary = createMemo(() => {
    const sessions = allSessions().length > 0 ? allSessions() : context.data.session.list() ?? [];
    const cost = sessions.reduce((sum, session2) => sum + safeNumber(session2?.cost), 0);
    return sessions.length > 0 ? `${sessions.length} \xB7 ${formatMoney(cost)}` : "usage";
  });
  const showCrossSessionUsage = async () => {
    trace("cross-session usage requested");
    let sessions = allSessions();
    if (sessions.length === 0) {
      sessions = readSessionUsageFromDb();
      if (sessions.length > 0)
        setAllSessions(sessions);
    }
    if (sessions.length === 0) {
      sessions = context.data.session.list() ?? [];
    }
    if (sessions.length === 0) {
      try {
        const client = context.client;
        const list = client.session?.list;
        if (typeof list === "function") {
          let response;
          try {
            response = await list.call(client.session, {});
          } catch {
            response = await list.call(client.session);
          }
          sessions = response?.data ?? [];
        }
      } catch (error2) {
        trace(`session list fallback failed: ${error2 instanceof Error ? error2.message : String(error2)}`);
      }
    }
    if (sessions.length === 0) {
      context.ui.toast.show({
        title: "Usage",
        message: "No sessions returned by the host",
        variant: "warning",
        duration: 2500
      });
      return;
    }
    const report = buildUsageReport(sessions);
    const recent = sessions.slice().toSorted((left, right) => safeNumber(right?.time?.updated) - safeNumber(left?.time?.updated)).slice(0, 5);
    const options = [
      {
        title: "Sessions",
        value: "summary:sessions",
        description: `${sessions.length} including inactive`,
        category: "Summary"
      },
      {
        title: "Spend",
        value: "summary:spend",
        description: formatMoney(report.total.cost),
        category: "Summary"
      },
      {
        title: "Tokens",
        value: "summary:tokens",
        description: `${compactNumber(report.total.input)} in \xB7 ${compactNumber(report.total.output)} out`,
        category: "Summary"
      },
      {
        title: "Cache",
        value: "summary:cache",
        description: `${compactNumber(report.total.cacheRead)} read \xB7 ${compactNumber(report.total.cacheWrite)} write`,
        category: "Summary"
      },
      ...report.topModels.map(([key, row], index) => ({
        title: key,
        value: `model:${index}`,
        description: `${formatMoney(row.cost)} \xB7 ${compactNumber(row.input)} in \xB7 ${compactNumber(row.output)} out`,
        category: "Models"
      })),
      ...recent.map((session2, index) => ({
        title: String(session2?.title ?? session2?.id ?? "session"),
        value: `recent:${index}`,
        description: `${formatMoney(safeNumber(session2?.cost))} \xB7 ${session2?.model?.providerID ?? "?"}/${session2?.model?.id ?? "?"}`,
        category: "Recent sessions"
      }))
    ];
    try {
      await context.ui.dialog.select({
        title: "Usage \u2014 all sessions",
        placeholder: "Search summary, models, or recent sessions",
        options,
        search: (query, items) => {
          const q = query.trim().toLowerCase();
          if (!q)
            return items;
          return items.filter((item) => `${item.title} ${item.description ?? ""} ${item.category ?? ""}`.toLowerCase().includes(q));
        }
      });
    } catch (error2) {
      trace(`cross-session usage failed: ${error2 instanceof Error ? error2.message : String(error2)}`);
      context.ui.toast.show({
        title: "Usage",
        message: `${sessions.length} sessions \xB7 ${formatMoney(report.total.cost)} total`,
        variant: "warning",
        duration: 3000
      });
    }
  };
  const openSidebarSettings = async () => {
    const section = (id, label) => ({
      title: `${label}: ${settings.collapsed?.[id] ? "collapsed" : "expanded"}`,
      value: id,
      description: "Toggle this section"
    });
    for (;; ) {
      let picked;
      try {
        picked = await context.ui.dialog.select({
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
              description: "Show or hide completed todos"
            },
            {
              title: `Compact lists: ${settings.compact ? "on" : "off"}`,
              value: "compact",
              description: "Use four-item section limits"
            },
            { title: "Reset section layout", value: "reset-layout", description: "Expand all sections and disable compact mode" },
            { title: "Reset pinned skills", value: "reset-pins", description: "Clear all skill pins" }
          ]
        });
      } catch (error2) {
        trace(`sidebar settings failed: ${error2 instanceof Error ? error2.message : String(error2)}`);
        return;
      }
      if (!picked)
        return;
      if (picked === "completed")
        toggleShowCompleted();
      else if (picked === "compact")
        toggleCompact();
      else if (picked === "reset-layout")
        resetLayout();
      else if (picked === "reset-pins")
        resetPins();
      else
        toggleSection(picked);
      context.ui.toast.show({ title: "Sidebar settings", message: "Updated", variant: "info", duration: 1200 });
    }
  };
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
        run: () => void openSidebarSettings()
      },
      {
        id: "oc-sidebar.usage",
        title: "Usage: cross-session spend",
        description: "Spend, tokens, and model breakdown across loaded sessions",
        group: "Sidebar",
        palette: true,
        slash: { name: "usage" },
        run: () => void showCrossSessionUsage()
      }
    ]
  }));
  const MCPPanel = () => {
    const list = () => mcpSorted();
    const visible = () => shown(list(), "mcp");
    const activeCount = () => list().filter(mcpActive).length;
    const failedCount = () => list().filter(mcpProblem).length;
    const count = () => `${activeCount()}/${list().length}${failedCount() ? ` !${failedCount()}` : ""}`;
    return /* @__PURE__ */ jsxDEV(Panel, {
      id: "mcp",
      title: "MCP",
      count: list().length > 0 ? count() : undefined,
      action: /* @__PURE__ */ jsxDEV("box", {
        flexDirection: "row",
        onMouseDown: () => void refreshMCP(),
        children: /* @__PURE__ */ jsxDEV("text", {
          fg: muted(),
          children: "[r]"
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this),
      children: [
        list().length === 0 ? /* @__PURE__ */ jsxDEV("text", {
          fg: muted(),
          children: "None"
        }, undefined, false, undefined, this) : visible().map((server) => {
          const status = mcpStatus(server);
          const problem = mcpProblem(server);
          const resources = mcpResourcesFor(server);
          const calls = mcpToolCalls(server);
          const label = `${server?.name ?? server?.id ?? "server"} - ${status}${resources > 0 ? ` \xB7 ${resources} res` : ""}${calls > 0 ? ` \xB7 ${calls} calls` : ""}`;
          return /* @__PURE__ */ jsxDEV("box", {
            flexDirection: "row",
            gap: 1,
            children: /* @__PURE__ */ jsxDEV("box", {
              flexDirection: "row",
              gap: 1,
              flexGrow: 1,
              flexShrink: 1,
              minWidth: 0,
              onMouseDown: () => void showMCPDetails(server),
              children: [
                /* @__PURE__ */ jsxDEV(StatusDot, {
                  status: () => status
                }, undefined, false, undefined, this),
                /* @__PURE__ */ jsxDEV("text", {
                  fg: problem ? error() : muted(),
                  wrapMode: "none",
                  children: clipText(label, 20)
                }, undefined, false, undefined, this)
              ]
            }, undefined, true, undefined, this)
          }, undefined, false, undefined, this);
        }),
        /* @__PURE__ */ jsxDEV(More, {
          id: "mcp",
          total: list().length,
          visible: visible().length
        }, undefined, false, undefined, this)
      ]
    }, undefined, true, undefined, this);
  };
  const BudgetPanel = () => {
    const view = () => budget();
    const warning2 = () => {
      const value = view();
      if (!value)
        return "";
      if (value.tone === "error")
        return "Low budget";
      if (value.tone === "warning")
        return "Budget low";
      return "";
    };
    return /* @__PURE__ */ jsxDEV(Panel, {
      id: "budget",
      title: "Budget",
      action: /* @__PURE__ */ jsxDEV("box", {
        flexDirection: "row",
        onMouseDown: () => void showCrossSessionUsage(),
        children: /* @__PURE__ */ jsxDEV("text", {
          fg: muted(),
          children: "\u03A3"
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this),
      children: [
        /* @__PURE__ */ jsxDEV("box", {
          flexDirection: "row",
          gap: 1,
          height: 1,
          children: [
            /* @__PURE__ */ jsxDEV(Bar, {
              percent: () => view()?.percent ?? 0,
              colour: () => view() ? toneColour(view().tone) : muted()
            }, undefined, false, undefined, this),
            /* @__PURE__ */ jsxDEV("text", {
              fg: view() ? toneColour(view().tone) : muted(),
              children: view()?.barLabel ?? "Loading..."
            }, undefined, false, undefined, this)
          ]
        }, undefined, true, undefined, this),
        /* @__PURE__ */ jsxDEV("text", {
          fg: muted(),
          wrapMode: "none",
          children: clipText(view()?.detail ?? "", 22)
        }, undefined, false, undefined, this),
        view()?.reset ? /* @__PURE__ */ jsxDEV("text", {
          fg: muted(),
          wrapMode: "none",
          children: clipText(`resets ${view().reset}`, 22)
        }, undefined, false, undefined, this) : null,
        /* @__PURE__ */ jsxDEV("text", {
          fg: muted(),
          wrapMode: "none",
          children: clipText(view()?.note ?? "", 22)
        }, undefined, false, undefined, this),
        budgetStale() ? /* @__PURE__ */ jsxDEV("text", {
          fg: toneColour("warning"),
          children: "stale"
        }, undefined, false, undefined, this) : null,
        warning2() ? /* @__PURE__ */ jsxDEV("text", {
          fg: toneColour(view().tone),
          children: warning2()
        }, undefined, false, undefined, this) : null,
        /* @__PURE__ */ jsxDEV("box", {
          flexDirection: "row",
          onMouseDown: () => void showCrossSessionUsage(),
          children: /* @__PURE__ */ jsxDEV("text", {
            fg: accent(),
            children: [
              "\u03A3 ",
              sessionUsageSummary()
            ]
          }, undefined, true, undefined, this)
        }, undefined, false, undefined, this)
      ]
    }, undefined, true, undefined, this);
  };
  const ContextPanel = () => {
    const state = () => usage();
    const limitText = () => state().contextWindow > 0 ? compactNumber(state().contextWindow) : "--";
    const colour = () => state().percent >= 90 ? error() : state().percent >= 70 ? warning() : accent();
    const warningText = () => state().percent >= 90 ? "Context high" : state().percent >= 70 ? "Context >70%" : "";
    const warningColour = () => state().percent >= 90 ? error() : warning();
    return /* @__PURE__ */ jsxDEV(Panel, {
      id: "context",
      title: "Context",
      children: [
        /* @__PURE__ */ jsxDEV("box", {
          flexDirection: "row",
          gap: 1,
          height: 1,
          children: [
            /* @__PURE__ */ jsxDEV(Bar, {
              percent: () => state().percent,
              colour: () => colour()
            }, undefined, false, undefined, this),
            /* @__PURE__ */ jsxDEV("text", {
              fg: colour(),
              children: [
                state().percent,
                "%"
              ]
            }, undefined, true, undefined, this)
          ]
        }, undefined, true, undefined, this),
        /* @__PURE__ */ jsxDEV("text", {
          fg: muted(),
          wrapMode: "none",
          children: `${compactNumber(state().tokens)} / ${limitText()} \xB7 ${formatMoney(sessionCost())}`
        }, undefined, false, undefined, this),
        /* @__PURE__ */ jsxDEV("text", {
          fg: muted(),
          children: `cache ${state().cacheRate}% \xB7 ${state().tps.toFixed(1)} t/s`
        }, undefined, false, undefined, this),
        warningText() ? /* @__PURE__ */ jsxDEV("text", {
          fg: warningColour(),
          children: warningText()
        }, undefined, false, undefined, this) : null
      ]
    }, undefined, true, undefined, this);
  };
  const PluginsPanel = () => {
    const list = () => visiblePlugins();
    const visible = () => shown(list(), "plugins");
    const activeCount = () => list().filter((plugin) => plugin?.state?.status === "active").length;
    const failedCount = () => list().filter((plugin) => plugin?.state?.status === "failed").length;
    const count = () => `${activeCount()}/${list().length}${failedCount() ? ` !${failedCount()}` : ""}`;
    return /* @__PURE__ */ jsxDEV(Panel, {
      id: "plugins",
      title: "Plugins",
      count: list().length > 0 ? count() : undefined,
      action: /* @__PURE__ */ jsxDEV(Fragment, {
        children: [
          /* @__PURE__ */ jsxDEV("box", {
            flexDirection: "row",
            onMouseDown: () => void openConfigAudit(),
            children: /* @__PURE__ */ jsxDEV("text", {
              fg: muted(),
              children: "[!]"
            }, undefined, false, undefined, this)
          }, undefined, false, undefined, this),
          /* @__PURE__ */ jsxDEV("box", {
            flexDirection: "row",
            onMouseDown: () => void refreshPlugins(location(), true),
            children: /* @__PURE__ */ jsxDEV("text", {
              fg: muted(),
              children: "[r]"
            }, undefined, false, undefined, this)
          }, undefined, false, undefined, this)
        ]
      }, undefined, true, undefined, this),
      children: [
        list().length === 0 ? /* @__PURE__ */ jsxDEV("text", {
          fg: muted(),
          children: "None"
        }, undefined, false, undefined, this) : visible().map((plugin) => {
          const status = String(plugin?.state?.status ?? "unknown");
          const failed = status === "failed";
          const version = plugin?.version ?? plugin?.source?.version;
          const calls = pluginToolCalls(plugin);
          const label = `${plugin?.id ?? plugin?.name ?? "plugin"}${version ? " " + version : ""}${calls > 0 ? ` \xB7 ${calls} calls` : ""}${failed ? " ! failed" : ""}`;
          return /* @__PURE__ */ jsxDEV("box", {
            flexDirection: "row",
            gap: 1,
            children: /* @__PURE__ */ jsxDEV("box", {
              flexDirection: "row",
              gap: 1,
              flexGrow: 1,
              flexShrink: 1,
              minWidth: 0,
              onMouseDown: () => void showPluginDetails(plugin),
              children: [
                /* @__PURE__ */ jsxDEV(StatusDot, {
                  status: () => status
                }, undefined, false, undefined, this),
                /* @__PURE__ */ jsxDEV("text", {
                  fg: failed ? error() : muted(),
                  wrapMode: "none",
                  children: clipText(label, 20)
                }, undefined, false, undefined, this)
              ]
            }, undefined, true, undefined, this)
          }, undefined, false, undefined, this);
        }),
        /* @__PURE__ */ jsxDEV(More, {
          id: "plugins",
          total: list().length,
          visible: visible().length
        }, undefined, false, undefined, this)
      ]
    }, undefined, true, undefined, this);
  };
  const SkillsPanel = () => {
    const usageOf = (skill) => {
      const id = String(skill?.id ?? "");
      const name = String(skill?.name ?? "");
      return skillUsage().get(id) ?? skillUsage().get(name);
    };
    const isPinned = (skill) => settings.pinned?.[String(skill?.id ?? "")] === true || settings.pinned?.[String(skill?.name ?? "")] === true;
    const list = () => skills().slice().toSorted((left, right) => {
      const leftUsage = usageOf(left);
      const rightUsage = usageOf(right);
      return Number(isPinned(right)) - Number(isPinned(left)) || (rightUsage?.count ?? 0) - (leftUsage?.count ?? 0) || (rightUsage?.lastUsed ?? 0) - (leftUsage?.lastUsed ?? 0) || String(left?.name ?? left?.id ?? "").localeCompare(String(right?.name ?? right?.id ?? ""));
    });
    const visible = () => settings.expanded?.skills ? list() : list().slice(0, listLimit());
    const usedCount = () => list().filter((skill) => (usageOf(skill)?.count ?? 0) > 0).length;
    return /* @__PURE__ */ jsxDEV(Panel, {
      id: "skills",
      title: "Skills",
      count: list().length > 0 ? `${usedCount()}/${list().length}` : undefined,
      action: /* @__PURE__ */ jsxDEV("box", {
        flexDirection: "row",
        onMouseDown: () => void openSkillSearch(),
        children: /* @__PURE__ */ jsxDEV("text", {
          fg: muted(),
          children: "[?]"
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this),
      children: [
        list().length === 0 ? /* @__PURE__ */ jsxDEV("text", {
          fg: muted(),
          children: "None"
        }, undefined, false, undefined, this) : visible().map((skill) => {
          const id = String(skill?.id ?? "");
          const isUsed = (usageOf(skill)?.count ?? 0) > 0;
          const pinned = isPinned(skill);
          return /* @__PURE__ */ jsxDEV("box", {
            flexDirection: "row",
            gap: 1,
            children: /* @__PURE__ */ jsxDEV("box", {
              flexDirection: "row",
              gap: 1,
              flexGrow: 1,
              flexShrink: 1,
              minWidth: 0,
              onMouseDown: () => togglePin(id),
              children: [
                /* @__PURE__ */ jsxDEV(Dot, {
                  on: () => isUsed
                }, undefined, false, undefined, this),
                /* @__PURE__ */ jsxDEV("text", {
                  fg: muted(),
                  wrapMode: "none",
                  children: clipText(skill?.name ?? skill?.id ?? "skill", 18)
                }, undefined, false, undefined, this),
                /* @__PURE__ */ jsxDEV("text", {
                  fg: pinned ? success() : muted(),
                  children: pinned ? "\u2605" : "\u2606"
                }, undefined, false, undefined, this)
              ]
            }, undefined, true, undefined, this)
          }, undefined, false, undefined, this);
        }),
        /* @__PURE__ */ jsxDEV(More, {
          id: "skills",
          total: list().length,
          visible: visible().length
        }, undefined, false, undefined, this)
      ]
    }, undefined, true, undefined, this);
  };
  const TodoPanel = () => {
    const list = () => todos();
    const showCompleted = () => settings.showCompleted ?? false;
    const completed = () => list().filter((todo) => todo?.status === "completed");
    const open = () => list().filter((todo) => todo?.status !== "completed");
    const filtered = () => showCompleted() ? list() : open();
    const visible = () => {
      if (showCompleted())
        return filtered();
      return settings.expanded?.todo ? filtered().slice(0, 8) : filtered().slice(0, listLimit());
    };
    const percent = () => list().length > 0 ? Math.round(completed().length / list().length * 100) : 0;
    const count = () => `${completed().length}/${list().length}`;
    const progress = () => `${percent()}%${timeLabel() ? ` \xB7 ${timeLabel()}` : ""}`;
    const TodoMark = (props2) => {
      if (props2.status === "completed")
        return /* @__PURE__ */ jsxDEV("text", {
          fg: success(),
          children: "[x]"
        }, undefined, false, undefined, this);
      if (props2.status === "cancelled")
        return /* @__PURE__ */ jsxDEV("text", {
          fg: muted(),
          children: "[-]"
        }, undefined, false, undefined, this);
      return /* @__PURE__ */ jsxDEV(Dot, {
        on: () => props2.status === "in_progress"
      }, undefined, false, undefined, this);
    };
    return /* @__PURE__ */ jsxDEV(Panel, {
      id: "todo",
      title: "Todo",
      count: list().length > 0 ? count() : undefined,
      children: [
        list().length === 0 ? /* @__PURE__ */ jsxDEV("text", {
          fg: muted(),
          children: "No todos"
        }, undefined, false, undefined, this) : /* @__PURE__ */ jsxDEV(Fragment, {
          children: [
            /* @__PURE__ */ jsxDEV("text", {
              fg: muted(),
              children: progress()
            }, undefined, false, undefined, this),
            visible().length === 0 ? /* @__PURE__ */ jsxDEV("text", {
              fg: muted(),
              children: "All done"
            }, undefined, false, undefined, this) : null,
            visible().map((todo) => /* @__PURE__ */ jsxDEV("box", {
              flexDirection: "row",
              gap: 1,
              children: [
                /* @__PURE__ */ jsxDEV(TodoMark, {
                  status: todo?.status
                }, undefined, false, undefined, this),
                /* @__PURE__ */ jsxDEV("text", {
                  fg: muted(),
                  children: todo?.content ?? ""
                }, undefined, false, undefined, this)
              ]
            }, undefined, true, undefined, this)),
            completed().length > 0 ? /* @__PURE__ */ jsxDEV("box", {
              flexDirection: "row",
              onMouseDown: toggleShowCompleted,
              children: /* @__PURE__ */ jsxDEV("text", {
                fg: muted(),
                children: showCompleted() ? "Hide completed" : `Show ${completed().length} completed`
              }, undefined, false, undefined, this)
            }, undefined, false, undefined, this) : null
          ]
        }, undefined, true, undefined, this),
        /* @__PURE__ */ jsxDEV(More, {
          id: "todo",
          total: filtered().length,
          visible: visible().length
        }, undefined, false, undefined, this)
      ]
    }, undefined, true, undefined, this);
  };
  return /* @__PURE__ */ jsxDEV("box", {
    flexDirection: "column",
    gap: 1,
    children: [
      /* @__PURE__ */ jsxDEV(MCPPanel, {}, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV(BudgetPanel, {}, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV(ContextPanel, {}, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV(PluginsPanel, {}, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV(SkillsPanel, {}, undefined, false, undefined, this),
      /* @__PURE__ */ jsxDEV(TodoPanel, {}, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function setupSidebar(context) {
  context.ui.slot({
    append: "sidebar.content",
    render: (input) => /* @__PURE__ */ jsxDEV(Sidebar, {
      sessionID: input.sessionID
    }, undefined, false, undefined, this)
  });
}
var tui_default = Plugin.define({ id: "oc-sidebar.tui", setup: setupSidebar });

// src/footer/tui.tsx
import { execFile } from "child_process";
import { readFileSync as readFileSync2 } from "fs";
import { createRequire as createRequire2 } from "module";
import { homedir as homedir2 } from "os";
import { join as join2 } from "path";
import { createEffect as createEffect2, createMemo as createMemo2, createSignal as createSignal2, onCleanup as onCleanup2 } from "solid-js";
import { Plugin as Plugin2 } from "@opencode/plugin/tui";
import { jsxDEV as jsxDEV2 } from "@opentui/solid/jsx-dev-runtime";
var idle = {
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
  stash: 0
};
function parse(text) {
  const state = { ...idle, repo: true };
  for (const line of text.split(`
`)) {
    if (!line)
      continue;
    if (line.startsWith("# branch.head ")) {
      const head = line.slice("# branch.head ".length).trim();
      state.detached = head === "(detached)";
      state.branch = state.detached ? "detached" : head;
      continue;
    }
    if (line.startsWith("# branch.oid ")) {
      const oid = line.slice("# branch.oid ".length).trim();
      if (oid === "(initial)")
        state.branch = state.branch || "initial";
      else if (state.detached)
        state.branch = oid.slice(0, 7);
      continue;
    }
    if (line.startsWith("# branch.upstream ")) {
      state.upstream = line.slice("# branch.upstream ".length).trim();
      continue;
    }
    if (line.startsWith("# branch.ab ")) {
      const match = line.match(/\+(\d+)\s+-(\d+)/);
      if (match) {
        state.ahead = Number(match[1]);
        state.behind = Number(match[2]);
      }
      continue;
    }
    if (line.startsWith("#"))
      continue;
    const kind = line[0];
    const xy = line.slice(2, 4);
    if (kind === "1") {
      if (xy[0] === "A")
        state.added++;
      else if (xy[0] === "D")
        state.deleted++;
      else if (xy[0] !== ".")
        state.staged++;
      if (xy[1] !== ".")
        state.modified++;
    } else if (kind === "2") {
      state.staged++;
      if (xy[1] !== ".")
        state.modified++;
    } else if (kind === "u") {
      state.conflict++;
    } else if (kind === "?") {
      state.untracked++;
    }
  }
  return state;
}
var AUTH_FILE2 = join2(homedir2(), ".local", "share", "opencode", "auth.json");
var DB_FILE2 = join2(homedir2(), ".local", "share", "opencode", "opencode.db");
var USAGE_URL2 = "https://opencode.ai/zen/go/v1/usage";
var GO2 = "opencode-go";
var ZEN2 = "opencode";
function readJson2(path) {
  try {
    return JSON.parse(readFileSync2(path, "utf8"));
  } catch {
    return;
  }
}
function openRouterKey2() {
  const key = readJson2(AUTH_FILE2)?.openrouter?.key;
  return typeof key === "string" && key.length > 0 ? key : undefined;
}
function authKey2(id) {
  const key = readJson2(AUTH_FILE2)?.[id]?.key;
  return typeof key === "string" && key.length > 0 ? key : undefined;
}
function loadBunDatabase2() {
  const attempts = [
    () => import.meta.require?.("bun:sqlite"),
    () => globalThis.require?.("bun:sqlite"),
    () => createRequire2(import.meta.url)("bun:sqlite"),
    () => Function("return require")()("bun:sqlite")
  ];
  for (const attempt of attempts) {
    try {
      const mod = attempt();
      if (mod?.Database)
        return mod.Database;
    } catch {}
  }
  return null;
}
function readDbKeys2() {
  try {
    const Database = loadBunDatabase2();
    if (!Database)
      return {};
    const db = new Database(DB_FILE2, { readonly: true });
    const out = {};
    for (const row of db.query("SELECT integration_id, value FROM credential").all()) {
      const id = String(row.integration_id ?? "").trim();
      const key = JSON.parse(String(row.value ?? ""))?.key;
      if (id && typeof key === "string" && key.trim())
        out[id] = key.trim();
    }
    try {
      db.close?.();
    } catch {}
    return out;
  } catch {
    return {};
  }
}
function apiKeys2() {
  const db = readDbKeys2();
  const keys = [ZEN2, GO2].map((id) => db[id] ?? authKey2(id)).filter((key) => Boolean(key));
  return [...new Set(keys)];
}
async function readGoUsage2() {
  for (const key of apiKeys2()) {
    try {
      const response = await fetch(USAGE_URL2, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(1e4)
      });
      if (!response.ok)
        continue;
      const payload = await response.json();
      const usage = payload?.usage;
      if (usage?.rolling || usage?.weekly || usage?.monthly)
        return { usage };
    } catch {}
  }
  return;
}
function tightestWindow2(usage) {
  const entries = [
    ["5h", usage.usage?.rolling],
    ["week", usage.usage?.weekly],
    ["month", usage.usage?.monthly]
  ];
  const windows = entries.filter(([, window2]) => window2 && Number.isFinite(window2.percent));
  if (windows.length === 0)
    return;
  const [name, window] = windows.reduce((left, right) => (right[1]?.percent ?? 0) > (left[1]?.percent ?? 0) ? right : left);
  return { name, percent: window.percent ?? 0 };
}
async function readOpenRouter2() {
  const key = openRouterKey2();
  if (!key)
    return;
  try {
    const response = await fetch("https://openrouter.ai/api/v1/credits", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(1e4)
    });
    if (!response.ok)
      return;
    const payload = await response.json();
    const total = Number(payload?.data?.total_credits);
    const used = Number(payload?.data?.total_usage);
    if (!Number.isFinite(total) || !Number.isFinite(used))
      return;
    return { total, used };
  } catch {
    return;
  }
}
function remainingTone(percent) {
  return percent >= 50 ? "success" : percent >= 20 ? "warning" : "error";
}
function providerLabel(providerID) {
  if (providerID === "openrouter")
    return "OR";
  if (providerID === GO2)
    return "GO";
  if (providerID === ZEN2)
    return "ZEN";
  return providerID ? providerID.slice(0, 3).toUpperCase() : "AI";
}
async function readFooterBudget(providerID) {
  if (providerID === GO2 || providerID === ZEN2) {
    const usage = await readGoUsage2();
    const window = usage ? tightestWindow2(usage) : undefined;
    if (!window)
      return;
    const remaining = Math.max(0, Math.min(100, Math.round(100 - window.percent)));
    return { label: providerLabel(providerID), percent: remaining, tone: remainingTone(remaining) };
  }
  if (!providerID || providerID === "openrouter") {
    const credits = await readOpenRouter2();
    if (!credits || credits.total <= 0)
      return;
    const remaining = Math.max(0, Math.min(100, Math.round((credits.total - credits.used) / credits.total * 100)));
    return { label: "OR", percent: remaining, tone: remainingTone(remaining) };
  }
  return;
}
function read(dir, done) {
  const options = {
    cwd: dir,
    timeout: 5000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }
  };
  const finish = (state, stash) => {
    if (!state.repo || state.upstream) {
      done({ ...state, stash });
      return;
    }
    execFile("git", ["remote"], options, (remoteError, remoteOut) => {
      if (remoteError || !String(remoteOut).trim()) {
        done({ ...state, stash });
        return;
      }
      execFile("git", ["rev-list", "--count", "HEAD", "--not", "--remotes"], options, (countError, countOut) => {
        const ahead = countError ? state.ahead : Number(String(countOut).trim()) || 0;
        done({ ...state, stash, ahead });
      });
    });
  };
  execFile("git", ["status", "--porcelain=v2", "--branch", "--untracked-files=normal"], options, (error, stdout) => {
    const state = error ? { ...idle } : parse(String(stdout));
    execFile("git", ["stash", "list", "--format=%gd"], options, (stashError, stashOut) => {
      const stash = stashError ? 0 : String(stashOut).split(`
`).filter(Boolean).length;
      finish(state, stash);
    });
  });
}
function sessionDirectory(context, sessionID) {
  try {
    const session = sessionID ? context.data.session.get(sessionID) : undefined;
    return session?.location?.directory || context.location?.directory || context.data.location.default()?.directory || process.cwd();
  } catch {
    return process.cwd();
  }
}
function StatusView(props) {
  const theme = () => props.context.theme;
  const s = () => props.state();
  const muted = () => theme().text.muted;
  const base = () => theme().text.base;
  const success = () => theme().text.feedback.success.base;
  const warning = () => theme().text.feedback.warning.base;
  const error = () => theme().text.feedback.error.base;
  const [budget, setBudget] = createSignal2(undefined);
  const providerID = createMemo2(() => {
    try {
      return String(props.context.ui.model.current()?.providerID ?? "");
    } catch {
      return "";
    }
  });
  const refreshBudget = async () => {
    try {
      setBudget(await readFooterBudget(providerID()));
    } catch {
      setBudget(undefined);
    }
  };
  createEffect2(() => {
    providerID();
    refreshBudget();
  });
  const timer = setInterval(() => void refreshBudget(), 60000);
  onCleanup2(() => clearInterval(timer));
  const added = () => s().added;
  const changed = () => s().staged + s().modified + s().deleted;
  const untracked = () => s().untracked;
  const conflict = () => s().conflict;
  const dirty = () => added() + changed() + untracked() + conflict() > 0;
  const budgetColour = () => {
    const view = budget();
    if (!view)
      return muted();
    return view.tone === "success" ? success() : view.tone === "warning" ? warning() : error();
  };
  const showHint = (title, message) => props.context.ui.toast.show({ title, message, variant: "info", duration: 3000 });
  return /* @__PURE__ */ jsxDEV2("box", {
    flexDirection: "row",
    flexShrink: 0,
    children: [
      s().repo && dirty() ? /* @__PURE__ */ jsxDEV2("box", {
        flexDirection: "row",
        onMouseEnter: () => showHint("Git status", "\u2442 branch \xB7 + added \xB7 \xB1 changed \xB7 ? untracked \xB7 ! conflicts"),
        onClick: () => showHint("Git status", "\u2442 branch \xB7 + added \xB7 \xB1 changed \xB7 ? untracked \xB7 ! conflicts"),
        children: /* @__PURE__ */ jsxDEV2("text", {
          children: [
            /* @__PURE__ */ jsxDEV2("span", {
              style: { fg: base() },
              children: "\u2442"
            }, undefined, false, undefined, this),
            added() > 0 ? /* @__PURE__ */ jsxDEV2("span", {
              style: { fg: success() },
              children: [
                " +",
                added()
              ]
            }, undefined, true, undefined, this) : null,
            changed() > 0 ? /* @__PURE__ */ jsxDEV2("span", {
              style: { fg: warning() },
              children: [
                " \xB1",
                changed()
              ]
            }, undefined, true, undefined, this) : null,
            untracked() > 0 ? /* @__PURE__ */ jsxDEV2("span", {
              style: { fg: warning() },
              children: [
                " ?",
                untracked()
              ]
            }, undefined, true, undefined, this) : null,
            conflict() > 0 ? /* @__PURE__ */ jsxDEV2("span", {
              style: { fg: error() },
              children: [
                " !",
                conflict()
              ]
            }, undefined, true, undefined, this) : null
          ]
        }, undefined, true, undefined, this)
      }, undefined, false, undefined, this) : null,
      budget() ? /* @__PURE__ */ jsxDEV2("box", {
        flexDirection: "row",
        onMouseEnter: () => showHint("Provider budget", `Remaining ${budget().label} budget: ${budget().percent}%. Green is 50% or more, yellow 20% or more, red below 20%.`),
        onClick: () => showHint("Provider budget", `Remaining ${budget().label} budget: ${budget().percent}%. Green is 50% or more, yellow 20% or more, red below 20%.`),
        children: /* @__PURE__ */ jsxDEV2("text", {
          children: [
            /* @__PURE__ */ jsxDEV2("span", {
              style: { fg: muted() },
              children: " \u21BB "
            }, undefined, false, undefined, this),
            /* @__PURE__ */ jsxDEV2("span", {
              style: { fg: budgetColour() },
              children: [
                budget().label,
                " ",
                budget().percent,
                "%"
              ]
            }, undefined, true, undefined, this)
          ]
        }, undefined, true, undefined, this)
      }, undefined, false, undefined, this) : null,
      /* @__PURE__ */ jsxDEV2("box", {
        flexDirection: "row",
        onMouseEnter: () => showHint("Footer key", "\u2615 Coffee sleep-prevention \xB7 \u265E Ponytail style \xB7 \u2442 branch \xB7 + added \xB7 \xB1 changed \xB7 ? untracked \xB7 \u21BB provider budget \xB7 \u2197 context \xB7 $ session cost \xB7 ctrl+p commands"),
        onClick: () => showHint("Footer key", "\u2615 Coffee sleep-prevention \xB7 \u265E Ponytail style \xB7 \u2442 branch \xB7 + added \xB7 \xB1 changed \xB7 ? untracked \xB7 \u21BB provider budget \xB7 \u2197 context \xB7 $ session cost \xB7 ctrl+p commands"),
        children: /* @__PURE__ */ jsxDEV2("text", {
          fg: muted(),
          children: " \u24D8"
        }, undefined, false, undefined, this)
      }, undefined, false, undefined, this)
    ]
  }, undefined, true, undefined, this);
}
function setupFooter(context) {
  if (context.options?.enabled === false)
    return;
  try {
    const renderer = context.renderer;
    renderer.enableMouseMovement = true;
    renderer.useMouse = true;
  } catch {}
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
              "\u2615 Coffee \u2014 sleep-prevention level (off / idle / display / system)",
              "\u265E Ponytail \u2014 working-style level (off / lite / full / ultra)",
              "\u2442 branch \xB7 + added \xB7 \xB1 changed \xB7 ? untracked \xB7 ! conflicts",
              "\u21BB provider budget remaining \xB7 \u2197 context tokens \xB7 $ session cost",
              "path:branch \u2014 current project and branch",
              "ctrl+p \u2014 command palette"
            ].join(`
`)
          });
        }
      }
    ]
  }));
  const configured = typeof context.options?.interval === "number" ? context.options.interval : 0;
  const interval = configured >= 500 ? configured : 2500;
  const [state, setState] = createSignal2(idle);
  let pending = false;
  let activeSessionID;
  const refresh = () => {
    if (pending)
      return;
    const dir = sessionDirectory(context, activeSessionID);
    if (!dir)
      return;
    pending = true;
    read(dir, (next) => {
      pending = false;
      setState(next);
    });
  };
  refresh();
  const timer = setInterval(refresh, interval);
  const offs = [];
  for (const type of ["filesystem.changed", "git", "vcs.branch.updated", "session.idle", "worktree.resolved"]) {
    try {
      offs.push(context.data.on(type, refresh));
    } catch {}
  }
  context.ui.slot({
    append: "prompt.footer.status",
    render: (input) => {
      activeSessionID = input.sessionID;
      return /* @__PURE__ */ jsxDEV2(StatusView, {
        context,
        state
      }, undefined, false, undefined, this);
    }
  });
  return () => {
    clearInterval(timer);
    for (const off of offs)
      off();
  };
}
var tui_default2 = Plugin2.define({ id: "alexeyshirshov.git-status", setup: setupFooter });

// src/tui.tsx
var tui_default3 = Plugin3.define({
  id: "oc-sidebar.tui",
  setup(context) {
    setupSidebar(context);
    return setupFooter(context);
  }
});
export {
  tui_default3 as default
};
