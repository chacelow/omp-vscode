"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import { useI18n } from "@/hooks/useI18n";
import { hostCall } from "../../bridge";
import {
  SETTINGS,
  SETTINGS_TABS,
  TAB_GROUPS,
  type SettingDef,
  type SettingsTabId,
} from "../lib/settings-registry";
import { THEMES, type OmpTheme } from "@/lib/themes";
import { speechModelsList } from "@/lib/ext-methods";
import { ModelRolesPanel } from "./settings/ModelRolesPanel";

export function applyTheme(theme: OmpTheme): void {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(theme.palette)) {
    if (value) root.style.setProperty(`--omp-theme-${name}`, value);
  }
  const palette = theme.palette;
  if (palette.accent) root.style.setProperty("--accent", palette.accent);
  if (palette.border) root.style.setProperty("--border", palette.border);
  if (palette.text) root.style.setProperty("--text", palette.text);
  if (palette.muted) root.style.setProperty("--text-muted", palette.muted);
  if (palette.dim) root.style.setProperty("--text-dim", palette.dim);
}

interface SettingsPanelProps {
  embedded?: boolean;
  onClose?: () => void;
  onQueueModeChange?: (mode: "all" | "one-at-a-time") => void;
}

type SelectOption = { value: string; label: string; description?: string };

const selectStyle = {
  width: "100%",
  maxWidth: 420,
  padding: "4px 8px",
  border: "1px solid var(--vscode-dropdown-border, var(--border))",
  borderRadius: 2,
  background: "var(--vscode-dropdown-background, var(--bg))",
  color: "var(--vscode-dropdown-foreground, var(--text))",
  fontFamily: "var(--vscode-font-family)",
  fontSize: 13,
  cursor: "pointer",
} as const;

const inputStyle = {
  width: "100%",
  maxWidth: 420,
  padding: "4px 8px",
  border: "1px solid var(--vscode-input-border, var(--border))",
  borderRadius: 2,
  background: "var(--vscode-input-background, var(--bg))",
  color: "var(--vscode-input-foreground, var(--text))",
  fontFamily: "var(--vscode-font-family)",
  fontSize: 13,
} as const;

export function evaluateCondition(
  name: string | undefined,
  values: Record<string, unknown>
): boolean {
  switch (name) {
    case "advisorEnabled":
      return values["advisor.enabled"] === true;
    case "mnemopiActive":
      return values["memory.backend"] === "mnemopi";
    case "hindsightActive":
      return values["memory.backend"] === "hindsight";
    case "autolearnActive":
      return values["autolearn.enabled"] === true;
    default:
      return true;
  }
}

function optionsFor(
  def: SettingDef,
  speechOptions: readonly SelectOption[]
): readonly SelectOption[] {
  if (def.path === "theme.dark" || def.path === "theme.light") {
    return THEMES.map((theme) => ({ value: theme.name, label: theme.name }));
  }
  if (def.path === "stt.modelName") return speechOptions;
  return "options" in def ? def.options : [];
}

// ---- i18n helpers ------------------------------------------------------
// Keys are auto-generated from settings-registry into `settings.<path>.label`
// / `.description` / `.option.<value>.<label|description>`. When a key is
// missing (community locales, runtime option lists), `t()` returns the key
// itself — we detect that and fall back to the registry's hardcoded English.

function safeOptionKey(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_");
}

function translateOr(
  t: (key: string) => string,
  key: string,
  fallback: string
): string {
  const value = t(key);
  return value === key ? fallback : value;
}

function translatedLabel(def: SettingDef, t: (key: string) => string): string {
  return translateOr(t, `settings.${def.path}.label`, def.label);
}

function translatedDescription(
  def: SettingDef,
  t: (key: string) => string
): string {
  return translateOr(t, `settings.${def.path}.description`, def.description);
}

function translatedOption(
  def: SettingDef,
  option: SelectOption,
  t: (key: string) => string
): SelectOption {
  const base = `settings.${def.path}.option.${safeOptionKey(option.value)}`;
  return {
    value: option.value,
    label: translateOr(t, `${base}.label`, option.label),
    description:
      option.description !== undefined
        ? translateOr(t, `${base}.description`, option.description)
        : undefined,
  };
}

// ---- VS Code-styled setting row ----------------------------------------
// Each row: id/label (bold), path (dim), description, then the control. All
// controls render inline — no click-to-expand.

function SettingCard({
  def,
  value,
  options,
  unavailable,
  onChange,
  onOpenModelRoles,
  compact,
  t,
}: {
  def: SettingDef;
  value: unknown;
  options: readonly SelectOption[];
  unavailable: boolean;
  onChange: (value: unknown) => void;
  onOpenModelRoles: ReactNode;
  compact: boolean;
  t: (key: string) => string;
}): JSX.Element {
  const label = translatedLabel(def, t);
  const path = def.path;
  const description = translatedDescription(def, t);

  const control = renderControl(
    def,
    value,
    options,
    unavailable,
    onChange,
    onOpenModelRoles,
    t
  );

  return (
    <section
      style={{
        display: "grid",
        gridTemplateColumns:
          compact || def.type === "modelRoles"
            ? "1fr"
            : "minmax(220px, 1fr) minmax(180px, 420px)",
        alignItems: "center",
        gap: compact ? 10 : 24,
        padding: "14px 0",
        borderBottom:
          "1px solid var(--vscode-settings-headerBorder, var(--border))",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <header style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
            {label}
          </span>
          <span
            style={{
              fontSize: 10,
              color: "var(--text-dim)",
              fontFamily: "var(--vscode-editor-font-family, ui-monospace)",
            }}
          >
            {path}
          </span>
        </header>
        {description ? (
          <p
            style={{
              margin: "3px 0 0",
              fontSize: 11,
              color: "var(--text-dim)",
              lineHeight: 1.45,
              textWrap: "pretty",
            }}
          >
            {description}
          </p>
        ) : null}
      </div>
      <div style={{ minWidth: 0 }}>{control}</div>
    </section>
  );
}

function renderControl(
  def: SettingDef,
  value: unknown,
  options: readonly SelectOption[],
  unavailable: boolean,
  onChange: (value: unknown) => void,
  modelRoles: ReactNode,
  t: (key: string) => string
): JSX.Element {
  if (def.type === "modelRoles") {
    return <div style={{ marginTop: 4 }}>{modelRoles}</div>;
  }
  if (def.type === "boolean") {
    return (
      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          fontSize: 13,
          color: "var(--text)",
          cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
          style={{
            width: 16,
            height: 16,
            accentColor:
              "var(--vscode-inputOption-activeBackground, var(--accent))",
          }}
        />
        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
          {value === true
            ? t("settings.boolean.enabled")
            : t("settings.boolean.disabled")}
        </span>
      </label>
    );
  }
  if (def.type === "text") {
    return (
      <input
        type={def.secret ? "password" : "text"}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onChange(event.target.value)}
        aria-label={def.label}
        style={inputStyle}
      />
    );
  }
  if (def.type === "multiselect") {
    const selected = Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : [];
    const move = (index: number, direction: -1 | 1): void => {
      const next = [...selected];
      [next[index], next[index + direction]] = [
        next[index + direction],
        next[index],
      ];
      onChange(next);
    };
    return (
      <div style={{ display: "grid", gap: 6, maxWidth: 480 }}>
        {def.options.map((option) => {
          const index = selected.indexOf(option.value);
          return (
            <div
              key={option.value}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 13,
              }}
            >
              {def.ordered ? (
                <span
                  style={{
                    width: 22,
                    color: "var(--text-dim)",
                    fontFamily:
                      "var(--vscode-editor-font-family, ui-monospace)",
                  }}
                >
                  {index >= 0 ? `${index + 1}.` : ""}
                </span>
              ) : null}
              <label
                style={{
                  flex: 1,
                  color: "var(--text)",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={index >= 0}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...selected, option.value]
                        : selected.filter((entry) => entry !== option.value)
                    )
                  }
                />
                <span>
                  {translateOr(
                    t,
                    `settings.${def.path}.option.${safeOptionKey(option.value)}.label`,
                    option.label
                  )}
                </span>
              </label>
              {def.ordered && index >= 0 ? (
                <>
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    style={{
                      padding: "0 6px",
                      border: "1px solid var(--border)",
                      background: "transparent",
                      color: "var(--text-muted)",
                      cursor: index === 0 ? "not-allowed" : "pointer",
                      borderRadius: 2,
                    }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={index === selected.length - 1}
                    onClick={() => move(index, 1)}
                    style={{
                      padding: "0 6px",
                      border: "1px solid var(--border)",
                      background: "transparent",
                      color: "var(--text-muted)",
                      cursor:
                        index === selected.length - 1
                          ? "not-allowed"
                          : "pointer",
                      borderRadius: 2,
                    }}
                  >
                    ↓
                  </button>
                </>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }
  // enum / submenu / number-choice → native <select>
  if (unavailable) {
    return (
      <select disabled style={selectStyle} aria-label={def.label}>
        <option>Speech models unavailable</option>
      </select>
    );
  }
  const currentValue = value == null ? "" : String(value);
  const translatedOptions = options.map((option) =>
    translatedOption(def, option, t)
  );
  const selectedOption = translatedOptions.find(
    (opt) => opt.value === currentValue
  );
  return (
    <div>
      <select
        aria-label={def.label}
        value={currentValue}
        onChange={(event) =>
          onChange(
            def.type === "number-choice"
              ? Number(event.target.value)
              : event.target.value
          )
        }
        style={selectStyle}
      >
        {options.length === 0 ? <option value="">(none)</option> : null}
        {translatedOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {selectedOption?.description ? (
        <p
          style={{
            margin: "6px 0 0",
            fontSize: 11,
            color: "var(--text-dim)",
            lineHeight: 1.4,
            maxWidth: 720,
          }}
        >
          {selectedOption.description}
        </p>
      ) : null}
    </div>
  );
}

export function SettingsPanel({
  embedded,
  onClose,
  onQueueModeChange,
}: SettingsPanelProps): JSX.Element {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<SettingsTabId>(
    SETTINGS_TABS[0].id
  );
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [speechOptions, setSpeechOptions] = useState<readonly SelectOption[]>(
    []
  );
  const [speechUnavailable, setSpeechUnavailable] = useState(false);
  const [cwd] = useState(
    () => document.getElementById("app")?.getAttribute("data-cwd") ?? ""
  );

  useEffect(() => {
    let mounted = true;
    void (
      hostCall("settingsList", {}) as Promise<{
        values: Record<string, unknown>;
      }>
    )
      .then((result) => {
        if (mounted) setValues(result.values ?? {});
      })
      .catch(() => {
        if (mounted) setValues({});
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (activeTab !== "interaction") return;
    let mounted = true;
    setSpeechUnavailable(false);
    void speechModelsList()
      .then((result) => {
        if (!mounted) return;
        const speechToText = result.speechToText;
        const models =
          speechToText &&
          typeof speechToText === "object" &&
          "models" in speechToText
            ? (speechToText as { models?: unknown }).models
            : [];
        setSpeechOptions(
          Array.isArray(models)
            ? models.flatMap((model): SelectOption[] => {
                if (!model || typeof model !== "object") return [];
                const option = model as {
                  value?: unknown;
                  label?: unknown;
                  description?: unknown;
                };
                if (typeof option.value !== "string") return [];
                return [
                  {
                    value: option.value,
                    label:
                      typeof option.label === "string"
                        ? option.label
                        : option.value,
                    description:
                      typeof option.description === "string"
                        ? option.description
                        : undefined,
                  },
                ];
              })
            : []
        );
      })
      .catch(() => {
        if (mounted) setSpeechUnavailable(true);
      });
    return () => {
      mounted = false;
    };
  }, [activeTab]);

  const saveValue = useCallback(
    (path: string, value: unknown) => {
      setValues((previous) => ({ ...previous, [path]: value }));
      if (
        path === "steeringMode" &&
        (value === "all" || value === "one-at-a-time")
      )
        onQueueModeChange?.(value);
      if (path === "theme.dark" || path === "theme.light") {
        const theme = THEMES.find((candidate) => candidate.name === value);
        if (theme) applyTheme(theme);
        localStorage.setItem("omp.theme", String(value));
        localStorage.setItem("omp.theme.name", String(value));
      }
      const [head, ...rest] = path.split(".");
      void hostCall("settingsSet", {
        category: rest.length === 0 ? "__root__" : head,
        key: rest.length === 0 ? head : rest.join("."),
        value,
      }).catch(() => undefined);
    },
    [onQueueModeChange]
  );

  const visibleSettings = useMemo(
    () =>
      SETTINGS.filter(
        (def) =>
          def.tab === activeTab && evaluateCondition(def.condition, values)
      ),
    [activeTab, values]
  );

  const groupedSections = useMemo(() => {
    const result: { group: string; defs: readonly SettingDef[] }[] = [];
    for (const group of TAB_GROUPS[activeTab]) {
      const defs = visibleSettings.filter((def) => def.group === group);
      if (defs.length > 0) result.push({ group, defs });
    }
    return result;
  }, [activeTab, visibleSettings]);

  const modelRoles = <ModelRolesPanel cwd={cwd} sessionId={null} />;
  const footerHint = t("workbench.footer.settings");

  const inner = (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        background: "var(--bg)",
      }}
    >
      <nav
        aria-label="Settings categories"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "10px 24px",
          overflowX: "auto",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        {SETTINGS_TABS.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => setActiveTab(tab.id)}
              style={{
                minHeight: 34,
                padding: "6px 10px",
                border: "none",
                borderRadius: 7,
                background: active ? "var(--bg-selected)" : "transparent",
                color: active ? "var(--text)" : "var(--text-muted)",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: active ? 600 : 400,
                whiteSpace: "nowrap",
                transition: "background-color 120ms ease, color 120ms ease",
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <div
          style={{
            padding: "8px clamp(16px, 4vw, 36px) 40px",
            maxWidth: 980,
            margin: "0 auto",
          }}
        >
          {activeTab === "appearance" ? (
            <div
              style={{
                margin: "12px 0 0",
                padding: "8px 12px",
                border:
                  "1px solid var(--vscode-inputValidation-warningBorder, var(--border))",
                borderRadius: 4,
                background:
                  "var(--vscode-inputValidation-warningBackground, var(--bg-panel))",
                color: "var(--text-muted)",
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              {t("settings.appearance.tuiNote")}
            </div>
          ) : null}
          {groupedSections.length === 0 ? (
            <p style={{ padding: 20, color: "var(--text-dim)", fontSize: 13 }}>
              {t("settings.emptyTab")}
            </p>
          ) : (
            groupedSections.map(({ group, defs }) => (
              <section key={group} style={{ marginTop: 24 }}>
                <h2
                  style={{
                    margin: "0",
                    paddingBottom: 8,
                    fontSize: 13,
                    fontWeight: 650,
                    color: "var(--text)",
                    borderBottom: "1px solid var(--border)",
                    textWrap: "balance",
                  }}
                >
                  {group}
                </h2>
                {defs.map((def) => {
                  const options = optionsFor(def, speechOptions);
                  const value =
                    values[def.path] ??
                    ("default" in def ? def.default : undefined);
                  return (
                    <SettingCard
                      key={def.path}
                      def={def}
                      value={value}
                      options={options}
                      unavailable={
                        def.path === "stt.modelName" && speechUnavailable
                      }
                      onChange={(next) => saveValue(def.path, next)}
                      onOpenModelRoles={modelRoles}
                      compact={false}
                      t={t}
                    />
                  );
                })}
              </section>
            ))
          )}
        </div>
      </div>
      <footer
        style={{
          padding: "7px 24px",
          borderTop: "1px solid var(--border)",
          color: "var(--text-dim)",
          fontSize: 10,
          flexShrink: 0,
        }}
      >
        {footerHint}
      </footer>
    </div>
  );

  if (embedded) return inner;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1200,
        background: "var(--vscode-widget-shadow, rgba(0,0,0,0.45))",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.();
      }}
    >
      <div
        style={{
          width: 960,
          maxWidth: "100%",
          height: "min(80vh, 780px)",
          position: "relative",
        }}
      >
        {inner}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close settings"
          style={{
            position: "absolute",
            top: 6,
            right: 8,
            width: 32,
            height: 28,
            border: "none",
            borderRadius: 4,
            background: "transparent",
            color: "var(--text-muted)",
            cursor: "pointer",
          }}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

export function SettingsSelector(props: SettingsPanelProps): JSX.Element {
  return <SettingsPanel {...props} />;
}
