import { memo } from "react";
import { Send, Square } from "lucide-react";

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

export const SendButton = memo(function SendButton({ isStreaming, canSend, onSend, onAbort }: SendButtonProps) {
  if (isStreaming) {
    return (
      <button
        onClick={onAbort}
        title="Stop"
        className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-[#ef4444]/45 bg-[#ef4444]/15 text-[#ef4444] transition-colors hover:bg-[#ef4444]/25"
      >
        <Square size={13} fill="currentColor" />
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
      <Send size={15} />
    </button>
  );
});
