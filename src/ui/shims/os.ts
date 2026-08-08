// Browser shim for node:os — only used by dead code paths in the webview.
export function homedir(): string {
  return "/";
}

export function tmpdir(): string {
  return "/tmp";
}

export function platform(): string {
  return "browser";
}

export function hostname(): string {
  return "webview";
}

export default {
  homedir,
  tmpdir,
  platform,
  hostname,
};
