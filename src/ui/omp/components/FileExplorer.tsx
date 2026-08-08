// FileExplorer.tsx — STUB
// File browsing is provided by VS Code itself, so the omp-web explorer
// renders nothing here. Kept as a stub so AppShell/SessionSidebar compile
// and render unchanged.

import { forwardRef } from "react";

export interface FileExplorerHandle {
  openUploadPicker: () => void;
}

export const FileExplorer = forwardRef<FileExplorerHandle, Record<string, unknown>>(
  function FileExplorer(_props, _ref) {
    return null;
  },
);
