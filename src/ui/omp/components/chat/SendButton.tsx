import { memo } from "react";

// Round primary send/stop button — one button, two states, icon-only:
//   idle      → Send (accent circle, disabled when empty)
//   streaming → Stop (danger circle, calls onAbort)

interface SendButtonProps {
  isStreaming: boolean;
  canSend: boolean;
  onSend: () => void;
  onAbort: () => void;
  sendLabel?: string;
  stopLabel?: string;
}

function SendIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="2" y1="7.5" x2="12" y2="7.5" />
      <polyline points="8 3.5 12.5 7.5 8 11.5" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 12 12" fill="currentColor">
      <rect x="1" y="1" width="10" height="10" rx="2" />
    </svg>
  );
}

export const SendButton = memo(function SendButton({ isStreaming, canSend, onSend, onAbort }: SendButtonProps) {
  if (isStreaming) {
    return (
      <button
        onClick={onAbort}
        title="Stop"
        className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-[#ef4444]/45 bg-[#ef4444]/15 text-[#ef4444] transition-colors hover:bg-[#ef4444]/25"
      >
        <StopIcon />
      </button>
    );
  }
  return (
    <button
      onClick={onSend}
      disabled={!canSend}
      title="Send"
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-none transition-colors ${
        canSend
          ? "cursor-pointer bg-[var(--accent)] text-white shadow-[0_1px_4px_rgba(37,99,235,0.35)]"
          : "cursor-not-allowed bg-[var(--bg-panel)] text-[var(--text-dim)]"
      }`}
    >
      <SendIcon />
    </button>
  );
});
