import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { MAX_TODO_CONTENT_LENGTH, MAX_TODOS, TODO_PRIORITIES } from "./todos.js";
/** Returns a clean config or undefined when the value is unusable. */
export function normalizeAutoTodosConfig(value) {
    if (value === null || typeof value !== "object")
        return undefined;
    const raw = value;
    if (!Array.isArray(raw.todos))
        return undefined;
    const todos = [];
    for (const entry of raw.todos) {
        if (entry === null || typeof entry !== "object")
            continue;
        const item = entry;
        if (typeof item.content !== "string" || !item.content.trim())
            continue;
        const content = item.content.trim();
        if (content.length > MAX_TODO_CONTENT_LENGTH)
            continue;
        const out = { content };
        if (TODO_PRIORITIES.includes(item.priority)) {
            out.priority = item.priority;
        }
        if (typeof item.match === "string" && item.match.trim()) {
            out.match = item.match.trim();
        }
        if (item.order === "first" || (typeof item.order === "number" && Number.isInteger(item.order) && item.order >= 0)) {
            out.order = item.order;
        }
        if (typeof item.always === "boolean") {
            out.always = item.always;
        }
        todos.push(out);
    }
    if (todos.length === 0)
        return undefined;
    const config = { todos };
    if (typeof raw.deduplicate === "boolean") {
        config.deduplicate = raw.deduplicate;
    }
    return config;
}
/** Project root first, then `.opencode/`. Never throws. */
export async function readAutoTodosConfig(directory) {
    for (const file of [join(directory, "auto-todos.json"), join(directory, ".opencode", "auto-todos.json")]) {
        try {
            const parsed = JSON.parse(await readFile(file, "utf8"));
            const config = normalizeAutoTodosConfig(parsed);
            if (config)
                return config;
        }
        catch {
            // Missing, unreadable, or invalid — try the next candidate.
        }
    }
    return undefined;
}
function contains(haystack, needle) {
    return haystack.toLowerCase().includes(needle.toLowerCase());
}
/**
 * Merges config entries into a validated list. Pure: never mutates inputs.
 * Returns the merged list plus how many entries were injected.
 */
export function applyAutoTodos(todos, config) {
    if (!config || config.todos.length === 0)
        return { todos, injected: 0 };
    const deduplicate = config.deduplicate ?? true;
    const merged = todos.map((t) => ({ ...t }));
    const incomingEmpty = merged.length === 0;
    const firsts = [];
    let injected = 0;
    for (const entry of config.todos) {
        if (!entry.always && !incomingEmpty)
            continue;
        if (firsts.length + merged.length >= MAX_TODOS)
            break;
        const seen = [...firsts, ...merged];
        if (entry.match && !seen.some((t) => contains(t.content, entry.match)))
            continue;
        if (deduplicate && seen.some((t) => contains(t.content, entry.content) || contains(entry.content, t.content))) {
            continue;
        }
        const todo = { content: entry.content, status: "pending" };
        if (entry.priority)
            todo.priority = entry.priority;
        if (entry.order === "first") {
            firsts.push(todo);
        }
        else if (typeof entry.order === "number") {
            merged.splice(Math.min(entry.order, merged.length), 0, todo);
        }
        else {
            merged.push(todo);
        }
        injected++;
    }
    return { todos: [...firsts, ...merged], injected };
}
/** The session's working directory via the typed client. Best-effort. */
export async function resolveSessionDirectory(ctx, sessionID) {
    const info = await ctx.session.get({ sessionID });
    const directory = info?.location?.directory;
    return typeof directory === "string" && directory ? directory : undefined;
}
/**
 * Full injection pass for the todowrite path. Returns the list to store:
 * the input unchanged when there is nothing to inject or anything fails.
 */
export async function withAutoTodos(ctx, sessionID, todos) {
    try {
        const directory = await resolveSessionDirectory(ctx, sessionID);
        if (!directory)
            return todos;
        const config = await readAutoTodosConfig(directory);
        if (!config)
            return todos;
        return applyAutoTodos(todos, config).todos;
    }
    catch {
        return todos;
    }
}
