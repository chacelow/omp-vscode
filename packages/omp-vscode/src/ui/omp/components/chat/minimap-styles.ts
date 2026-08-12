// ChatMinimap styles as Tailwind classes (CSS modules are not supported by
// the esbuild pipeline). data-* / has-* / focus-visible variants map 1:1
// from omp-web's ChatMinimap.module.css; colors use VS Code tokens.
import { cn } from "@/lib/utils";

export const styles = {
  heading: cn(
    "cm-heading block w-[calc(100%+34px)] min-h-[26px] min-w-0 ml-[-34px] px-[10px] py-1 pl-10 border-0 rounded-none bg-transparent overflow-hidden text-left text-ellipsis whitespace-nowrap cursor-pointer",
    "transition-[background,color] duration-100 hover:bg-[color-mix(in_srgb,var(--text)_6%,transparent)] hover:text-[var(--text)]",
    "focus-visible:outline-0 focus-visible:bg-[color-mix(in_srgb,var(--text)_6%,transparent)] focus-visible:shadow-[inset_2px_0_0_color-mix(in_srgb,var(--text-muted)_65%,transparent)]",
    "data-[level=1]:min-h-8 data-[level=1]:py-[7px] data-[level=1]:text-[var(--text)] data-[level=1]:text-[14px] data-[level=1]:font-semibold",
    "data-[level=2]:min-h-7 data-[level=2]:py-[5px] data-[level=2]:pl-[50px] data-[level=2]:text-[color-mix(in_srgb,var(--text)_88%,var(--text-muted))] data-[level=2]:text-[12px] data-[level=2]:font-medium",
    "data-[level=3]:pl-[60px] data-[level=3]:text-[var(--text-muted)] data-[level=3]:text-[11px] data-[level=3]:font-normal"
  ),
  outline: "cm-outline grid min-w-0 gap-0",
  paragraph: cn(
    "cm-paragraph block w-[calc(100%+34px)] min-h-[26px] min-w-0 ml-[-34px] px-[10px] py-1 pl-10 border-0 rounded-none bg-transparent overflow-hidden text-left text-ellipsis whitespace-nowrap cursor-pointer",
    "text-[var(--text-muted)] text-[14px] font-normal transition-[background,color] duration-100 hover:bg-[color-mix(in_srgb,var(--text)_6%,transparent)] hover:text-[var(--text)]",
    "focus-visible:outline-0 focus-visible:bg-[color-mix(in_srgb,var(--text)_6%,transparent)] focus-visible:shadow-[inset_2px_0_0_color-mix(in_srgb,var(--text-muted)_65%,transparent)]"
  ),
  preview: cn(
    "cm-preview absolute top-0 bottom-0 right-full z-[100] w-[320px] overflow-x-hidden overflow-y-auto overscroll-contain",
    "[scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] bg-[var(--bg)]",
    "border-l border-[color-mix(in_srgb,var(--border)_82%,transparent)] shadow-[-10px_0_26px_var(--vscode-widget-shadow,rgba(0,0,0,0.35))]",
    "pointer-events-auto cursor-default select-text"
  ),
  turn: cn(
    "cm-turn relative grid grid-cols-[34px_minmax(0,1fr)] border-b border-[color-mix(in_srgb,var(--border)_68%,transparent)] bg-transparent",
    "transition-[background,box-shadow] duration-120",
    "data-[located=true]:bg-[color-mix(in_srgb,var(--text)_4%,var(--bg))] data-[located=true]:shadow-[inset_2px_0_0_color-mix(in_srgb,var(--text-muted)_70%,transparent)]"
  ),
  number: cn(
    "cm-number relative z-[1] col-start-1 flex items-center justify-center w-[34px] h-8 p-0",
    "text-[var(--text-dim)] font-mono text-[10px] tabular-nums leading-[18px] text-center"
  ),
  content: "cm-content col-start-2 min-w-0",
  user: cn(
    "cm-user block w-[calc(100%+34px)] min-h-8 max-h-[86px] ml-[-34px] px-[10px] py-[7px] pl-10 border-0 rounded-none bg-transparent",
    "text-[var(--text)] text-[14px] font-medium leading-[18px] text-left cursor-pointer overflow-hidden",
    "transition-[background] duration-100 hover:bg-[color-mix(in_srgb,var(--text)_6%,transparent)]",
    "focus-visible:outline-0 focus-visible:bg-[color-mix(in_srgb,var(--text)_6%,transparent)] focus-visible:shadow-[inset_2px_0_0_color-mix(in_srgb,var(--text-muted)_65%,transparent)]"
  ),
  userText:
    "cm-user-text line-clamp-4 overflow-hidden [overflow-wrap:anywhere] whitespace-pre-wrap",
  assistant:
    "cm-assistant relative block border-t border-[color-mix(in_srgb,var(--border)_52%,transparent)]",
  assistantJump: cn(
    "cm-assistant-jump absolute top-0 left-[-29px] z-[2] w-6 h-[26px] p-0 border-0 bg-transparent",
    "text-[var(--text-dim)] font-mono text-[10px] font-semibold leading-[26px] text-center cursor-pointer",
    "transition-[color,background] duration-100 hover:text-[var(--text)] hover:bg-[var(--bg-subtle)]",
    "focus-visible:outline focus-visible:outline-[1px] focus-visible:outline-[color-mix(in_srgb,var(--text-muted)_65%,transparent)] focus-visible:outline-offset-1",
    "has-[[data-level='1']:first-child]:h-8 has-[[data-level='1']:first-child]:leading-8",
    "has-[[data-level='2']:first-child]:h-7 has-[[data-level='2']:first-child]:leading-7"
  ),
} as const;
