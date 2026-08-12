"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useGlobalKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { SessionSidebar } from "./SessionSidebar";
import { hostCall, openInVSCode } from "../../bridge";
import { ChatWindow } from "./ChatWindow";
import { FileViewer } from "./FileViewer";
import { TabBar, type Tab } from "./TabBar";
// Config surfaces moved to the Workbench editor tab (WorkbenchShell).
import { ProjectTrustDialog } from "./ProjectTrustDialog";
import { BranchNavigator } from "./BranchNavigator";
import { SessionResumeDialog } from "./SessionResumeDialog";
import { SessionTreeNodes } from "./chat/session-tree-view";
import { LanguagePicker } from "./LanguagePicker";
import { applyTheme } from "./SettingsSelector";
import { THEMES } from "@/lib/themes";
import { PreferencesProvider } from "@/hooks/usePreferences";
import { useTheme } from "@/hooks/useTheme";
import { useLanguage } from "@/hooks/useLanguage";
import { StarfieldEmblem } from "./StarfieldEmblem";
import { useI18n } from "@/hooks/useI18n";
import { useViewportHeight } from "@/hooks/useViewportHeight";
import { Spinner, LoadingState } from "./ui/spinner";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import {
  Check,
  Copy,
  Gauge,
  History,
  Map,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldAlert,
} from "lucide-react";
import { useResizablePanel } from "@/hooks/useResizablePanel";
import { copyText } from "@/lib/clipboard";
import { getFileName } from "@/lib/file-paths";
import {
  buildAtMentionText,
  buildFileAtMentionsText,
  buildFileLineMentionText,
} from "@/lib/file-fuzzy";
import {
  getInitialNavigation,
  rememberLastSession,
} from "@/lib/initial-navigation";
import {
  getDefaultRightPanelWidth,
  getRightPanelMaxWidth,
  getSidebarMaxWidth,
  RIGHT_PANEL_FALLBACK_WIDTH,
  RIGHT_PANEL_MAX_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "@/lib/panel-layout";
import type { SessionInfo, SessionTreeNode } from "@/lib/types";
import type { ProjectTrustStatus } from "@/lib/api-types";
import type { ChatInputHandle } from "./ChatInput";
import type { SessionStatsInfo } from "@/lib/pi-types";

type SessionCopyField = "file" | "id";

export function AppShell() {
  return (
    <PreferencesProvider>
      <AppShellContent />
    </PreferencesProvider>
  );
}

function AppShellContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [initialNavigation] = useState(() =>
    getInitialNavigation(searchParams)
  );
  const { isStarfield } = useTheme();
  const { t } = useLanguage();
  const { locale, t: translate } = useI18n();
  useViewportHeight();

  // VS Code positions the webview overlay via CSS anchor(); it only
  // re-computes on interaction (e.g. opening a dropdown), which can leave
  // the iframe a couple of px off after mount. Nudge it once the app has
  // rendered so the overlay settles at the correct spot immediately.
  useEffect(() => {
    const t = setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
      window.scrollTo(0, 0);
    }, 400);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    const savedTheme = localStorage.getItem("omp.theme");
    const theme = THEMES.find((candidate) => candidate.name === savedTheme);
    if (theme) applyTheme(theme);
  }, []);
  const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(
    null
  );
  // When user clicks +, we only store the cwd — no fake session id
  const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null);
  const [initialCwdStatus, setInitialCwdStatus] = useState<
    "idle" | "validating" | "ready" | "error"
  >(() => (initialNavigation.requestedCwd ? "validating" : "idle"));
  const [initialCwdError, setInitialCwdError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sessionKey, setSessionKey] = useState(0);
  const [minimapOpen, setMinimapOpen] = useState(false);
  const [treeOpen, setTreeOpen] = useState(false);
  const [explorerRefreshKey, setExplorerRefreshKey] = useState(0);
  const [modelsRefreshKey, setModelsRefreshKey] = useState(0);
  const [projectTrust, setProjectTrust] = useState<ProjectTrustStatus | null>(
    null
  );
  const [projectTrustDialogOpen, setProjectTrustDialogOpen] = useState(false);
  const [projectTrustBusy, setProjectTrustBusy] = useState(false);
  const [projectTrustError, setProjectTrustError] = useState<string | null>(
    null
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const sidebarWidthRef = useRef(SIDEBAR_DEFAULT_WIDTH);
  const rightPanelWidthRef = useRef(RIGHT_PANEL_FALLBACK_WIDTH);
  const getResponsiveRightPanelWidth = useCallback(
    () =>
      typeof window === "undefined"
        ? RIGHT_PANEL_FALLBACK_WIDTH
        : getDefaultRightPanelWidth(window.innerWidth),
    []
  );
  const getResponsiveSidebarMaxWidth = useCallback(
    () =>
      typeof window === "undefined"
        ? SIDEBAR_MAX_WIDTH
        : getSidebarMaxWidth({
            viewportWidth: window.innerWidth,
            rightPanelOpen,
            rightPanelWidth: rightPanelWidthRef.current,
          }),
    [rightPanelOpen]
  );
  const getResponsiveRightPanelMaxWidth = useCallback(
    () =>
      typeof window === "undefined"
        ? RIGHT_PANEL_MAX_WIDTH
        : getRightPanelMaxWidth({
            viewportWidth: window.innerWidth,
            sidebarOpen,
            sidebarWidth: sidebarWidthRef.current,
          }),
    [sidebarOpen]
  );
  const sidebarResizer = useResizablePanel({
    ariaLabel: translate("layout.resizeSidebar"),
    cssVariable: "--sidebar-width",
    defaultWidth: SIDEBAR_DEFAULT_WIDTH,
    getMaxWidth: getResponsiveSidebarMaxWidth,
    growthDirection: "right",
    maxWidth: SIDEBAR_MAX_WIDTH,
    minWidth: SIDEBAR_MIN_WIDTH,
    storageKey: "pi-sidebar-width",
    widthRef: sidebarWidthRef,
  });
  const rightPanelResizer = useResizablePanel({
    ariaLabel: translate("layout.resizeFilePanel"),
    cssVariable: "--right-panel-width",
    defaultWidth: RIGHT_PANEL_FALLBACK_WIDTH,
    getDefaultWidth: getResponsiveRightPanelWidth,
    getMaxWidth: getResponsiveRightPanelMaxWidth,
    growthDirection: "left",
    maxWidth: RIGHT_PANEL_MAX_WIDTH,
    minWidth: RIGHT_PANEL_MIN_WIDTH,
    storageKey: "pi-right-panel-width",
    widthRef: rightPanelWidthRef,
  });
  const reclampSidebarWidth = sidebarResizer.reclampWidth;
  const reclampRightPanelWidth = rightPanelResizer.reclampWidth;
  useEffect(() => {
    if (!rightPanelOpen) return;
    reclampSidebarWidth();
    reclampRightPanelWidth();
  }, [reclampRightPanelWidth, reclampSidebarWidth, rightPanelOpen]);
  const chatInputRef = useRef<ChatInputHandle | null>(null);
  const topBarRef = useRef<HTMLDivElement>(null);

  // Branch navigator state — populated by ChatWindow via onBranchDataChange
  const [branchTree, setBranchTree] = useState<SessionTreeNode[]>([]);
  const [branchActiveLeafId, setBranchActiveLeafId] = useState<string | null>(
    null
  );
  const branchLeafChangeFnRef = useRef<
    ((leafId: string | null) => Promise<void>) | null
  >(null);
  const [resumeDialogOpen, setResumeDialogOpen] = useState(false);

  const handleBranchDataChange = useCallback(
    (
      tree: SessionTreeNode[],
      activeLeafId: string | null,
      onLeafChange: (leafId: string | null) => Promise<void>
    ) => {
      setBranchTree(tree);
      setBranchActiveLeafId(activeLeafId);
      branchLeafChangeFnRef.current = onLeafChange;
    },
    []
  );

  const handleBranchLeafChange = useCallback(
    async (leafId: string | null): Promise<void> => {
      await branchLeafChangeFnRef.current?.(leafId);
    },
    []
  );

  useEffect(() => {
    const openResume = () => setResumeDialogOpen(true);
    window.addEventListener("omp:resume-session", openResume);
    return () => window.removeEventListener("omp:resume-session", openResume);
  }, []);

  // Session stats (tokens + cost) — populated by ChatWindow, displayed in top bar
  const [sessionStats, setSessionStats] = useState<SessionStatsInfo | null>(
    null
  );
  const handleSessionStatsChange = useCallback(
    (stats: SessionStatsInfo | null) => {
      setSessionStats(stats);
    },
    []
  );
  const [copiedSessionField, setCopiedSessionField] =
    useState<SessionCopyField | null>(null);
  const sessionCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const handleCopySessionField = useCallback(
    (field: SessionCopyField, value: string) => {
      void copyText(value).then(() => {
        if (sessionCopyTimerRef.current)
          clearTimeout(sessionCopyTimerRef.current);
        setCopiedSessionField(field);
        sessionCopyTimerRef.current = setTimeout(
          () => setCopiedSessionField(null),
          1400
        );
      });
    },
    []
  );

  useEffect(() => {
    return () => {
      if (sessionCopyTimerRef.current)
        clearTimeout(sessionCopyTimerRef.current);
    };
  }, []);

  // Context usage — populated by ChatWindow, displayed in top bar
  const [contextUsage, setContextUsage] = useState<{
    percent: number | null;
    contextWindow: number;
    tokens: number | null;
  } | null>(null);
  const handleContextUsageChange = useCallback(
    (
      usage: {
        percent: number | null;
        contextWindow: number;
        tokens: number | null;
      } | null
    ) => {
      setContextUsage(usage);
    },
    []
  );

  // Single active panel — only one dropdown open at a time
  const [activeTopPanel, setActiveTopPanel] = useState<
    "branches" | "system" | "session" | "language" | null
  >(null);
  const [topPanelPos, setTopPanelPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const toggleTopPanel = useCallback(
    (panel: "branches" | "system" | "session" | "language") => {
      setActiveTopPanel((cur) => (cur === panel ? null : panel));
    },
    []
  );

  const handleSidebarToggle = useCallback(() => {
    setSidebarOpen((open) => !open);
  }, []);

  useEffect(() => {
    if (!activeTopPanel || !topBarRef.current) return;
    const update = () => {
      const topBarRect = topBarRef.current!.getBoundingClientRect();
      setTopPanelPos({
        top: topBarRect.bottom,
        left: topBarRect.left,
        width: topBarRect.width,
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(topBarRef.current);
    return () => ro.disconnect();
  }, [activeTopPanel]);

  // Right panel — file tabs only
  const [fileTabs, setFileTabs] = useState<Tab[]>([]);
  const [activeFileTabId, setActiveFileTabId] = useState<string | null>(null);

  // Same @mention format as the chat input's @ autocomplete, so the agent's
  // read tool resolves it the same way (it strips the @ prefix).
  const handleAtMention = useCallback(
    (relativePath: string, isDir: boolean) => {
      chatInputRef.current?.insertText(buildAtMentionText(relativePath, isDir));
    },
    []
  );

  const handleAtMentions = useCallback((relativePaths: string[]) => {
    const mentions = buildFileAtMentionsText(relativePaths);
    if (mentions) chatInputRef.current?.insertText(mentions);
  }, []);

  const handleFileLineMention = useCallback(
    (relativePath: string, startLine: number, endLine: number) => {
      chatInputRef.current?.insertText(
        buildFileLineMentionText(relativePath, startLine, endLine)
      );
    },
    []
  );

  const initialSessionId = initialNavigation.sessionId;
  const [activeCwd, setActiveCwd] = useState<string | null>(null);
  const activeProjectRootRef = useRef<string | null>(null);
  // True once the initial ?session= URL param has been resolved (or confirmed absent)
  const [initialSessionRestored, setInitialSessionRestored] = useState<boolean>(
    () => !initialSessionId
  );
  // Suppresses sessionKey bump in handleCwdChange during the initial URL restore
  const suppressCwdBumpRef = useRef(false);

  useEffect(() => {
    const requestedCwd = initialNavigation.requestedCwd;
    if (!requestedCwd) return;

    let active = true;
    setInitialCwdStatus("validating");
    setInitialCwdError(null);

    void hostCall("cwdValidate", { cwd: requestedCwd })
      .then((data) => {
        if (!data.cwd)
          throw new Error(data.error ?? "Failed to validate directory");

        // The sidebar will notify us when it adopts this cwd. Avoid remounting
        // the just-created empty chat during that initial synchronization.
        suppressCwdBumpRef.current = true;
        setNewSessionCwd(data.cwd);
        setInitialCwdStatus("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setInitialCwdError(
          error instanceof Error ? error.message : String(error)
        );
        setInitialCwdStatus("error");
      });

    return () => {
      active = false;
    };
  }, [initialNavigation]);

  const handleCwdChange = useCallback(
    (cwd: string | null, projectRoot?: string | null) => {
      setActiveCwd(cwd);
      // Skip if cwd is null (initial mount).
      if (!cwd) return;
      const newProject = projectRoot ?? cwd;
      const currentProject =
        activeProjectRootRef.current ??
        (selectedSession
          ? (selectedSession.projectRoot ?? selectedSession.cwd)
          : null);
      activeProjectRootRef.current = newProject;

      // Keep the project identity in sync during the initial URL restore without
      // remounting the just-created or restored chat.
      if (suppressCwdBumpRef.current) {
        suppressCwdBumpRef.current = false;
        return;
      }
      // Worktrees of one repo share a project root. Moving the effective cwd
      // within the same project (e.g. switching worktree, or clicking a session
      // that lives in another worktree) must not close the open session.
      if (currentProject === newProject) {
        return;
      }
      // Close any session that belongs to a different project — it no longer
      // matches the selected project directory.
      setSelectedSession(null);
      setNewSessionCwd((prev) => {
        if (prev && prev !== cwd) return null;
        return prev;
      });
      setSessionKey((k) => k + 1);
      setBranchTree([]);
      setBranchActiveLeafId(null);
      setActiveTopPanel(null);
      // File tabs are keyed by absolute path, so tabs opened in the previous
      // project would otherwise linger after switching to a different project.
      // Reached only past the same-project early return above, so worktrees of
      // one repo keep their open tabs. Mirror handleCloseFileTab and close the
      // now-empty right panel.
      setFileTabs([]);
      setActiveFileTabId(null);
      setRightPanelOpen(false);
      router.replace("/", { scroll: false });
    },
    [router, selectedSession]
  );

  const handleSelectSession = useCallback(
    (session: SessionInfo, isRestore = false) => {
      setNewSessionCwd(null);
      setSelectedSession(session);
      rememberLastSession(session.id, session.cwd);
      setSessionKey((k) => k + 1);
      setInitialSessionRestored(true);
      if (isRestore) {
        // Suppress the redundant sessionKey bump that would come from the
        // onCwdChange effect firing after setSelectedCwd in the sidebar
        suppressCwdBumpRef.current = true;
      }
      // Skip router.replace when restoring from URL — the param is already correct
      // and calling replace in production Next.js triggers a Suspense remount loop
      // Collapse the sidebar so the picked session's chat gets full attention.
      // Skip on URL restore — no user gesture triggered it, and the sidebar
      // starts closed by default anyway.
      if (!isRestore) {
        setSidebarOpen(false);
        router.replace(`?session=${encodeURIComponent(session.id)}`, {
          scroll: false,
        });
      }
    },
    [router]
  );

  const handleNewSession = useCallback(
    (_sessionId: string, cwd: string) => {
      setSelectedSession(null);
      rememberLastSession(null);
      setNewSessionCwd(cwd);
      setSessionKey((k) => k + 1);
      setBranchTree([]);
      setBranchActiveLeafId(null);
      setActiveTopPanel(null);
      router.replace("/", { scroll: false });
    },
    [router]
  );

  // Global keyboard shortcuts (handles Esc, Ctrl+Alt+N etc.)
  useGlobalKeyboardShortcuts({
    onNewSession: (cwd: string) => handleNewSession(`kb-${Date.now()}`, cwd),
    activeCwd,
  });

  // Client-built transient SessionInfo (new session / fork) lacks the
  // server-computed projectRoot, which the same-project check in
  // handleCwdChange relies on. Hydrate it from the session list so switching
  // worktrees right after creating a session doesn't close the chat.
  const hydrateSelectedSession = useCallback((sessionId: string) => {
    void hostCall("sessionsList", {})
      .then(({ sessions }) => {
        const full = sessions.find((s) => s.id === sessionId);
        if (!full) return;
        setSelectedSession((prev) =>
          prev && prev.id === sessionId && !prev.projectRoot ? full : prev
        );
      })
      .catch(() => {});
  }, []);

  // Called by ChatWindow when a new session gets its real id from pi
  const handleSessionCreated = useCallback(
    (session: SessionInfo) => {
      setNewSessionCwd(null);
      setSelectedSession(session);
      rememberLastSession(session.id, session.cwd);
      setBranchTree([]);
      setBranchActiveLeafId(null);
      setRefreshKey((k) => k + 1);
      hydrateSelectedSession(session.id);
      router.replace(`?session=${encodeURIComponent(session.id)}`, {
        scroll: false,
      });
    },
    [router, hydrateSelectedSession]
  );

  const handleAgentEnd = useCallback(() => {
    setRefreshKey((k) => k + 1);
    setExplorerRefreshKey((k) => k + 1);
  }, []);

  const handleExplorerRefresh = useCallback(() => {
    setExplorerRefreshKey((k) => k + 1);
  }, []);

  const handleSessionForked = useCallback(
    (newSessionId: string) => {
      setRefreshKey((k) => k + 1);
      setSessionKey((k) => k + 1);
      setNewSessionCwd(null);
      setBranchTree([]);
      setBranchActiveLeafId(null);
      rememberLastSession(newSessionId, selectedSession?.cwd ?? newSessionCwd);
      setSelectedSession((prev) => ({
        ...(prev ?? {
          path: "",
          cwd: "",
          created: "",
          modified: "",
          messageCount: 0,
          firstMessage: "",
        }),
        id: newSessionId,
      }));
      hydrateSelectedSession(newSessionId);
      router.replace(`?session=${encodeURIComponent(newSessionId)}`, {
        scroll: false,
      });
    },
    [router, hydrateSelectedSession, selectedSession?.cwd, newSessionCwd]
  );

  const handleInitialRestoreDone = useCallback(() => {
    setInitialSessionRestored(true);
  }, []);

  const handleSessionDeleted = useCallback(
    (sessionId: string) => {
      setRefreshKey((k) => k + 1);
      if (selectedSession?.id === sessionId) {
        const cwd = selectedSession.cwd;
        setSelectedSession(null);
        rememberLastSession(null);
        setNewSessionCwd(cwd ?? null);
        setSessionKey((k) => k + 1);
        setBranchTree([]);
        setBranchActiveLeafId(null);
        setActiveTopPanel(null);
        router.replace("/", { scroll: false });
      }
    },
    [selectedSession, router]
  );

  const handleOpenFile = useCallback(
    (
      filePath: string,
      fileName: string,
      options?: { sourceSessionId?: string | null; modeHint?: "diff" }
    ) => {
      const sourceSessionId = options?.sourceSessionId;
      const modeHint = options?.modeHint;
      const tabId = `file:${filePath}`;
      setFileTabs((prev) => {
        const existing = prev.find((t) => t.id === tabId);
        if (!existing) {
          return [
            ...prev,
            {
              id: tabId,
              label: fileName,
              filePath,
              sourceSessionId,
              initialDisplayMode: modeHint,
            },
          ];
        }
        const sourceUnchanged =
          !sourceSessionId || existing.sourceSessionId === sourceSessionId;
        const modeUnchanged =
          !modeHint || existing.initialDisplayMode === modeHint;
        if (sourceUnchanged && modeUnchanged) return prev;
        return prev.map((t) => {
          if (t.id !== tabId) return t;
          const next: Tab = { ...t };
          if (sourceSessionId) next.sourceSessionId = sourceSessionId;
          if (modeHint) next.initialDisplayMode = modeHint;
          return next;
        });
      });
      setActiveFileTabId(tabId);
      setRightPanelOpen(true);
    },
    []
  );

  const handleOpenLinkedFile = useCallback(
    (filePath: string) => {
      // Open in the REAL VS Code editor (native openTextDocument). The old
      // webview file-panel tabs are gone — this is the chat's file-open path.
      // Pass the session cwd so the extension can resolve relative paths
      // (agents often emit `apps/foo/bar.tsx` without leading slash).
      openInVSCode(filePath, selectedSession?.cwd ?? activeCwd);
    },
    [activeCwd, selectedSession?.cwd]
  );

  const handleCloseFileTab = useCallback(
    (tabId: string) => {
      setFileTabs((prev) => {
        const next = prev.filter((t) => t.id !== tabId);
        if (next.length === 0) setRightPanelOpen(false);
        return next;
      });
      setActiveFileTabId((cur) => {
        if (cur !== tabId) return cur;
        const remaining = fileTabs.filter((t) => t.id !== tabId);
        return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
      });
    },
    [fileTabs]
  );

  // Show chat area if a session is selected, or if we have a cwd to start a new session in
  const effectiveNewSessionCwd =
    newSessionCwd ?? (selectedSession === null && activeCwd ? activeCwd : null);
  const showChat = selectedSession !== null || effectiveNewSessionCwd !== null;
  const projectTrustCwd = selectedSession?.cwd ?? effectiveNewSessionCwd;
  // While restoring initial session from URL, don't show the placeholder
  const showPlaceholder = initialSessionRestored && !showChat;

  useEffect(() => {
    setProjectTrust(null);
    setProjectTrustDialogOpen(false);
    setProjectTrustError(null);
    if (!projectTrustCwd) return;

    let active = true;
    void hostCall("projectTrustGet", { cwd: projectTrustCwd })
      .then((data) => {
        if (!active) return;
        setProjectTrust({
          trusted: data.trusted,
          requiresTrust: !data.trusted,
        });
      })
      .catch((error) => {
        if (active) console.error("Failed to load project trust:", error);
      });
    return () => {
      active = false;
    };
  }, [projectTrustCwd]);

  const handleTrustProject = useCallback(async () => {
    if (!projectTrustCwd || projectTrustBusy) return;
    setProjectTrustBusy(true);
    setProjectTrustError(null);
    try {
      const data = await hostCall("projectTrustSet", { cwd: projectTrustCwd });
      if (
        typeof data !== "object" ||
        data === null ||
        !("trusted" in data) ||
        typeof data.trusted !== "boolean"
      ) {
        const error =
          typeof data === "object" &&
          data !== null &&
          "error" in data &&
          typeof data.error === "string"
            ? data.error
            : "Failed to trust project";
        throw new Error(error);
      }
      setProjectTrust({ trusted: data.trusted, requiresTrust: !data.trusted });
      setProjectTrustDialogOpen(false);
      setModelsRefreshKey((key) => key + 1);
      setSessionKey((key) => key + 1);
    } catch (error) {
      setProjectTrustError(
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setProjectTrustBusy(false);
    }
  }, [projectTrustBusy, projectTrustCwd]);

  const activeFileTab = fileTabs.find((t) => t.id === activeFileTabId) ?? null;
  const activeCwdName = activeCwd ? getFileName(activeCwd) || activeCwd : null;
  const windowTitle = activeCwdName ? `${activeCwdName} - OMP Web` : "OMP Web";

  useEffect(() => {
    const syncWindowTitle = () => {
      if (document.title !== windowTitle) document.title = windowTitle;
    };

    syncWindowTitle();
    const observer = new MutationObserver(syncWindowTitle);
    observer.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => observer.disconnect();
  }, [windowTitle]);

  const sidebarContent = (
    <>
      <SessionSidebar
        selectedSessionId={selectedSession?.id ?? null}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        initialSessionId={initialSessionId}
        skipInitialProjectSelection={initialNavigation.requestedCwd !== null}
        onInitialRestoreDone={handleInitialRestoreDone}
        refreshKey={refreshKey}
        onSessionDeleted={handleSessionDeleted}
        selectedCwd={selectedSession?.cwd ?? newSessionCwd ?? null}
        onCwdChange={handleCwdChange}
        onOpenFile={handleOpenFile}
        explorerRefreshKey={explorerRefreshKey}
        onExplorerRefresh={handleExplorerRefresh}
        onAtMention={handleAtMention}
        onAtMentions={handleAtMentions}
      />
      <div
        style={{
          padding: "8px",
          flexShrink: 0,
          display: "flex",
          justifyContent: "stretch",
          gap: 4,
        }}
      >
        <button
          type="button"
          onClick={() => {
            void hostCall("openWorkbench", {});
          }}
          title={translate("common.workbench") || "Open Workbench"}
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            height: 32,
            padding: 0,
            background: "none",
            border: "none",
            borderRadius: 9,
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 12,
            transition: "background 0.12s, color 0.12s",
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.background = "var(--bg-hover)";
            event.currentTarget.style.color = "var(--text)";
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = "none";
            event.currentTarget.style.color = "var(--text-muted)";
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="7" height="9" rx="1.5" />
            <rect x="14" y="3" width="7" height="5" rx="1.5" />
            <rect x="14" y="12" width="7" height="9" rx="1.5" />
            <rect x="3" y="16" width="7" height="5" rx="1.5" />
          </svg>
          {translate("common.workbench") || "Workbench"}
        </button>
        {resumeDialogOpen && (
          <SessionResumeDialog
            currentCwd={activeCwd}
            onClose={() => setResumeDialogOpen(false)}
            onSelectSession={(session) => {
              setResumeDialogOpen(false);
              handleSelectSession(session);
            }}
          />
        )}
      </div>
    </>
  );

  return (
    <>
      <style>{`
      @keyframes session-info-pop {
        0% {
          opacity: 0;
          transform: translateY(-24px);
          filter: blur(6px);
          box-shadow: 0 2px 8px rgba(0,0,0,0);
        }
        55% {
          opacity: 1;
          transform: translateY(0);
          filter: blur(0);
          background: color-mix(in srgb, var(--accent) 8%, var(--bg-panel));
          box-shadow: 0 18px 44px color-mix(in srgb, var(--accent) 16%, transparent);
        }
        100% {
          opacity: 1;
          transform: translateY(0);
          filter: blur(0);
          background: var(--bg-panel);
          box-shadow: 0 10px 28px var(--vscode-widget-shadow, rgba(0,0,0,0.10));
        }
      }
      @keyframes session-info-light-wash {
        0% {
          opacity: 0;
          transform: translateX(-110%) skewX(-16deg);
        }
        24% {
          opacity: 0.42;
        }
        100% {
          opacity: 0;
          transform: translateX(115%) skewX(-16deg);
        }
      }
      .session-info-popover {
        position: relative;
        overflow: hidden;
        transform-origin: top right;
        animation: session-info-pop 360ms ease-out both;
        will-change: transform, opacity, filter, background, box-shadow;
      }
      .session-info-popover::after {
        content: "";
        position: absolute;
        top: 0;
        bottom: 0;
        left: 0;
        width: 44%;
        pointer-events: none;
        background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 24%, transparent), transparent);
        animation: session-info-light-wash 620ms ease-out both;
      }
      @media (prefers-reduced-motion: reduce) {
        .session-info-popover,
        .session-info-popover::after {
          animation: none;
        }
      }
    `}</style>
      <div
        style={{
          display: "flex",
          width: "100%",
          minWidth: 420,
          height: "var(--app-viewport-height, 100%)",
          paddingLeft: "env(safe-area-inset-left)",
          paddingRight: "env(safe-area-inset-right)",
          overflowX: "auto",
          overflowY: "hidden",
          background: "var(--bg)",
        }}
      >
        {/* Left sidebar */}
        <div
          ref={sidebarResizer.panelRef}
          id="session-sidebar"
          className={`sidebar-container${sidebarOpen ? "sidebar-open" : "sidebar-closed"}${sidebarResizer.isResizing ? "sidebar-resizing" : ""}`}
          style={
            {
              "--sidebar-width": `${sidebarResizer.width}px`,
              background: "var(--bg-panel)",
              borderRight: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              flexShrink: 0,
              paddingTop: "env(safe-area-inset-top)",
              paddingBottom: "env(safe-area-inset-bottom)",
              zIndex: 200,
            } as React.CSSProperties
          }
        >
          {sidebarContent}
        </div>
        {sidebarOpen && (
          <div
            {...sidebarResizer.separatorProps}
            aria-controls="session-sidebar"
            className={`panel-resize-handle sidebar-resize-handle${sidebarResizer.isResizing ? "is-resizing" : ""}`}
            data-resize-handle="sidebar"
            title={`${translate("layout.resizeSidebar")}: ${translate("layout.resizeHint")}`}
          />
        )}

        {/* Center: chat */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            minWidth: 0,
          }}
        >
          {/* Top bar with sidebar toggle */}
          <div
            ref={topBarRef}
            className="relative flex flex-shrink-0 items-center gap-0.5 border-b border-[var(--border)] bg-[var(--bg-panel)] px-1.5"
            style={{
              height: "calc(36px + env(safe-area-inset-top))",
              paddingTop: "env(safe-area-inset-top)",
            }}
          >
            {initialCwdStatus === "validating" && (
              <Spinner
                size={12}
                className="mx-1 shrink-0 text-[var(--text-dim)]"
              />
            )}
            <Button
              variant="ghost"
              size="toolbar"
              onClick={handleSidebarToggle}
              title={
                sidebarOpen
                  ? translate("sidebar.hide")
                  : translate("sidebar.show")
              }
              aria-label={
                sidebarOpen
                  ? translate("sidebar.hide")
                  : translate("sidebar.show")
              }
              aria-pressed={sidebarOpen}
              className={cn(
                "text-[var(--text-muted)]",
                sidebarOpen && "text-[var(--text)]"
              )}
            >
              {sidebarOpen ? <PanelLeftClose /> : <PanelLeftOpen />}
            </Button>
            <LanguagePicker />
            {showChat &&
              projectTrust?.requiresTrust &&
              !projectTrust.trusted && (
                <Button
                  variant="ghost"
                  size="toolbar"
                  onClick={() => {
                    setProjectTrustError(null);
                    setProjectTrustDialogOpen(true);
                  }}
                  title={translate("trust.resourcesNotLoaded")}
                  aria-label={translate("trust.resourcesNotLoaded")}
                  className="text-[#d97706] hover:text-[#f59e0b]"
                >
                  <ShieldAlert />
                </Button>
              )}
            {showChat && (
              <>
                <Button
                  variant="ghost"
                  size="toolbar"
                  onClick={() => setTreeOpen((o) => !o)}
                  title={translate("history.full")}
                  aria-label={translate("history.full")}
                  aria-pressed={treeOpen}
                  className={cn(
                    "text-[var(--text-muted)]",
                    treeOpen && "bg-[var(--bg-selected)] text-[var(--text)]"
                  )}
                >
                  <History />
                </Button>
                <Button
                  variant="ghost"
                  size="toolbar"
                  onClick={() => setMinimapOpen((o) => !o)}
                  title={translate("i18n.sessionMap") ?? "Conversation map"}
                  aria-label={
                    translate("i18n.sessionMap") ?? "Conversation map"
                  }
                  aria-pressed={minimapOpen}
                  className={cn(
                    "text-[var(--text-muted)]",
                    minimapOpen && "bg-[var(--bg-selected)] text-[var(--text)]"
                  )}
                >
                  <Map />
                </Button>
                {treeOpen && (
                  <div className="absolute inset-x-0 top-full z-[60] max-h-[min(60vh,420px)] overflow-y-auto border-b border-[var(--border)] bg-[var(--bg-panel)] p-2 shadow-[0_10px_28px_var(--vscode-widget-shadow,rgba(0,0,0,0.10))]">
                    {branchTree.length > 0 ? (
                      <SessionTreeNodes
                        tree={branchTree}
                        activeIds={
                          new Set(
                            branchActiveLeafId ? [branchActiveLeafId] : []
                          )
                        }
                        onSelect={async (entryId) => {
                          await handleBranchLeafChange(entryId);
                          setTreeOpen(false);
                        }}
                      />
                    ) : (
                      <p className="p-3 text-xs text-[var(--text-dim)]">
                        {translate("history.unsaved") ??
                          "Full history unavailable — send a message first."}
                      </p>
                    )}
                  </div>
                )}
                <BranchNavigator
                  tree={branchTree}
                  activeLeafId={branchActiveLeafId}
                  onLeafChange={handleBranchLeafChange}
                  sessionId={selectedSession?.id}
                  inline
                  compact
                  containerRef={topBarRef}
                  open={activeTopPanel === "branches"}
                  onToggle={() => toggleTopPanel("branches")}
                  hasSession
                />
              </>
            )}
            <Button
              variant="ghost"
              size="toolbar"
              onClick={() => {
                void hostCall("openWorkbench", {});
              }}
              title="Open Workbench"
              aria-label="Open Workbench"
              className="text-[var(--text-muted)]"
            >
              <Settings />
            </Button>
            {showChat && (
              <Button
                variant="ghost"
                size="toolbar"
                onClick={() => toggleTopPanel("session")}
                title={translate("session.title")}
                aria-label={translate("session.title")}
                aria-pressed={activeTopPanel === "session"}
                className={cn(
                  "ml-auto text-[var(--text-muted)]",
                  activeTopPanel === "session" &&
                    "bg-[var(--bg-selected)] text-[var(--text)]"
                )}
              >
                <Gauge />
              </Button>
            )}
            {/* Top panel dropdown — shared, only one active at a time */}
            {activeTopPanel && topPanelPos && (
              <div
                style={{
                  position: "fixed",
                  top: topPanelPos.top,
                  left: topPanelPos.left,
                  width: topPanelPos.width,
                  maxHeight: `calc(100dvh - ${topPanelPos.top}px)`,
                  overflowY: "auto",
                  zIndex: 500,
                }}
              >
                {activeTopPanel === "session" && (
                  <div className="session-info-popover border-b border-[var(--border)] bg-[var(--bg-panel)] px-4 py-3 shadow-[0_10px_28px_var(--vscode-widget-shadow,rgba(0,0,0,0.10))]">
                    {sessionStats ? (
                      (() => {
                        const sessionRows = [
                          ...(sessionStats.sessionName
                            ? [
                                {
                                  label: translate("session.name"),
                                  value: sessionStats.sessionName,
                                  copyField: null,
                                },
                              ]
                            : []),
                          {
                            label: translate("session.file"),
                            value:
                              sessionStats.sessionFile ??
                              translate("session.inMemory"),
                            copyField: "file" as const,
                          },
                          {
                            label: translate("session.id"),
                            value: sessionStats.sessionId,
                            copyField: "id" as const,
                          },
                        ];
                        const messageRows = [
                          [
                            translate("session.user"),
                            sessionStats.userMessages.toLocaleString(locale),
                          ],
                          [
                            translate("session.assistant"),
                            sessionStats.assistantMessages.toLocaleString(
                              locale
                            ),
                          ],
                          [
                            translate("session.toolCalls"),
                            sessionStats.toolCalls.toLocaleString(locale),
                          ],
                          [
                            translate("session.toolResults"),
                            sessionStats.toolResults.toLocaleString(locale),
                          ],
                          [
                            translate("session.total"),
                            sessionStats.totalMessages.toLocaleString(locale),
                          ],
                        ];
                        const tokenRows = [
                          [
                            translate("session.input"),
                            sessionStats.tokens.input.toLocaleString(locale),
                          ],
                          [
                            translate("session.output"),
                            sessionStats.tokens.output.toLocaleString(locale),
                          ],
                          ...(sessionStats.tokens.cacheRead > 0
                            ? [
                                [
                                  translate("session.cacheRead"),
                                  sessionStats.tokens.cacheRead.toLocaleString(
                                    locale
                                  ),
                                ],
                              ]
                            : []),
                          ...(sessionStats.tokens.cacheWrite > 0
                            ? [
                                [
                                  translate("session.cacheWrite"),
                                  sessionStats.tokens.cacheWrite.toLocaleString(
                                    locale
                                  ),
                                ],
                              ]
                            : []),
                          [
                            translate("session.total"),
                            sessionStats.tokens.total.toLocaleString(locale),
                          ],
                        ];
                        const ctx = contextUsage ?? sessionStats.contextUsage;
                        const formatCompact = (n: number) =>
                          n >= 1_000_000
                            ? `${(n / 1_000_000).toFixed(1)}M`
                            : n >= 1000
                              ? `${(n / 1000).toFixed(0)}k`
                              : String(n);
                        const extraTokenRows = [
                          ...(sessionStats.cost > 0
                            ? [
                                [
                                  translate("session.cost"),
                                  `$${sessionStats.cost.toFixed(4)}`,
                                ],
                              ]
                            : []),
                          ...(ctx?.contextWindow
                            ? [
                                [
                                  translate("session.context"),
                                  `${ctx.percent !== null ? `${ctx.percent.toFixed(1)}%` : "?"} / ${formatCompact(ctx.contextWindow)}`,
                                ],
                              ]
                            : []),
                        ];
                        const section = (
                          title: string,
                          sectionRows: string[][],
                          valueAlign: "left" | "right" = "left",
                          compact = false
                        ) => (
                          <div className="min-w-0">
                            <div className="mb-1.5 text-[11px] font-bold text-[var(--text)]">
                              {title}
                            </div>
                            <div
                              className={cn(
                                "grid",
                                compact
                                  ? "grid-cols-[max-content_max-content] justify-start gap-x-3.5 gap-y-1"
                                  : "grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1"
                              )}
                            >
                              {sectionRows.map(([label, value]) => (
                                <div
                                  key={`${title}:${label}`}
                                  className="contents"
                                >
                                  <div className="whitespace-nowrap text-[var(--text-dim)]">
                                    {label}
                                  </div>
                                  <div
                                    className={cn(
                                      "min-w-0 text-[var(--text-muted)]",
                                      compact ? "" : "break-anywhere",
                                      valueAlign === "right" &&
                                        "text-right whitespace-nowrap"
                                    )}
                                  >
                                    {value}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                        const copyButton = (
                          field: SessionCopyField,
                          value: string
                        ) => {
                          const copied = copiedSessionField === field;
                          return (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              title={
                                copied
                                  ? translate("session.copied")
                                  : translate(
                                      field === "file"
                                        ? "session.copyFile"
                                        : "session.copyId"
                                    )
                              }
                              onClick={() =>
                                handleCopySessionField(field, value)
                              }
                              className={cn(
                                "mt-[-2px] h-[22px] w-[22px] shrink-0 self-start rounded-[4px] border border-[var(--border)] p-0 text-[var(--text-dim)]",
                                copied
                                  ? "text-[var(--accent)]"
                                  : "hover:border-[var(--accent)] hover:bg-[var(--bg-hover)] hover:text-[var(--accent)]"
                              )}
                            >
                              {copied ? (
                                <Check size={12} />
                              ) : (
                                <Copy size={12} />
                              )}
                            </Button>
                          );
                        };
                        const sessionInfoSection = (
                          <div className="min-w-0">
                            <div className="mb-1.5 text-[11px] font-bold text-[var(--text)]">
                              {translate("session.infoSection")}
                            </div>
                            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2">
                              {sessionRows.map((row) => (
                                <div
                                  key={`session-info:${row.label}`}
                                  className="contents"
                                >
                                  <div className="whitespace-nowrap text-[var(--text-dim)]">
                                    {row.label}
                                  </div>
                                  <div
                                    className="min-w-0 break-words text-[var(--text-muted)]"
                                    style={{ overflowWrap: "anywhere" }}
                                  >
                                    {row.value}
                                  </div>
                                  <div>
                                    {row.copyField
                                      ? copyButton(row.copyField, row.value)
                                      : null}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );

                        return (
                          <div
                            className={cn(
                              "grid gap-4 font-mono text-xs leading-[1.5]",
                              "grid-cols-[minmax(360px,1.7fr)_minmax(140px,0.55fr)_minmax(190px,0.75fr)] gap-x-6"
                            )}
                          >
                            {sessionInfoSection}
                            {section(
                              translate("session.messages"),
                              messageRows
                            )}
                            {section(
                              translate("session.tokens"),
                              [...tokenRows, ...extraTokenRows],
                              "right",
                              true
                            )}
                          </div>
                        );
                      })()
                    ) : (
                      <div className="text-xs text-[var(--text-muted)] italic">
                        {translate("session.load")}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Chat content */}
          <div
            style={{
              flex: 1,
              overflow: "hidden",
              position: "relative",
              minHeight: 0,
            }}
          >
            {showChat ? (
              <ChatWindow
                key={sessionKey}
                session={selectedSession}
                newSessionCwd={effectiveNewSessionCwd}
                minimapOpen={minimapOpen}
                onAgentEnd={handleAgentEnd}
                onSessionCreated={handleSessionCreated}
                onSessionForked={handleSessionForked}
                modelsRefreshKey={modelsRefreshKey}
                chatInputRef={chatInputRef}
                onBranchDataChange={handleBranchDataChange}
                onSessionStatsChange={handleSessionStatsChange}
                onOpenSettings={() => {
                  void hostCall("openWorkbench", {});
                }}
                onOpenResumeDialog={() => setResumeDialogOpen(true)}
                onContextUsageChange={handleContextUsageChange}
                onOpenFile={handleOpenLinkedFile}
                cwdName={activeCwdName}
                cwd={activeCwd}
                onCwdChange={(nextCwd) => handleCwdChange(nextCwd)}
              />
            ) : initialCwdStatus === "validating" ? (
              <LoadingState label={translate("workspace.opening")}>
                <div
                  style={{
                    maxWidth: "min(720px, 100%)",
                    overflowWrap: "anywhere",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--text-muted)",
                  }}
                >
                  {initialNavigation.requestedCwd}
                </div>
              </LoadingState>
            ) : initialCwdStatus === "error" ? (
              <div
                role="alert"
                style={{
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  padding: 24,
                  color: "var(--text-muted)",
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: 14, color: "#dc2626" }}>
                  {translate("workspace.unable")}
                </div>
                <div
                  style={{
                    maxWidth: "min(720px, 100%)",
                    overflowWrap: "anywhere",
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                  }}
                >
                  {initialNavigation.requestedCwd}
                </div>
                <div style={{ maxWidth: 720, fontSize: 12 }}>
                  {initialCwdError}
                </div>
              </div>
            ) : showPlaceholder ? (
              activeCwd ? (
                <div
                  style={{
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 16,
                    color: "var(--text-muted)",
                    fontSize: 14,
                  }}
                >
                  {isStarfield && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 12,
                      }}
                    >
                      <StarfieldEmblem size={120} />
                      <div
                        style={{
                          fontFamily: "var(--font-display)",
                          fontSize: 13,
                          letterSpacing: "0.16em",
                          color: "#d99b26",
                          textTransform: "uppercase",
                        }}
                      >
                        {t("CONSTELLATION // READY", "星群 // 就绪")}
                      </div>
                    </div>
                  )}
                  <div>
                    {t(
                      "Select a session from the sidebar",
                      "请从侧边栏选择一个历史会话"
                    )}
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                    padding: 24,
                    userSelect: "none",
                    color: "var(--text-muted)",
                    fontSize: 13,
                  }}
                >
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      border: "2px solid var(--border)",
                      borderTopColor: "var(--accent)",
                      borderRadius: "50%",
                      animation: "omp-spin 0.8s linear infinite",
                    }}
                  />
                  <div>{t("Initializing…", "正在初始化…")}</div>
                </div>
              )
            ) : null}
          </div>
        </div>

        <div
          aria-hidden="true"
          className={`right-panel-overlay-backdrop${rightPanelOpen ? "is-open" : ""}`}
          onClick={() => setRightPanelOpen(false)}
        />
        {rightPanelOpen && (
          <div
            {...rightPanelResizer.separatorProps}
            aria-controls="file-panel"
            className={`panel-resize-handle right-panel-resize-handle${rightPanelResizer.isResizing ? "is-resizing" : ""}`}
            data-resize-handle="right-panel"
            title={`${translate("layout.resizeFilePanel")}: ${translate("layout.resizeHint")}`}
          />
        )}

        {/* Right panel: file viewer — always mounted, width animated via CSS */}
        <div
          ref={rightPanelResizer.panelRef}
          id="file-panel"
          className={`right-panel-container${rightPanelOpen ? "right-panel-open" : "right-panel-closed"}${rightPanelResizer.isResizing ? "right-panel-resizing" : ""}`}
          style={
            {
              "--right-panel-width": `${rightPanelResizer.width}px`,
              display: "flex",
              flexDirection: "column",
              borderLeft: "1px solid var(--border)",
              background: "var(--bg)",
            } as React.CSSProperties
          }
        >
          {/* Right panel tab bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              flexShrink: 0,
              height: "calc(36px + env(safe-area-inset-top))",
              paddingTop: "env(safe-area-inset-top)",
              background: "var(--bg-panel)",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <div style={{ flex: 1, overflow: "hidden" }}>
              <TabBar
                tabs={fileTabs}
                activeTabId={activeFileTabId ?? ""}
                onSelectTab={setActiveFileTabId}
                onCloseTab={handleCloseFileTab}
              />
            </div>
          </div>

          {/* File content */}
          <div
            style={{
              flex: 1,
              overflow: "hidden",
              paddingBottom: "env(safe-area-inset-bottom)",
            }}
          >
            {activeFileTab?.filePath ? (
              <FileViewer
                filePath={activeFileTab.filePath}
                cwd={activeCwd ?? undefined}
                sourceSessionId={activeFileTab.sourceSessionId}
                gitRefreshKey={explorerRefreshKey}
                initialDisplayMode={activeFileTab.initialDisplayMode}
                onMentionLines={
                  rightPanelOpen ? handleFileLineMention : undefined
                }
                onOpenFile={(filePath) =>
                  handleOpenFile(filePath, getFileName(filePath), {
                    sourceSessionId: activeFileTab.sourceSessionId,
                  })
                }
              />
            ) : (
              <div
                style={{
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--text-dim)",
                  fontSize: 12,
                }}
              >
                {translate("files.noneOpen")}
              </div>
            )}
          </div>
        </div>
      </div>
      {projectTrustDialogOpen && projectTrustCwd && (
        <ProjectTrustDialog
          cwd={projectTrustCwd}
          busy={projectTrustBusy}
          error={projectTrustError}
          onCancel={() => setProjectTrustDialogOpen(false)}
          onConfirm={handleTrustProject}
        />
      )}
    </>
  );
}
