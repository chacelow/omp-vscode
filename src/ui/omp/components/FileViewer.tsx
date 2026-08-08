// FileViewer.tsx — STUB
// File preview is provided by VS Code itself; render nothing.
// Props mirror the real component's interface so AppShell compiles unchanged.

export interface FileViewerProps {
  filePath: string;
  cwd?: string;
  sourceSessionId?: string | null;
  onOpenFile?: (filePath: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onMentionLines?: (...args: any[]) => void;
  gitRefreshKey?: number;
  initialDisplayMode?: unknown;
}

export function FileViewer(_props: FileViewerProps): null {
  return null;
}
