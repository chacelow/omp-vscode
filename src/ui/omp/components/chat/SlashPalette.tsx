import { memo } from "react";
import type { SlashCommandInfo } from "@/hooks/useAgentSession";

// Slash-command palette — opens above the textarea when the user types "/".
// Groups commands by source (builtin/extension/prompt/skill), dormant skills
// sink to the bottom of their group.

export type SlashCommandPaletteItem = SlashCommandInfo | {
  name: string;
  description: string;
  source: "builtin";
  argumentHint?: string;
};

type SlashCommandSource = SlashCommandPaletteItem["source"];

const SLASH_SOURCES: SlashCommandSource[] = ["builtin", "extension", "prompt", "skill"];

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

export function getSlashDescription(command: SlashCommandPaletteItem, t: (key: string) => string): string {
  return command.source === "builtin" ? t(command.description) : command.description ?? "";
}

// Skill slash commands are named "skill:<skillName>"; look the skill up in the
// dormancy map fetched from /api/skills. Unknown skills are treated as active.
function isDormantSkillCommand(command: SlashCommandPaletteItem, dormancy: Record<string, boolean>): boolean {
  if (command.source !== "skill" || !command.name.startsWith("skill:")) return false;
  return dormancy[command.name.slice("skill:".length)] === true;
}

export function slashMatchRank(command: SlashCommandPaletteItem, query: string, t: (key: string) => string): number {
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
  dormancy: Record<string, boolean>,
) {
  let index = 0;
  const groups = SLASH_SOURCES
    .map((source) => {
      const sourceCommands = commands.filter((command) => command.source === source);
      const orderedCommands = source === "skill"
        ? [
            ...sourceCommands.filter((command) => !isDormantSkillCommand(command, dormancy)),
            ...sourceCommands.filter((command) => isDormantSkillCommand(command, dormancy)),
          ]
        : sourceCommands;
      return {
        source,
        items: orderedCommands.map((command) => ({ command, index: index++ })),
      };
    })
    .filter((group) => group.items.length > 0);

  return {
    commands: groups.flatMap((group) => group.items.map(({ command }) => command)),
    groups,
  };
}

interface SlashPaletteProps {
  loading?: boolean;
  countLabel: string;
  filtered: SlashCommandPaletteItem[];
  groups: ReturnType<typeof buildSlashCommandLayout>["groups"];
  activeIndex: number;
  dormancy: Record<string, boolean>;
  onApply: (command: SlashCommandPaletteItem) => void;
  onHover: (index: number) => void;
  itemRefs: React.RefObject<(HTMLButtonElement | null)[]>;
  t: (key: string, params?: Record<string, string | number>) => string;
}

export const SlashPalette = memo(function SlashPalette({
  loading, countLabel, filtered, groups, activeIndex, dormancy, onApply, onHover, itemRefs, t,
}: SlashPaletteProps) {
  return (
    <div className="absolute inset-x-0 bottom-[calc(100%+8px)] z-[120] max-h-[min(56vh,460px)] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)] shadow-[0_-6px_20px_rgba(0,0,0,0.12)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-2.5 py-2 text-[11px] text-[var(--text-dim)]">
        <span>{loading ? t("chat.loadingCommands") : t("chat.slashCommands", { label: countLabel })}</span>
        <span className="font-mono">{t("chat.tabEnter")}</span>
      </div>
      <div className="overflow-y-auto p-2.5" style={{ maxHeight: "calc(min(56vh, 460px) - 34px)" }}>
        {!loading && filtered.length === 0 ? (
          <div className="px-0.5 pb-1 text-xs text-[var(--text-dim)]">
            {t("chat.noCommands")}
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.source} className="mb-3">
              <div className="sticky top-[-10px] z-[1] flex items-center justify-between gap-2 bg-[var(--bg)] px-0 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-dim)]">
                <span>{t(SLASH_SOURCE_GROUP_LABEL_KEYS[group.source])}</span>
                <span className="font-mono font-medium">{group.items.length}</span>
              </div>
              <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                {group.items.map(({ command, index }) => {
                  const active = index === activeIndex;
                  const dormant = isDormantSkillCommand(command, dormancy);
                  return (
                    <button
                      key={`${command.source}:${command.name}`}
                      ref={(node) => { itemRefs.current[index] = node; }}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); onApply(command); }}
                      onMouseEnter={() => onHover(index)}
                      className={`flex min-h-[58px] min-w-0 flex-col justify-center gap-1 rounded-[7px] border px-2.5 py-2 text-left text-[var(--text)] ${
                        active
                          ? "border-[var(--accent)] bg-[var(--bg-selected)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent)_28%,transparent)]"
                          : "border-[var(--border)] bg-[var(--bg-panel)]"
                      }`}
                    >
                      <span className="break-words font-mono text-[13px]" style={{ overflowWrap: "anywhere" }}>
                        /{command.name}
                        {dormant && (
                          <span className="ml-1.5 whitespace-nowrap rounded-[3px] border border-[var(--border)] px-1 text-[9px] text-[var(--text-dim)]">
                            {t("chat.dormant")}
                          </span>
                        )}
                      </span>
                      {command.description && (
                        <span className="text-[11px] leading-[1.35] text-[var(--text-dim)]" style={{ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, overflow: "hidden" }}>
                          {getSlashDescription(command, t)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
});
