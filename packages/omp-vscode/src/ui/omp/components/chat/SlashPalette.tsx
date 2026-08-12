import { memo, useState } from "react";
import type { SlashCommandInfo } from "@/hooks/useAgentSession";

// Slash-command palette — opens above the textarea when the user types "/".
// Groups commands by source (builtin/extension/prompt/skill), dormant skills
// sink to the bottom of their group.

export interface SlashCommandPaletteItem {
  name: string;
  description?: string;
  inputHint?: string;
  aliases?: string[];
  aliasOf?: string;
  source: SlashCommandInfo["source"] | "builtin";
}

type SlashCommandSource = SlashCommandPaletteItem["source"];

const SLASH_SOURCES: SlashCommandSource[] = [
  "builtin",
  "extension",
  "prompt",
  "skill",
];

const SLASH_SOURCE_GROUP_LABEL_KEYS: Record<SlashCommandSource, string> = {
  builtin: "chat.builtIn",
  extension: "chat.extensions",
  prompt: "chat.prompts",
  skill: "chat.skills",
};

export const SLASH_SOURCE_ORDER: Record<SlashCommandSource, number> = {
  builtin: 0,
  extension: 1,
  prompt: 2,
  skill: 3,
};

export function getSlashDescription(
  command: SlashCommandPaletteItem,
  t: (key: string) => string
): string {
  if (command.aliasOf) return `(alias of /${command.aliasOf})`;
  return command.source === "builtin"
    ? t(command.description ?? "")
    : (command.description ?? "");
}

// Skill slash commands are named "skill:<skillName>"; look the skill up in the
// dormancy map fetched from /api/skills. Unknown skills are treated as active.
function isDormantSkillCommand(
  command: SlashCommandPaletteItem,
  dormancy: Record<string, boolean>
): boolean {
  if (command.source !== "skill" || !command.name.startsWith("skill:"))
    return false;
  return dormancy[command.name.slice("skill:".length)] === true;
}

export function slashMatchRank(
  command: SlashCommandPaletteItem,
  query: string,
  t: (key: string) => string
): number {
  const name = command.name.toLowerCase();
  const description = getSlashDescription(command, t).toLowerCase();
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  if (description.includes(query)) return 3;
  return 4;
}

export function slashSourceOrder(): number[] {
  return SLASH_SOURCES.map((s) => SLASH_SOURCE_ORDER[s]);
}

export function buildSlashCommandLayout(
  commands: SlashCommandPaletteItem[],
  dormancy: Record<string, boolean>
) {
  let index = 0;
  const groups = SLASH_SOURCES.map((source) => {
    const sourceCommands = commands.filter(
      (command) => command.source === source
    );
    const orderedCommands =
      source === "skill"
        ? [
            ...sourceCommands.filter(
              (command) => !isDormantSkillCommand(command, dormancy)
            ),
            ...sourceCommands.filter((command) =>
              isDormantSkillCommand(command, dormancy)
            ),
          ]
        : sourceCommands;
    return {
      source,
      items: orderedCommands.map((command) => ({ command, index: index++ })),
    };
  }).filter((group) => group.items.length > 0);

  return {
    commands: groups.flatMap((group) =>
      group.items.map(({ command }) => command)
    ),
    groups,
  };
}

interface SlashPaletteProps {
  loading?: boolean;
  countLabel: string;
  filtered: SlashCommandPaletteItem[];
  groups: ReturnType<typeof buildSlashCommandLayout>["groups"];
  query: string;
  activeIndex: number;
  dormancy: Record<string, boolean>;
  onApply: (command: SlashCommandPaletteItem) => void;
  onHover: (index: number) => void;
  itemRefs: React.RefObject<(HTMLButtonElement | null)[]>;
  t: (key: string, params?: Record<string, string | number>) => string;
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const pattern = new RegExp(
    `(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
    "ig"
  );
  return text.split(pattern).map((part, index) =>
    part.localeCompare(query, undefined, { sensitivity: "accent" }) === 0 ? (
      <mark
        key={index}
        className="rounded-sm bg-[var(--bg-selected)] px-0.5 text-[var(--text)]"
      >
        {part}
      </mark>
    ) : (
      part
    )
  );
}

const MAX_VISIBLE_PER_GROUP = 3;

export const SlashPalette = memo(function SlashPalette({
  loading,
  countLabel,
  filtered,
  groups,
  query,
  activeIndex,
  dormancy,
  onApply,
  onHover,
  itemRefs,
  t,
}: SlashPaletteProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<SlashCommandSource>>(
    () => new Set()
  );
  const isSearching = query.trim().length > 0;
  return (
    <div className="absolute inset-x-0 bottom-[calc(100%+8px)] z-[120] max-h-[min(56vh,460px)] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)] shadow-[0_-6px_20px_var(--vscode-widget-shadow,rgba(0,0,0,0.12))]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-2.5 py-2 text-[11px] text-[var(--text-dim)]">
        <span>
          {loading
            ? t("chat.loadingCommands")
            : t("chat.slashCommands", { label: countLabel })}
        </span>
        <span className="font-mono">{t("chat.tabEnter")}</span>
      </div>
      <div
        className="overflow-y-auto p-2.5"
        style={{ maxHeight: "calc(min(56vh, 460px) - 34px)" }}
      >
        {!loading && filtered.length === 0 ? (
          <div className="px-0.5 pb-1 text-xs text-[var(--text-dim)]">
            {t("chat.noCommands")}
          </div>
        ) : isSearching ? (
          <div className="space-y-1">
            {filtered.map((command, index) => {
              const active = index === activeIndex;
              const dormant = isDormantSkillCommand(command, dormancy);
              return (
                <button
                  key={`${command.source}:${command.name}`}
                  ref={(node) => {
                    itemRefs.current[index] = node;
                  }}
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onApply(command);
                  }}
                  onMouseEnter={() => onHover(index)}
                  className={`flex min-h-9 w-full min-w-0 items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-left text-[var(--text)] ${active ? "bg-[var(--bg-selected)]" : "hover:bg-[var(--bg-hover)]"}`}
                >
                  <span className="shrink-0 font-mono text-[13px]">
                    /{highlightMatch(command.name, query)}
                  </span>
                  {command.inputHint && (
                    <span className="min-w-0 truncate font-mono text-[11px] text-[var(--text-dim)]">
                      {command.inputHint}
                    </span>
                  )}
                  {dormant && (
                    <span className="rounded-[3px] border border-[var(--border)] px-1 text-[9px] text-[var(--text-dim)]">
                      {t("chat.dormant")}
                    </span>
                  )}
                  {getSlashDescription(command, t) && (
                    <span className="min-w-0 truncate text-[11px] text-[var(--text-dim)]">
                      {highlightMatch(getSlashDescription(command, t), query)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          groups.map((group) => {
            const expanded = expandedGroups.has(group.source);
            const visibleItems = expanded
              ? group.items
              : group.items.slice(0, MAX_VISIBLE_PER_GROUP);
            const hiddenCount = group.items.length - visibleItems.length;
            return (
              <section key={group.source} className="mb-3 last:mb-0">
                <div className="sticky top-[-10px] z-[1] flex items-center justify-between gap-2 bg-[var(--bg)] px-0 pt-1 pb-1.5 text-[10px] font-semibold tracking-wide text-[var(--text-dim)] uppercase">
                  <span>{t(SLASH_SOURCE_GROUP_LABEL_KEYS[group.source])}</span>
                  <span className="font-mono font-medium">
                    {group.items.length}
                  </span>
                </div>
                <div className="space-y-1">
                  {visibleItems.map(({ command, index }) => {
                    const active = index === activeIndex;
                    const dormant = isDormantSkillCommand(command, dormancy);
                    return (
                      <button
                        key={`${command.source}:${command.name}`}
                        ref={(node) => {
                          itemRefs.current[index] = node;
                        }}
                        type="button"
                        onMouseDown={(event) => {
                          event.preventDefault();
                          onApply(command);
                        }}
                        onMouseEnter={() => onHover(index)}
                        className={`flex min-h-9 w-full min-w-0 items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-left text-[var(--text)] ${active ? "bg-[var(--bg-selected)]" : "hover:bg-[var(--bg-hover)]"}`}
                      >
                        <span className="shrink-0 font-mono text-[13px]">
                          /{command.name}
                        </span>
                        {command.inputHint && (
                          <span className="min-w-0 truncate font-mono text-[11px] text-[var(--text-dim)]">
                            {command.inputHint}
                          </span>
                        )}
                        {dormant && (
                          <span className="rounded-[3px] border border-[var(--border)] px-1 text-[9px] text-[var(--text-dim)]">
                            {t("chat.dormant")}
                          </span>
                        )}
                        {getSlashDescription(command, t) && (
                          <span className="min-w-0 truncate text-[11px] text-[var(--text-dim)]">
                            {getSlashDescription(command, t)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                  {hiddenCount > 0 && (
                    <button
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        setExpandedGroups((current) =>
                          new Set(current).add(group.source)
                        );
                      }}
                      className="h-8 w-full rounded-[7px] px-2.5 text-left text-[11px] text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-muted)]"
                    >
                      Show {hiddenCount} more
                    </button>
                  )}
                </div>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
});
