export const TODO_STATUSES = ["pending", "in_progress", "completed", "cancelled"];
export const TODO_PRIORITIES = ["high", "medium", "low"];
export const STORAGE_PREFIX = "todos/";
/** Hard caps so a runaway or adversarial list can't blow up the request. */
export const MAX_TODOS = 100;
export const MAX_TODO_CONTENT_LENGTH = 500;
export const STATUS_MARK = {
    pending: "[ ]",
    in_progress: "[•]",
    completed: "[x]",
    cancelled: "[-]",
};
export function storageKey(sessionID) {
    return `${STORAGE_PREFIX}${sessionID}`;
}
/**
 * Validates a `todowrite` payload. Throws a descriptive error on malformed
 * input so the model can correct itself.
 */
export function normalizeTodos(input) {
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
/**
 * Renders a todo list as plain text for tool output and context injection.
 * An optional `suffix` appends per-task detail such as a measured duration.
 */
export function renderTodos(todos, suffix) {
    if (todos.length === 0) {
        return "(the todo list is empty)";
    }
    return todos
        .map((todo, index) => {
        const priority = todo.priority ? ` — ${todo.priority} priority` : "";
        const detail = suffix?.(todo);
        const extra = detail ? ` — ${detail}` : "";
        return `${index + 1}. ${STATUS_MARK[todo.status]} ${todo.content}${priority}${extra}`;
    })
        .join("\n");
}
/** Reads a stored record defensively; returns undefined when the value is unusable. */
export function parseTodoRecord(value) {
    if (value === null || typeof value !== "object")
        return undefined;
    const stored = value;
    if (!Array.isArray(stored.todos))
        return undefined;
    const todos = [];
    for (const entry of stored.todos) {
        if (entry === null || typeof entry !== "object")
            continue;
        const item = entry;
        if (typeof item.content !== "string" || !TODO_STATUSES.includes(item.status))
            continue;
        const todo = { content: item.content, status: item.status };
        if (TODO_PRIORITIES.includes(item.priority)) {
            todo.priority = item.priority;
        }
        todos.push(todo);
    }
    const record = {
        todos,
        updatedAt: typeof stored.updatedAt === "number" ? stored.updatedAt : 0,
    };
    const timing = parseTimingState(stored.timing);
    if (timing)
        record.timing = timing;
    return record;
}
/** Reads a stored timing state defensively; returns undefined when unusable. */
export function parseTimingState(value) {
    if (value === null || typeof value !== "object")
        return undefined;
    const stored = value;
    const current = parseRun(stored.current);
    const last = parseRun(stored.last);
    if (!current && !last)
        return undefined;
    const state = {};
    if (current)
        state.current = current;
    if (last)
        state.last = last;
    return state;
}
function parseRun(value) {
    if (value === null || typeof value !== "object")
        return undefined;
    const stored = value;
    if (typeof stored.startedAt !== "number")
        return undefined;
    const items = [];
    if (Array.isArray(stored.items)) {
        for (const entry of stored.items) {
            if (entry === null || typeof entry !== "object")
                continue;
            const raw = entry;
            if (typeof raw.content !== "string" || !TODO_STATUSES.includes(raw.status))
                continue;
            const item = { content: raw.content, status: raw.status };
            if (typeof raw.startedAt === "number")
                item.startedAt = raw.startedAt;
            if (typeof raw.completedAt === "number")
                item.completedAt = raw.completedAt;
            items.push(item);
        }
    }
    const run = { startedAt: stored.startedAt, items };
    if (typeof stored.endedAt === "number")
        run.endedAt = stored.endedAt;
    if (stored.abandoned === true)
        run.abandoned = true;
    return run;
}
export function hasOpenTodos(todos) {
    return todos.some((todo) => todo.status === "pending" || todo.status === "in_progress");
}
