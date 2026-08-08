import { memo } from "react";
import { ArrowUp, OctagonX } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "@/lib/utils";

// Round primary send/stop button — one button, two states, icon-only,
// same size as the toolbar buttons (h-6):
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
        size="sm"
        title="Stop"
        className="h-6 w-6 shrink-0 rounded-full border border-destructive/45 bg-destructive/15 p-0 text-destructive hover:bg-destructive/25 hover:text-destructive"
      >
        <OctagonX size={15} />
      </Button>
    );
  }
  return (
    <Button
      onClick={onSend}
      disabled={!canSend}
      variant={canSend ? "highlight" : "ghost"}
      size="sm"
      title="Send"
      className={cn("h-6 w-6 shrink-0 rounded-full p-0", !canSend && "cursor-not-allowed")}
    >
      <ArrowUp size={14} strokeWidth={2.5} />
    </Button>
  );
});
