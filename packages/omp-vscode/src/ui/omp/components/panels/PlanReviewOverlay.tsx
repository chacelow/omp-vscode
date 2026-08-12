import { useMemo, useState } from "react";
import { MarkdownBody } from "../MarkdownBody";

export type PlanReviewResponse = {
  action: "accept" | "decline" | "cancel";
  content?: Record<string, string>;
};

interface PlanReviewOverlayProps {
  title?: string;
  plan: string;
  feedback?: string;
  choices?: string[];
  cwd?: string;
  onRespond: (response: PlanReviewResponse) => void;
}

function removeCurrentSection(markdown: string): string {
  const heading = /^#{1,6}\s.+$/m.exec(markdown);
  if (!heading || heading.index === undefined) return "";
  const start = heading.index;
  const level = heading[0].match(/^#+/)?.[0].length ?? 1;
  const following = new RegExp(`^#{1,${level}}\\s.+$`, "m");
  const remainder = markdown.slice(start + heading[0].length);
  const next = following.exec(remainder);
  const end =
    next?.index === undefined
      ? markdown.length
      : start + heading[0].length + next.index;
  return `${markdown.slice(0, start)}${markdown.slice(end)}`.trim();
}

export function PlanReviewOverlay({
  title = "Review plan",
  plan,
  feedback = "",
  choices = [],
  cwd,
  onRespond,
}: PlanReviewOverlayProps) {
  const [draftPlan, setDraftPlan] = useState(plan);
  const [draftFeedback, setDraftFeedback] = useState(feedback);
  const [history, setHistory] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const toc = useMemo(
    () =>
      Array.from(draftPlan.matchAll(/^(#{1,6})\s+(.+)$/gm)).map((match) => ({
        level: match[1].length,
        title: match[2],
      })),
    [draftPlan]
  );

  const replacePlan = (next: string) => {
    setHistory((current) => [...current, draftPlan]);
    setDraftPlan(next);
  };

  const copyPlan = async () => {
    await navigator.clipboard.writeText(draftPlan);
  };

  return (
    <div className="absolute inset-0 z-[95] flex bg-[var(--vscode-widget-shadow,rgba(0,0,0,0.18))] p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="border-border bg-background flex min-h-0 w-full flex-col overflow-hidden rounded-lg border shadow-[0_20px_60px_var(--vscode-widget-shadow,rgba(0,0,0,0.28))]"
      >
        <header className="border-border flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div>
            <h2 className="text-foreground text-sm font-semibold">{title}</h2>
            <p className="text-muted-foreground text-xs">
              Review the proposed plan and leave actionable feedback.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="border-border hover:bg-muted rounded border px-2 py-1 text-xs"
              onClick={() => void copyPlan()}
            >
              Copy plan
            </button>
            <button
              type="button"
              className="border-border hover:bg-muted rounded border px-2 py-1 text-xs"
              onClick={() => replacePlan(removeCurrentSection(draftPlan))}
            >
              Delete section
            </button>
            <button
              type="button"
              disabled={history.length === 0}
              className="border-border hover:bg-muted rounded border px-2 py-1 text-xs disabled:opacity-50"
              onClick={() => {
                const previous = history.at(-1);
                if (previous !== undefined) {
                  setHistory((current) => current.slice(0, -1));
                  setDraftPlan(previous);
                }
              }}
            >
              Undo
            </button>
            <button
              type="button"
              className="border-border hover:bg-muted rounded border px-2 py-1 text-xs"
              onClick={() => setEditing((current) => !current)}
            >
              {editing ? "Preview" : "External-edit"}
            </button>
          </div>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.42fr)]">
          <article className="border-border bg-muted/30 min-w-0 rounded border p-4">
            {toc.length > 0 && (
              <nav
                aria-label="Plan table of contents"
                className="border-border text-muted-foreground mb-4 border-b pb-3 text-xs"
              >
                {toc.map((item, index) => (
                  <div
                    key={`${item.title}-${index}`}
                    style={{ paddingLeft: `${(item.level - 1) * 12}px` }}
                  >
                    {item.title}
                  </div>
                ))}
              </nav>
            )}
            {editing ? (
              <textarea
                aria-label="Plan markdown"
                value={draftPlan}
                onChange={(event) => replacePlan(event.target.value)}
                className="border-border bg-background focus:border-primary min-h-80 w-full resize-y rounded border p-3 font-mono text-xs outline-none"
              />
            ) : (
              <MarkdownBody cwd={cwd} isStreaming={false}>
                {draftPlan}
              </MarkdownBody>
            )}
          </article>
          <aside className="border-border flex min-h-0 flex-col gap-3 rounded border p-3">
            <label className="text-foreground grid min-h-0 flex-1 gap-1.5 text-sm">
              <span>Feedback</span>
              <textarea
                autoFocus
                aria-label="Plan feedback"
                value={draftFeedback}
                onChange={(event) => setDraftFeedback(event.target.value)}
                className="border-border bg-muted focus:border-primary min-h-40 flex-1 resize-y rounded border p-2.5 text-sm outline-none"
                placeholder="What should change?"
              />
            </label>
            <div className="grid gap-2">
              {choices.map((choice) => (
                <button
                  key={choice}
                  type="button"
                  className="bg-primary text-primary-foreground min-h-10 rounded px-3 py-2 text-sm font-medium"
                  onClick={() =>
                    onRespond({
                      action: "accept",
                      content: {
                        choice,
                        plan: draftPlan,
                        feedback: draftFeedback,
                        annotations: "",
                      },
                    })
                  }
                >
                  {choice}
                </button>
              ))}
            </div>
          </aside>
        </div>
        <footer className="border-border bg-muted flex justify-end gap-2 border-t px-4 py-3">
          <button
            type="button"
            className="border-border bg-background rounded border px-3 py-2 text-sm"
            onClick={() => onRespond({ action: "decline" })}
          >
            Decline
          </button>
          <button
            type="button"
            className="border-border bg-background rounded border px-3 py-2 text-sm"
            onClick={() => onRespond({ action: "cancel" })}
          >
            Cancel
          </button>
          {choices.length === 0 && (
            <button
              type="button"
              className="bg-primary text-primary-foreground rounded px-3 py-2 text-sm font-medium"
              onClick={() =>
                onRespond({
                  action: "accept",
                  content: {
                    plan: draftPlan,
                    feedback: draftFeedback,
                    annotations: "",
                  },
                })
              }
            >
              Submit
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
