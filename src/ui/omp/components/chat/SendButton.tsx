import { memo } from "react";
import { Send, Square } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";

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
      <Button
        onClick={onAbort}
        variant="destructive"
        size="icon"
        title="Stop"
        className="h-8 w-8 rounded-full border border-[#ef4444]/45 bg-[#ef4444]/15 text-[#ef4444] hover:bg-[#ef4444]/25 hover:text-[#ef4444]"
      >
        <Square size={13} fill="currentColor" />
      </Button>
    );
  }
  return (
    <Button
      onClick={onSend}
      disabled={!canSend}
      variant={canSend ? "default" : "secondary"}
      size="icon"
      title="Send"
      className={cn("h-8 w-8 rounded-full", !canSend && "shadow-none")}
    >
      <Send size={15} />
    </Button>
  );
});
