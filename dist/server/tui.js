// src/tui.tsx
import { spread as _$spread } from "@opentui/solid";
import { mergeProps as _$mergeProps } from "@opentui/solid";
import { memo as _$memo } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";

// src/todos.ts
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
    if (item.priority !== void 0) {
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

// src/timing.ts
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
    if (!hasOpen) return previous;
    return { ...previous, current: startRun(todos, at) };
  }
  const run = { ...current, items: mergeItems(current.items, todos, at) };
  if (todos.length === 0) {
    return { ...previous, current: void 0, last: closeRun(run, at, true) };
  }
  if (!hasOpen) {
    return { ...previous, current: void 0, last: closeRun(run, at, false) };
  }
  return { ...previous, current: run };
}
function buildTiming(writes) {
  let state = {};
  for (const write of writes) {
    if (typeof write.at !== "number") continue;
    state = applyTodoWrite(state, write.todos, write.at);
  }
  return state;
}
function runElapsed(run, now) {
  return (run.endedAt ?? now) - run.startedAt;
}
function hasCompletedItem(run) {
  return run.items.some((item) => item.completedAt !== void 0);
}
function itemTimeLabel(item, now) {
  if (!item || item.startedAt === void 0) return void 0;
  if (item.status === "completed" && item.completedAt !== void 0) {
    return formatDuration(item.completedAt - item.startedAt);
  }
  if (item.status === "in_progress") return formatDuration(now - item.startedAt);
  return void 0;
}
function findItem(run, content) {
  return run?.items.find((item) => item.content === content);
}
function formatDuration(ms) {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1e3) : 0;
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}
function startRun(todos, at) {
  return { startedAt: at, items: todos.map((todo) => initialItem(todo, at)) };
}
function initialItem(todo, at) {
  const item = { content: todo.content, status: todo.status };
  if (todo.status === "in_progress") item.startedAt = at;
  if (todo.status === "completed") item.completedAt = at;
  return item;
}
function mergeItems(existing, todos, at) {
  const byContent = new Map(existing.map((item) => [item.content, item]));
  return todos.map((todo) => {
    const previous = byContent.get(todo.content);
    const item = previous ? { ...previous, status: todo.status } : { content: todo.content, status: todo.status };
    if (todo.status === "in_progress" && item.startedAt === void 0) item.startedAt = at;
    if (todo.status === "completed" && item.completedAt === void 0) item.completedAt = at;
    return item;
  });
}
function closeRun(run, at, abandoned) {
  return { ...run, endedAt: at, ...abandoned ? { abandoned: true } : {} };
}

// src/tui-data.ts
function todowritesFromMessages(messages) {
  if (!Array.isArray(messages)) return [];
  const writes = [];
  let order = 0;
  for (const message of messages) {
    if (message === null || typeof message !== "object") continue;
    const content = message.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (part === null || typeof part !== "object") continue;
      const tool = part;
      if (tool.type !== "tool" || tool.name !== "todowrite") continue;
      if (tool.state?.status !== "completed") continue;
      let todos;
      try {
        todos = normalizeTodos(tool.state.input);
      } catch {
        continue;
      }
      writes.push({ at: writeTimestamp(tool, message) ?? null, todos, order: order++ });
    }
  }
  writes.sort((left, right) => {
    if (left.at === null && right.at === null) return left.order - right.order;
    if (left.at === null) return 1;
    if (right.at === null) return -1;
    if (left.at !== right.at) return left.at - right.at;
    return left.order - right.order;
  });
  return writes.map(({ at, todos }) => ({ at, todos }));
}
function writeTimestamp(part, message) {
  const candidates = [
    part.time?.created,
    part.time?.ran,
    part.time?.completed,
    part.state?.time?.created,
    part.state?.time?.ran,
    part.state?.time?.completed
  ];
  for (const value of candidates) {
    if (typeof value === "number") return value;
  }
  if (typeof message.time === "number") return message.time;
  if (message.time !== null && typeof message.time === "object") {
    const created = message.time.created;
    if (typeof created === "number") return created;
  }
  return void 0;
}
function headerLabel(todos, display) {
  const total = todos.length;
  const done = todos.filter((todo) => todo.status === "completed").length;
  const percent = total === 0 ? 0 : Math.round(done / total * 100);
  const parts = [];
  if (display.count) parts.push(`[${done}/${total}]`);
  if (display.percent) parts.push(`${percent}%`);
  return parts.length === 0 ? "Todo" : `Todo ${parts.join(" \xB7 ")}`;
}
function headerTimeLabel(state, timer, now) {
  if (!timer) return void 0;
  if (state.current) return formatDuration(runElapsed(state.current, now));
  const last = state.last;
  if (last && !last.abandoned && hasCompletedItem(last)) {
    return `done in ${formatDuration(runElapsed(last, now))}`;
  }
  return void 0;
}

// src/rpc.ts
import { Rpc } from "@opencode/plugin/rpc";
var TodolistRpc = Rpc.define({
  id: "aiev.todolist",
  methods: {
    getSettings: {
      input: {
        type: "object",
        properties: {},
        additionalProperties: false
      },
      output: {
        type: "object",
        properties: { updateReminders: { type: "boolean" } },
        required: ["updateReminders"],
        additionalProperties: false
      }
    },
    setSettings: {
      input: {
        type: "object",
        properties: { updateReminders: { type: "boolean" } },
        required: ["updateReminders"],
        additionalProperties: false
      },
      output: {
        type: "object",
        properties: { updateReminders: { type: "boolean" } },
        required: ["updateReminders"],
        additionalProperties: false
      }
    }
  },
  events: {}
});

// src/tui-settings.ts
var DEFAULT_SETTINGS = {
  count: true,
  percent: true,
  timer: true,
  gap: 1,
  collapseThreshold: 2,
  border: false
};
var SETTINGS_KEY = "aiev.todolist.settings";
var GAP_VALUES = [0, 1, 2];
var THRESHOLD_VALUES = [2, 3, 5];
function normalizeSettings(value) {
  if (value === null || typeof value !== "object") return { ...DEFAULT_SETTINGS };
  const raw = value;
  return {
    count: typeof raw.count === "boolean" ? raw.count : DEFAULT_SETTINGS.count,
    percent: typeof raw.percent === "boolean" ? raw.percent : DEFAULT_SETTINGS.percent,
    timer: typeof raw.timer === "boolean" ? raw.timer : DEFAULT_SETTINGS.timer,
    gap: GAP_VALUES.includes(raw.gap) ? raw.gap : DEFAULT_SETTINGS.gap,
    collapseThreshold: THRESHOLD_VALUES.includes(raw.collapseThreshold) ? raw.collapseThreshold : DEFAULT_SETTINGS.collapseThreshold,
    border: typeof raw.border === "boolean" ? raw.border : DEFAULT_SETTINGS.border
  };
}
var nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));
var onOff = (value) => value ? "on" : "off";
function gapLabel(gap) {
  if (gap === 0) return "none";
  if (gap === 1) return "line";
  return "line + blank";
}
function openSettingsMenu(context, settings, update) {
  void (async () => {
    const rpc = context.client.rpc(TodolistRpc);
    const readReminders = async () => {
      try {
        const value = await rpc.getSettings({});
        return typeof value.updateReminders === "boolean" ? value.updateReminders : true;
      } catch {
        return true;
      }
    };
    while (true) {
      const reminders = await readReminders();
      const choice = await context.ui.dialog.select({
        title: "Todolist settings",
        options: [
          { title: `Update reminders: ${onOff(reminders)}`, value: "reminder" },
          { title: `Show count: ${onOff(settings.count)}`, value: "count" },
          { title: `Show percentage: ${onOff(settings.percent)}`, value: "percent" },
          { title: `Show timer: ${onOff(settings.timer)}`, value: "timer" },
          { title: `Header separator: ${gapLabel(settings.gap)}`, value: "gap" },
          { title: `Collapse threshold: ${settings.collapseThreshold}`, value: "threshold" },
          { title: `Border: ${onOff(settings.border)}`, value: "border" }
        ]
      });
      if (choice === void 0) return;
      if (choice === "reminder") {
        try {
          await rpc.setSettings({ updateReminders: !reminders });
        } catch {
        }
      } else if (choice === "count") {
        await update((draft) => {
          draft.count = !draft.count;
        });
      } else if (choice === "percent") {
        await update((draft) => {
          draft.percent = !draft.percent;
        });
      } else if (choice === "timer") {
        await update((draft) => {
          draft.timer = !draft.timer;
        });
      } else if (choice === "gap") {
        const picked = await context.ui.dialog.select({
          title: "Header separator",
          options: GAP_VALUES.map((value) => ({
            title: value === 0 ? "none" : value === 1 ? "\u2500\u2500\u2500\u2500" : "\u2500\u2500\u2500\u2500 + blank",
            value
          })),
          current: settings.gap
        });
        if (picked !== void 0) {
          await update((draft) => {
            draft.gap = picked;
          });
        }
      } else if (choice === "threshold") {
        const picked = await context.ui.dialog.select({
          title: "Collapse threshold",
          options: THRESHOLD_VALUES.map((value) => ({ title: String(value), value })),
          current: settings.collapseThreshold
        });
        if (picked !== void 0) {
          await update((draft) => {
            draft.collapseThreshold = picked;
          });
        }
      } else if (choice === "border") {
        await update((draft) => {
          draft.border = !draft.border;
        });
      }
      await nextTick();
    }
  })();
}

// src/tui.tsx
function mark(status) {
  if (status === "completed") return "\u2713";
  if (status === "in_progress") return "\u2022";
  return " ";
}
function TodoRow(props) {
  const color = () => props.todo.status === "in_progress" ? props.context.theme.text.feedback.warning.base : props.context.theme.text.muted;
  return (() => {
    var _el$ = _$createElement("box"), _el$2 = _$createElement("text"), _el$3 = _$createElement("text");
    _$insertNode(_el$, _el$2);
    _$insertNode(_el$, _el$3);
    _$setProp(_el$, "flexDirection", "row");
    _$setProp(_el$, "gap", 0);
    _$setProp(_el$2, "flexShrink", 0);
    _$insert(_el$2, () => `[${mark(props.todo.status)}] `);
    _$setProp(_el$3, "flexGrow", 1);
    _$setProp(_el$3, "wrapMode", "word");
    _$insert(_el$3, () => props.todo.content);
    _$insert(_el$, _$createComponent(Show, {
      get when() {
        return props.time;
      },
      get children() {
        var _el$4 = _$createElement("text");
        _$setProp(_el$4, "flexShrink", 0);
        _$insert(_el$4, () => ` \xB7 ${props.time}`);
        _$effect((_$p) => _$setProp(_el$4, "style", {
          fg: props.context.theme.text.muted
        }, _$p));
        return _el$4;
      }
    }), null);
    _$effect((_p$) => {
      var _v$ = {
        fg: color()
      }, _v$2 = {
        fg: color()
      };
      _v$ !== _p$.e && (_p$.e = _$setProp(_el$2, "style", _v$, _p$.e));
      _v$2 !== _p$.t && (_p$.t = _$setProp(_el$3, "style", _v$2, _p$.t));
      return _p$;
    }, {
      e: void 0,
      t: void 0
    });
    return _el$;
  })();
}
function TodoStrip(props) {
  const [open, setOpen] = createSignal(true);
  const [now, setNow] = createSignal(Date.now());
  const display = () => normalizeSettings(props.settings);
  const writes = createMemo(() => {
    try {
      return todowritesFromMessages(props.context.data.session.message.list(props.sessionID));
    } catch {
      return [];
    }
  });
  const timing = createMemo(() => buildTiming(writes()));
  const todos = createMemo(() => {
    const list = writes();
    return list.length === 0 ? [] : list[list.length - 1].todos;
  });
  const run = createMemo(() => timing().current ?? timing().last);
  const finished = createMemo(() => {
    const state = timing();
    return state.current === void 0 && state.last !== void 0 && state.last.abandoned !== true && hasCompletedItem(state.last);
  });
  createEffect(() => {
    if (!display().timer || timing().current === void 0) return;
    const id = setInterval(() => setNow(Date.now()), 1e3);
    onCleanup(() => clearInterval(id));
  });
  const show = createMemo(() => {
    const list = todos();
    if (list.length === 0) return true;
    if (list.some((todo) => todo.status !== "completed")) return true;
    return display().timer && finished();
  });
  const collapsible = () => todos().length > display().collapseThreshold;
  const header = createMemo(() => headerLabel(todos(), display()));
  const headerTime = createMemo(() => headerTimeLabel(timing(), display().timer, now()));
  return _$createComponent(Show, {
    get when() {
      return show();
    },
    get children() {
      var _el$5 = _$createElement("box"), _el$6 = _$createElement("box"), _el$8 = _$createElement("text"), _el$9 = _$createElement("b");
      _$insertNode(_el$5, _el$6);
      _$setProp(_el$5, "flexDirection", "column");
      _$setProp(_el$5, "gap", 0);
      _$spread(_el$5, _$mergeProps({
        get border() {
          return display().border;
        }
      }, () => display().border ? {
        borderColor: props.context.theme.text.muted
      } : {}, {
        get paddingLeft() {
          return display().border ? 1 : 0;
        },
        get paddingRight() {
          return display().border ? 1 : 0;
        }
      }), true);
      _$insertNode(_el$6, _el$8);
      _$setProp(_el$6, "width", "100%");
      _$setProp(_el$6, "flexDirection", "row");
      _$setProp(_el$6, "gap", 1);
      _$setProp(_el$6, "onMouseDown", () => collapsible() && setOpen((value) => !value));
      _$insert(_el$6, _$createComponent(Show, {
        get when() {
          return collapsible();
        },
        get children() {
          var _el$7 = _$createElement("text");
          _$setProp(_el$7, "flexShrink", 0);
          _$insert(_el$7, () => open() ? "\u25BC" : "\u25B6");
          _$effect((_$p) => _$setProp(_el$7, "fg", props.context.theme.text.base, _$p));
          return _el$7;
        }
      }), _el$8);
      _$insertNode(_el$8, _el$9);
      _$setProp(_el$8, "flexGrow", 1);
      _$setProp(_el$8, "minWidth", 0);
      _$insert(_el$9, header);
      _$insert(_el$6, _$createComponent(Show, {
        get when() {
          return headerTime();
        },
        get children() {
          var _el$0 = _$createElement("text"), _el$1 = _$createElement("b");
          _$insertNode(_el$0, _el$1);
          _$setProp(_el$0, "flexShrink", 0);
          _$insert(_el$1, headerTime);
          _$effect((_$p) => _$setProp(_el$0, "fg", props.context.theme.text.base, _$p));
          return _el$0;
        }
      }), null);
      _$insert(_el$5, _$createComponent(Show, {
        get when() {
          return display().gap > 0;
        },
        get children() {
          var _el$10 = _$createElement("box");
          _$setProp(_el$10, "height", 1);
          _$setProp(_el$10, "border", ["top"]);
          _$effect((_$p) => _$setProp(_el$10, "borderColor", props.context.theme.text.muted, _$p));
          return _el$10;
        }
      }), null);
      _$insert(_el$5, _$createComponent(Show, {
        get when() {
          return display().gap > 1;
        },
        get children() {
          var _el$11 = _$createElement("box");
          _$effect((_$p) => _$setProp(_el$11, "height", display().gap - 1, _$p));
          return _el$11;
        }
      }), null);
      _$insert(_el$5, _$createComponent(Show, {
        get when() {
          return !collapsible() || open();
        },
        get children() {
          return _$createComponent(For, {
            get each() {
              return todos();
            },
            children: (todo) => {
              const time = () => display().timer ? itemTimeLabel(findItem(run(), todo.content), now()) : void 0;
              return _$createComponent(TodoRow, {
                get context() {
                  return props.context;
                },
                todo,
                get time() {
                  return time();
                }
              });
            }
          });
        }
      }), null);
      _$effect((_$p) => _$setProp(_el$8, "fg", props.context.theme.text.base, _$p));
      return _el$5;
    }
  });
}
function SettingsRoot(props) {
  props.context.keymap.layer(() => ({
    mode: "global",
    commands: [{
      id: "aiev.todolist.settings",
      title: "Todolist: Settings",
      description: "Configure the todo list reminders and sidebar",
      slash: {
        name: "todo-settings"
      },
      palette: true,
      run: () => openSettingsMenu(props.context, props.settings, props.update)
    }]
  }));
  return null;
}
var mod = {
  id: "aiev.todolist.tui",
  setup(context) {
    const [settings, updateSettings] = context.storage.store(SETTINGS_KEY, {
      initial: normalizeSettings(void 0)
    });
    context.ui.slot({
      append: "app",
      render: () => _$createComponent(SettingsRoot, {
        context,
        settings,
        update: updateSettings
      })
    });
    context.ui.slot({
      append: "sidebar.content",
      render: (props) => _$createComponent(TodoStrip, {
        context,
        get sessionID() {
          return props.sessionID;
        },
        settings
      })
    });
  }
};
var tui_default = mod;
export {
  tui_default as default
};
