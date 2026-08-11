import type { AcpHostEvent, AcpRequest, AcpResponseEnvelope } from "../core/acp/protocol";
import type {
  HostMethod,
  HostParams,
  HostResult,
  HostResultMessage,
} from "../core/host/protocol";
import { ompPost } from "./boot";

type Listener = (event: AcpHostEvent) => void;
type PendingRequest<T = unknown> = {
  resolve: (data: T) => void;
  reject: (error: Error) => void;
};

const acpPending = new Map<number, PendingRequest>();
const hostPending = new Map<number, PendingRequest>();
let acpSeq = 0;
let hostSeq = 0;
const listeners = new Set<Listener>();

window.addEventListener(
  "message",
  (ev: MessageEvent<AcpHostEvent | AcpResponseEnvelope | HostResultMessage>) => {
    const msg = ev.data;
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "acp/response") {
      const p = acpPending.get(msg.requestId);
      if (!p) return;
      acpPending.delete(msg.requestId);
      if (msg.ok) p.resolve(msg.data);
      else p.reject(new Error(msg.error?.message ?? "Unknown error"));
      return;
    }

    if (msg.type === "host/result") {
      const p = hostPending.get(msg.requestId);
      if (!p) return;
      hostPending.delete(msg.requestId);
      if (msg.ok) p.resolve(msg.data);
      else p.reject(new Error(msg.error ?? "Host call failed"));
      return;
    }

    if (
      msg.type === "acp/connection" ||
      msg.type === "acp/sessionSnapshot" ||
      msg.type === "acp/runningSessions" ||
      msg.type === "acp/permissionRequest" ||
      msg.type === "acp/elicitationRequest" ||
      msg.type === "acp/error"
    ) {
      for (const l of listeners) l(msg);
    }
  },
);

export function acpRequest<R extends AcpRequest>(request: R): Promise<unknown> {
  const requestId = ++acpSeq;
  return new Promise((resolve, reject) => {
    acpPending.set(requestId, { resolve, reject });
    ompPost({ type: "acp/request", requestId, request });
  });
}

export function hostCall<M extends HostMethod>(
  method: M,
  params: HostParams<M>,
): Promise<HostResult<M>> {
  const requestId = ++hostSeq;
  return new Promise<HostResult<M>>((resolve, reject) => {
    hostPending.set(requestId, {
      resolve: (data) => resolve(data as HostResult<M>),
      reject,
    });
    ompPost({ type: "host/call", requestId, method, params });
  });
}

export function subscribeAcp(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function openInVSCode(filePath: string): void {
  ompPost({ type: "openFile", path: filePath });
}

export function openImageInVSCode(data: string, mimeType: string): void {
  ompPost({ type: "openImage", data, mimeType }
    
  );
}

declare global {
  interface Window {
    openInVSCode: typeof openInVSCode;
    openImageInVSCode: typeof openImageInVSCode;
  }
}
window.openInVSCode = openInVSCode;
window.openImageInVSCode = openImageInVSCode;
