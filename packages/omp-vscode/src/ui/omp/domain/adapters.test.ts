import { describe, it, expect } from "vitest";
import { toTerminalStats } from "./terminal";
import { toDiffLinesList, type DiffCard } from "./diff";
import { toReasoningSteps } from "./reasoning";
import { toTimingStats } from "./timing";
import type {
  ToolCallContent,
  ToolResultMessage,
  ThinkingContent,
  AssistantMessage,
} from "@/lib/types";

/* ---------------------------------------------------------------------- */
/* Fixture builders                                                       */
/* ---------------------------------------------------------------------- */

function bashCall(command: string, cwd?: string): ToolCallContent {
  return {
    type: "toolCall",
    toolCallId: "call_1",
    toolName: "bash",
    toolKind: "execute",
    input: cwd ? { command, cwd } : { command },
  };
}

function bashResult(
  text: string,
  extra: Partial<{
    isError: boolean;
    exitCode: number;
    cancelled: boolean;
    cwd: string;
    truncated: boolean;
  }> = {}
): ToolResultMessage {
  const details: Record<string, unknown> = {};
  if (extra.exitCode !== undefined) details.exitCode = extra.exitCode;
  if (extra.cancelled !== undefined) details.cancelled = extra.cancelled;
  if (extra.cwd !== undefined) details.cwd = extra.cwd;
  if (extra.truncated !== undefined) details.truncated = extra.truncated;
  return {
    role: "toolResult",
    toolCallId: "call_1",
    toolName: "bash",
    isError: extra.isError,
    content: [{ type: "text", text }],
    details,
  };
}

/* ---------------------------------------------------------------------- */
/* toTerminalStats                                                        */
/* ---------------------------------------------------------------------- */

describe("toTerminalStats", () => {
  it("pending: no result → done=false, no lines, visibleCount=0", () => {
    const out = toTerminalStats(bashCall("ls -la"), undefined);
    expect(out).toEqual({
      command: "ls -la",
      lines: [],
      visibleCount: 0,
      done: false,
    });
  });

  it("streaming behaves like pending (no result yet)", () => {
    // The wrapper toggles between pending and done via presence of result;
    // there is no intermediate "streaming with lines" state for bash in ACP
    // — the result arrives whole. The adapter is honest about that.
    const out = toTerminalStats(bashCall("npm test"), undefined);
    expect(out.done).toBe(false);
    expect(out.lines).toEqual([]);
  });

  it("done-success: exit 0 → done, no isError, exitCode:0", () => {
    const out = toTerminalStats(
      bashCall("echo hi"),
      bashResult("hi\n", { exitCode: 0 })
    );
    expect(out.done).toBe(true);
    expect(out.exitCode).toBe(0);
    expect(out.isError).toBeUndefined();
    expect(out.lines).toEqual(["hi"]);
    expect(out.visibleCount).toBe(1);
  });

  it("done-nonzero-exit: isError set, exitCode preserved", () => {
    const out = toTerminalStats(
      bashCall("false"),
      bashResult("boom\n", { exitCode: 1, isError: true })
    );
    expect(out.done).toBe(true);
    expect(out.exitCode).toBe(1);
    expect(out.isError).toBe(true);
  });

  it("cancelled: sets isCancelled without needing isError", () => {
    const out = toTerminalStats(
      bashCall("sleep 100"),
      bashResult("", { cancelled: true })
    );
    expect(out.isCancelled).toBe(true);
    expect(out.done).toBe(true);
  });

  it("with-cwd from block.input.cwd", () => {
    const out = toTerminalStats(bashCall("ls", "/tmp/foo"), undefined);
    expect(out.cwd).toBe("/tmp/foo");
  });

  it("with-cwd from result.details takes precedence over input.cwd", () => {
    const out = toTerminalStats(
      bashCall("ls", "/tmp/foo"),
      bashResult("", { cwd: "/tmp/bar" })
    );
    expect(out.cwd).toBe("/tmp/bar");
  });

  it("with-cwd falls back to options.cwd", () => {
    const out = toTerminalStats(bashCall("ls"), undefined, { cwd: "/repo" });
    expect(out.cwd).toBe("/repo");
  });

  it("without-cwd: omitted when nothing provided", () => {
    const out = toTerminalStats(bashCall("ls"), undefined);
    expect(out.cwd).toBeUndefined();
  });

  it("stderr-in-content: joined into lines with stdout", () => {
    // Our results carry both streams merged into a single `text` block.
    const out = toTerminalStats(
      bashCall("build"),
      bashResult("compiling…\nerror: bad token\n", {
        exitCode: 2,
        isError: true,
      })
    );
    expect(out.lines).toEqual(["compiling…", "error: bad token"]);
    expect(out.isError).toBe(true);
  });

  it("very-large-output: visibleCount capped at defaultVisibleCount", () => {
    const text = Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n") + "\n";
    const out = toTerminalStats(bashCall("find /"), bashResult(text, { exitCode: 0 }));
    expect(out.lines).toHaveLength(400);
    // Default cap is 50.
    expect(out.visibleCount).toBe(50);
  });

  it("very-large-output: caller can widen with options.defaultVisibleCount", () => {
    const text = Array.from({ length: 400 }, (_, i) => `l${i}`).join("\n") + "\n";
    const out = toTerminalStats(bashCall("find /"), bashResult(text), {
      defaultVisibleCount: 500,
    });
    // Capped at lines.length (400) — never larger than what exists.
    expect(out.visibleCount).toBe(400);
  });

  it("truncation marker (\"…truncated\") stays in lines verbatim", () => {
    const out = toTerminalStats(
      bashCall("cat big"),
      bashResult("first\nsecond\n\n…truncated (200 more lines)")
    );
    expect(out.lines).toEqual([
      "first",
      "second",
      "",
      "…truncated (200 more lines)",
    ]);
  });
});

/* ---------------------------------------------------------------------- */
/* toDiffLinesList                                                        */
/* ---------------------------------------------------------------------- */

function editCall(
  path: string,
  oldStr: string,
  newStr: string
): ToolCallContent {
  return {
    type: "toolCall",
    toolCallId: "call_e",
    toolName: "edit",
    toolKind: "edit",
    input: { path, old_string: oldStr, new_string: newStr },
  };
}

function writeCall(path: string, content: string): ToolCallContent {
  return {
    type: "toolCall",
    toolCallId: "call_w",
    toolName: "write",
    toolKind: "edit",
    input: { path, content },
  };
}

function multiEditCall(
  path: string,
  edits: Array<{ old_string: string; new_string: string }>
): ToolCallContent {
  return {
    type: "toolCall",
    toolCallId: "call_m",
    toolName: "multi_edit",
    toolKind: "edit",
    input: { path, edits },
  };
}

function patchResult(patch: string): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: "call_e",
    toolName: "edit",
    content: [{ type: "text", text: "" }],
    details: { patch },
  };
}

describe("toDiffLinesList", () => {
  it("edit + result patch: one card per hunk with context", () => {
    // A single hunk changing one line, plus a trailing context line.
    const patch = [
      "--- a/foo.ts",
      "+++ b/foo.ts",
      "@@ -1,3 +1,3 @@",
      " let a = 1;",
      "-let b = 2;",
      "+let b = 20;",
      " let c = 3;",
      "",
    ].join("\n");
    const cards = toDiffLinesList(editCall("foo.ts", "", ""), patchResult(patch));
    expect(cards).toHaveLength(1);
    const [c] = cards;
    expect(c.filename).toBe("b/foo.ts");
    expect(c.additions).toBe(1);
    expect(c.deletions).toBe(1);
    expect(c.lines.map((l) => `${l.kind}:${l.text}`)).toEqual([
      "context:let a = 1;",
      "removed:let b = 2;",
      "added:let b = 20;",
      "context:let c = 3;",
    ]);
  });

  it("edit + result patch: multi-hunk splits into N cards", () => {
    const patch = [
      "--- a/f.ts",
      "+++ b/f.ts",
      "@@ -1,3 +1,3 @@",
      " a",
      "-b",
      "+B",
      " c",
      "@@ -10,2 +10,2 @@",
      "-x",
      "+X",
      " y",
      "",
    ].join("\n");
    const cards = toDiffLinesList(editCall("f.ts", "", ""), patchResult(patch));
    expect(cards).toHaveLength(2);
    expect(cards[0].additions).toBe(1);
    expect(cards[0].deletions).toBe(1);
    expect(cards[0].lines.length).toBe(4);
    expect(cards[1].additions).toBe(1);
    expect(cards[1].deletions).toBe(1);
    expect(cards[1].lines.length).toBe(3);
  });

  it("edit streaming (no result): synthesized from old_string/new_string", () => {
    const cards = toDiffLinesList(
      editCall("src/x.ts", "let a = 1;", "let a = 100;"),
      undefined
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].filename).toBe("src/x.ts");
    expect(cards[0].additions).toBe(1);
    expect(cards[0].deletions).toBe(1);
    expect(cards[0].lines).toEqual([
      { kind: "removed", text: "let a = 1;" },
      { kind: "added", text: "let a = 100;" },
    ]);
  });

  it("write full content: one all-added card", () => {
    const cards = toDiffLinesList(
      writeCall("new.md", "hello\nworld\n"),
      undefined
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].filename).toBe("new.md");
    expect(cards[0].additions).toBe(2);
    expect(cards[0].deletions).toBe(0);
    expect(cards[0].lines).toEqual([
      { kind: "added", text: "hello" },
      { kind: "added", text: "world" },
    ]);
  });

  it("multi_edit synth: one card per edit entry", () => {
    const cards = toDiffLinesList(
      multiEditCall("app.ts", [
        { old_string: "foo", new_string: "bar" },
        { old_string: "baz\nqux", new_string: "qux\nbaz" },
      ]),
      undefined
    );
    expect(cards).toHaveLength(2);
    expect(cards[0].additions).toBe(1);
    expect(cards[0].deletions).toBe(1);
    expect(cards[1].additions).toBe(2);
    expect(cards[1].deletions).toBe(2);
  });

  it("missing-path fallback: filename is empty string, still emits card", () => {
    const cards = toDiffLinesList(
      { ...editCall("", "a", "b") },
      undefined
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].filename).toBe("");
  });

  it("no data at all: returns []", () => {
    const call: ToolCallContent = {
      type: "toolCall",
      toolCallId: "x",
      toolName: "edit",
      input: { path: "empty.ts" },
    };
    const cards: DiffCard[] = toDiffLinesList(call, undefined);
    expect(cards).toEqual([]);
  });

  it("result.details.diff is accepted as a patch source", () => {
    const patch = [
      "--- a/n.md",
      "+++ b/n.md",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "",
    ].join("\n");
    const result: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "call_e",
      content: [{ type: "text", text: "" }],
      details: { diff: patch },
    };
    const cards = toDiffLinesList(editCall("n.md", "", ""), result);
    expect(cards).toHaveLength(1);
    expect(cards[0].additions).toBe(1);
    expect(cards[0].deletions).toBe(1);
  });
});

/* ---------------------------------------------------------------------- */
/* toReasoningSteps                                                       */
/* ---------------------------------------------------------------------- */

function thinking(text: string, deferred = false): ThinkingContent {
  return { type: "thinking", thinking: text, deferred };
}

describe("toReasoningSteps", () => {
  it("empty streaming placeholder: single step with empty body", () => {
    const out = toReasoningSteps(thinking(""), { streaming: true });
    expect(out.streaming).toBe(true);
    expect(out.steps).toEqual([{ title: "Thinking", body: "" }]);
    expect(out.visibleSteps).toBe(1);
  });

  it("streaming with partial text", () => {
    const out = toReasoningSteps(thinking("hello wo"), { streaming: true });
    expect(out.steps[0].body).toBe("hello wo");
    expect(out.streaming).toBe(true);
  });

  it("done with full text: single step, not streaming", () => {
    const out = toReasoningSteps(
      thinking("first thought.\nsecond thought."),
      { streaming: false, durationSec: 3 }
    );
    expect(out.streaming).toBe(false);
    expect(out.steps).toEqual([
      { title: "Thinking", body: "first thought.\nsecond thought." },
    ]);
    expect(out.elapsed).toBe("3s");
  });

  it("zero-duration edge case: no `elapsed` field emitted", () => {
    const out = toReasoningSteps(thinking("x"), { durationSec: 0 });
    expect(out.elapsed).toBeUndefined();
  });

  it("negative duration is treated as unknown (no elapsed)", () => {
    const out = toReasoningSteps(thinking("x"), { durationSec: -1 });
    expect(out.elapsed).toBeUndefined();
  });

  it("long duration formats as `Xm Ys`", () => {
    const out = toReasoningSteps(thinking("x"), { durationSec: 125 });
    expect(out.elapsed).toBe("2m 5s");
  });

  it("custom resting label / step title come through verbatim", () => {
    const out = toReasoningSteps(thinking("z"), {
      restingLabel: "已思考",
      stepTitle: "推理",
    });
    expect(out.restingLabel).toBe("已思考");
    expect(out.steps[0].title).toBe("推理");
  });
});

/* ---------------------------------------------------------------------- */
/* toTimingStats                                                          */
/* ---------------------------------------------------------------------- */

function baseMessage(over: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    model: "claude-opus-4",
    provider: "anthropic",
    ...over,
  };
}

describe("toTimingStats", () => {
  it("missing model: stat is omitted (not rendered as empty)", () => {
    const out = toTimingStats(baseMessage({ model: "" }));
    expect(out.stats.find((s) => s.label === "model")).toBeUndefined();
  });

  it("missing usage: stats degrade to model + duration only when known", () => {
    const out = toTimingStats(baseMessage({ duration: 1200 }));
    expect(out.stats.map((s) => s.label)).toEqual(["took", "model"]);
    expect(out.stats.find((s) => s.label === "took")?.value).toBe("1.2s");
  });

  it("all timing data uses compact-row priority order", () => {
    const out = toTimingStats(
      baseMessage({
        duration: 3500,
        ttft: 125,
        usage: {
          input: 512,
          output: 1024,
          cacheRead: 2048,
          cacheWrite: 128,
          cost: {
            input: 0.001,
            output: 0.01,
            cacheRead: 0.0005,
            cacheWrite: 0.0001,
            total: 0.02,
          },
        },
      })
    );
    expect(out.stats.map((s) => s.label)).toEqual([
      "took",
      "output",
      "model",
      "cache",
      "input",
      "cost",
      "TTFT",
    ]);
    expect(out.stats.map((s) => s.priority)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(out.stats[1].value).toBe("1.0k");
    // Ratio: 2048 / (512 + 2048) = 80%.
    expect(out.stats[3].value).toContain("80% hit");
    expect(out.stats[5].value).toContain("$0.02");
    expect(out.stats[6].value).toBe("125ms");
  });

  it("cache-hit ratio with zero cacheRead: cache stat omitted entirely", () => {
    const out = toTimingStats(
      baseMessage({
        usage: {
          input: 512,
          output: 128,
          cacheRead: 0,
          cacheWrite: 0,
          cost: {
            input: 0.001,
            output: 0.001,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0.002,
          },
        },
      })
    );
    expect(out.stats.find((s) => s.label === "cache")).toBeUndefined();
  });

  it("cache-hit ratio: cacheWrite-only shows write with no `hit`", () => {
    const out = toTimingStats(
      baseMessage({
        usage: {
          input: 100,
          output: 100,
          cacheRead: 0,
          cacheWrite: 500,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      })
    );
    const cache = out.stats.find((s) => s.label === "cache");
    expect(cache).toBeDefined();
    expect(cache!.value).toContain("write");
    expect(cache!.value).not.toContain("hit");
  });

  it("modelNames override wins over raw model id", () => {
    const out = toTimingStats(baseMessage({ model: "claude-opus-4" }), {
      modelNames: { "anthropic:claude-opus-4": "Opus 4" },
    });
    expect(out.stats.find((s) => s.label === "model")?.value).toBe("Opus 4");
  });

  it("streaming flag is preserved on output", () => {
    const out = toTimingStats(baseMessage({ duration: 900 }), { streaming: true });
    expect(out.streaming).toBe(true);
  });

  it("no cost.total → cost stat omitted", () => {
    const out = toTimingStats(
      baseMessage({
        usage: {
          input: 100,
          output: 100,
          cacheRead: 0,
          cacheWrite: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      })
    );
    expect(out.stats.find((s) => s.label === "cost")).toBeUndefined();
  });

  it("small duration < 1s formats as ms", () => {
    const out = toTimingStats(baseMessage({ duration: 450 }));
    expect(out.stats.find((s) => s.label === "took")?.value).toBe("450ms");
  });

  it("large duration formats as minutes+seconds", () => {
    const out = toTimingStats(baseMessage({ duration: 125_000 }));
    expect(out.stats.find((s) => s.label === "took")?.value).toBe("2m 5s");
  });
});
