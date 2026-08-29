// gen-stats — live generation dashboard for pi.
//
// Shows, above the editor, while a model streams a single status line whose
// label tracks the active stream phase:
//   ● generating   <tok/s>   <tok>     (text output)
//   ● thinking     <tok/s>   <tok>     (reasoning)
//   ▶ generating   <tok/s>   <tok>     (text output)
//   ● thinking     <tok/s>   <tok>     (reasoning)
//   ● tool-call    <tok/s>   <tok>     (tool arguments)
// When the message finishes it collapses into a compact "done" line reporting
// only the last-running phase's tok/s, the total generated-token count, and a
// single wall-clock generation time covering all processes. Context usage is
// shown on its own line below the done line (explicit numbers, no k/M
// abbreviation).
//
// Text token counting uses a real GPT-4 / cl10k BPE tokenizer (gpt-tokenizer) so
// the live count matches what providers actually count. Reasoning and tool-call
// token counts are estimates (char/4), since providers don't report them
// separately — fine for judging speed, not authoritative.
//
// Placement: ~/.pi/agent/extensions/gen-stats/  (auto-discovered, hot-reloadable)

import type {
  ExtensionAPI,
  ExtensionContext,
  ThemeColor,
} from "@earendil-works/pi-coding-agent";
import tokenizer from "gpt-tokenizer";

type Phase = "text" | "thinking" | "toolcall";

interface BlockState {
  contentIndex: number;
  startTime: number;
  text: string;
}

interface LiveState {
  active: Phase;
  text: BlockState;
  thinking: BlockState;
  toolcall: BlockState;
}

interface DoneStats {
  tokens: number;
  thinking: number;
  toolcall: number;
  lastSpeed: number;
  totalSeconds: number;
}

interface DisplayState {
  live: LiveState | null;
  done: DoneStats | null;
}

// Every event handler receives the same context shape.
type Ctx = ExtensionContext;

let display: DisplayState = { live: null, done: null };

// Live updates at most 10×/sec: streaming re-counts tokens on every delta, so
// throttling trims redundant tokenizer work and UI redraws.
const RENDER_MS = 100;
let lastRender = -Infinity;
// Wall-clock start of the current message, captured at message_start. Used for
// the done line's generation time; stable even if advanceBlock() later resets
// an individual block's startTime on a new contentIndex.
let genStart = -Infinity;

const LABELS: Record<Phase, string> = {
  text: "generating",
  thinking: "thinking",
  toolcall: "tool-call",
};

// Per-process colors, chosen from theme colors built for each stream type.
const COLORS: Record<Phase, ThemeColor> = {
  text: "success",
  thinking: "thinkingText",
  toolcall: "toolTitle",
};

const LABEL_WIDTH = 11;

let cachedText = "";
let cachedCount = 0;

function countTokens(text: string): number {
  // Recompute from the full accumulated text: BPE merges can span deltas, so
  // counting only the new slice would under-count. The count is a pure function
  // of the text, so cache the last (text -> count) pair and skip re-encoding
  // when the same accumulated text is seen again (e.g. a render tick that fires
  // with no new delta). A single-entry cache keeps memory flat instead of
  // growing with every intermediate string.
  if (text === cachedText) return cachedCount;
  cachedCount = tokenizer.encode(text).length;
  cachedText = text;
  return cachedCount;
}

function estTokens(s: string): number {
  // Reasoning/tool-call counts aren't reported by providers; char/4 is a rough
  // estimate used only for the displayed speed.
  return Math.max(1, Math.ceil(s.length / 4));
}

function padLabel(label: string): string {
  return label.padEnd(LABEL_WIDTH);
}

function fmtNum(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

// Speed of one streamed block over the time since it started.
function blockSpeed(state: BlockState, now: number, counter: (t: string) => number): { tokens: number; speed: number } {
  const elapsed = Math.max((now - state.startTime) / 1000, 0.001);
  const tokens = counter(state.text);
  return { tokens, speed: tokens / elapsed };
}

// Start a fresh block on a new content index, then append the delta.
function advanceBlock(block: BlockState, ev: { contentIndex: number; delta: string }): void {
  if (block.contentIndex !== ev.contentIndex) {
    block.contentIndex = ev.contentIndex;
    block.startTime = Date.now();
    block.text = "";
  }
  block.text += ev.delta;
}

export default function (pi: ExtensionAPI) {
  pi.on("message_start", (event, ctx) => {
    if (!ctx.hasUI || event.message.role !== "assistant") return;
    // Fresh assistant message: reset each stream's counters independently.
    const now = Date.now();
    genStart = now;
    display.live = {
      active: "text",
      text: { contentIndex: -1, startTime: now, text: "" },
      thinking: { contentIndex: -1, startTime: now, text: "" },
      toolcall: { contentIndex: -1, startTime: now, text: "" },
    };
    lastRender = now; // prime throttle so the first delta renders promptly
    render(ctx);
  });

  pi.on("message_update", (event, ctx) => {
    if (!ctx.hasUI || event.message.role !== "assistant" || !display.live) return;
    const ev = event.assistantMessageEvent;

    // Narrowed here, so ev.contentIndex/ev.delta typecheck in advanceBlock.
    if (ev.type === "text_delta") {
      advanceBlock(display.live.text, ev);
      display.live.active = "text";
    } else if (ev.type === "thinking_delta") {
      advanceBlock(display.live.thinking, ev);
      display.live.active = "thinking";
    } else if (ev.type === "toolcall_delta") {
      advanceBlock(display.live.toolcall, ev);
      display.live.active = "toolcall";
    }

    throttledRender(ctx);
  });

  pi.on("message_end", (event, ctx) => {
    if (event.message.role !== "assistant" || !display.live) return;

    const live = display.live;
    const now = Date.now();
    const lastPhase = live.active;
    const counter = lastPhase === "text" ? countTokens : estTokens;
    const lastSpeed = blockSpeed(live[lastPhase], now, counter).speed;
    display.done = {
      tokens: event.message.usage?.output ?? countTokens(live.text.text),
      thinking: estTokens(live.thinking.text),
      toolcall: estTokens(live.toolcall.text),
      // Single wall-clock time covering all processes, measured from the
      // message start (genStart), which advanceBlock() never mutates.
      totalSeconds: (now - genStart) / 1000,
      lastSpeed,
    };

    display.live = null;
    if (ctx.hasUI) render(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    display = { live: null, done: null };
    if (ctx.hasUI) ctx.ui.setWidget("gen-stats", undefined);
  });
}

function buildLine(ctx: Ctx): string {
  const { live, done } = display;

  if (live) {
    if (!live.text.text && !live.thinking.text && !live.toolcall.text) {
      return style(ctx, "dim", "● waiting");
    }
    const phase = live.active;
    const s = blockSpeed(live[phase], Date.now(), phase === "text" ? countTokens : estTokens);
    const icon = phase === "text" ? "▶" : "●";
    return style(ctx, COLORS[phase], `${icon} ${padLabel(LABELS[phase])}${s.speed.toFixed(1)} tok/s`) + `  ${fmtNum(s.tokens)} tok`;
  }

  if (done) {
    // Each stat keeps its own color so they're easy to tell apart, no icons:
    //   done = success(green), speed = warning(yellow), count = syntaxNumber(bright),
    //   time = dim.
    const total = done.tokens + done.thinking + done.toolcall;
    const speed = style(ctx, "warning", `${done.lastSpeed.toFixed(1)} tok/s`);
    const count = total > 0 ? ` | ${style(ctx, "syntaxNumber", fmtNum(total))} tok` : "";
    const time = ` | ${style(ctx, "dim", `${done.totalSeconds.toFixed(1)}s`)}`;
    const stats = style(ctx, "success", "✓ done ") + speed;
    return stats + count + time;
  }

  return style(ctx, "dim", "idle");
}

// Context-usage line shown below the done line. Explicit numbers (no k/M
// abbreviation); colored by severity, dim when unknown.
function contextLine(ctx: Ctx): string {
  const usage = ctx.getContextUsage();
  if (!usage || usage.tokens == null) return style(ctx, "dim", "  context —/—");
  const pct = usage.percent != null ? ` (${usage.percent.toFixed(0)}%)` : "";
  const text = `${fmtNum(usage.tokens)}/${fmtNum(usage.contextWindow)}${pct}`;
  const color = usage.percent != null && usage.percent >= 0.9 ? "warning" : "muted";
  return `  context ${style(ctx, color, text)}`;
}

function throttledRender(ctx: Ctx): void {
  const now = Date.now();
  if (now - lastRender < RENDER_MS) return;
  lastRender = now;
  render(ctx);
}

function render(ctx: Ctx): void {
  // Context usage only appears below the done line; while streaming it's dropped.
  if (display.done) {
    ctx.ui.setWidget("gen-stats", [buildLine(ctx), contextLine(ctx)]);
  } else {
    ctx.ui.setWidget("gen-stats", [buildLine(ctx)]);
  }
}

function style(ctx: Ctx, color: ThemeColor, text: string): string {
  return ctx.ui.theme.fg(color, text);
}
