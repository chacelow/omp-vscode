import type * as vscode from "vscode";
import type { HostMethod, HostMethods } from "./protocol";
import { handlers } from "./handlers";

export interface HostServiceDeps {
  log: vscode.OutputChannel;
  cwd: string;
}

/** Typed dispatcher for webview → extension host calls (non-agent, non-omp).
 *  Every entry in `HostMethods` maps to a handler in `handlers/*`. */
export class HostService {
  constructor(readonly deps: HostServiceDeps) {}

  async dispatch<M extends HostMethod>(
    method: M,
    params: unknown,
  ): Promise<HostMethods[M]["result"]> {
    const handler = handlers[method];
    if (!handler) throw new Error(`Unknown host method: ${method}`);
    // Each handler is a typed function keyed by method name.
    return (await handler(params as never, this)) as HostMethods[M]["result"];
  }
}
