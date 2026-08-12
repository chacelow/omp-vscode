"use client";

import { useCallback, useEffect, useState, type JSX } from "react";
import { hostCall } from "../../../bridge";
import { useI18n } from "@/hooks/useI18n";

type Provider = {
  id: string;
  name: string;
  supportsOAuth: boolean;
  localOnly?: boolean;
};

type AuthResponse = { success?: unknown; error?: unknown };

const FALLBACK_PROVIDERS: readonly Provider[] = [
  { id: "anthropic", name: "", supportsOAuth: true },
  { id: "openai", name: "", supportsOAuth: true },
  { id: "google", name: "", supportsOAuth: true },
  { id: "groq", name: "", supportsOAuth: false },
  { id: "xai", name: "", supportsOAuth: false },
  { id: "mistral", name: "", supportsOAuth: false },
  { id: "deepseek", name: "", supportsOAuth: false },
  { id: "ollama", name: "", supportsOAuth: false, localOnly: true },
  { id: "openrouter", name: "", supportsOAuth: false },
  { id: "together", name: "", supportsOAuth: false },
];

const buttonStyle = {
  padding: "5px 10px",
  border: "1px solid var(--vscode-button-border, var(--border))",
  borderRadius: 2,
  background: "var(--vscode-button-background, var(--accent))",
  color: "var(--vscode-button-foreground, var(--bg))",
  fontFamily: "var(--vscode-font-family)",
  fontSize: 12,
  cursor: "pointer",
} as const;

function parseProvider(value: unknown): Provider | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const id =
    typeof source.id === "string"
      ? source.id
      : typeof source.provider === "string"
        ? source.provider
        : null;
  if (!id) return null;
  return {
    id,
    name: typeof source.name === "string" ? source.name : id,
    supportsOAuth: source.supportsOAuth === true,
    localOnly: source.localOnly === true,
  };
}

function providerIds(values: unknown): Set<string> {
  if (!Array.isArray(values)) return new Set();
  const ids = new Set<string>();
  for (const value of values) {
    if (typeof value === "string") ids.add(value);
    else {
      const provider = parseProvider(value);
      if (provider) ids.add(provider.id);
    }
  }
  return ids;
}

function failed(result: AuthResponse): boolean {
  return result.success !== true;
}

export function AuthPanel(): JSX.Element {
  const { t } = useI18n();
  const [providers, setProviders] =
    useState<readonly Provider[]>(FALLBACK_PROVIDERS);
  const [loggedInIds, setLoggedInIds] = useState<Set<string>>(() => new Set());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const loadProviders = useCallback(async (): Promise<void> => {
    try {
      const [allResult, loggedInResult] = await Promise.all([
        hostCall("authAllProvidersList", {}),
        hostCall("authProvidersList", {}),
      ]);
      const known = allResult.providers.flatMap((value) => {
        const provider = parseProvider(value);
        return provider ? [provider] : [];
      });
      setProviders(known.length > 0 ? known : FALLBACK_PROVIDERS);
      setLoggedInIds(providerIds(loggedInResult.providers));
    } catch {
      setProviders(FALLBACK_PROVIDERS);
      setLoggedInIds(new Set());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const setMessage = (provider: string, message: string): void => {
    setMessages((previous) => ({ ...previous, [provider]: message }));
  };

  const signIn = async (provider: Provider): Promise<void> => {
    try {
      const result = (await hostCall("authLogin", {
        provider: provider.id,
        method: "oauth",
      } as never)) as AuthResponse;
      if (failed(result)) {
        setMessage(
          provider.id,
          t("auth.oauthNotAvailable", { provider: provider.id })
        );
        return;
      }
      setLoggedInIds((previous) => new Set(previous).add(provider.id));
      setMessage(provider.id, "Signed in.");
    } catch {
      setMessage(
        provider.id,
        t("auth.oauthNotAvailable", { provider: provider.id })
      );
    }
  };

  const saveApiKey = async (provider: Provider): Promise<void> => {
    const apiKey = apiKeys[provider.id] ?? "";
    if (!apiKey) {
      setMessage(provider.id, "Enter an API key before saving.");
      return;
    }
    try {
      const result = (await hostCall("authApiKeySet", {
        provider: provider.id,
        apiKey,
      } as never)) as AuthResponse;
      if (failed(result)) {
        setMessage(
          provider.id,
          t("auth.oauthNotAvailable", { provider: provider.id })
        );
        return;
      }
      setApiKeys((previous) => ({ ...previous, [provider.id]: "" }));
      setLoggedInIds((previous) => new Set(previous).add(provider.id));
      setMessage(provider.id, "API key saved.");
    } catch {
      setMessage(
        provider.id,
        t("auth.oauthNotAvailable", { provider: provider.id })
      );
    }
  };

  const signOut = async (provider: Provider): Promise<void> => {
    try {
      const result = await hostCall("authLogout", { provider: provider.id });
      if (!result.success) {
        setMessage(
          provider.id,
          "Unable to sign out from the VS Code extension."
        );
        return;
      }
      setLoggedInIds((previous) => {
        const next = new Set(previous);
        next.delete(provider.id);
        return next;
      });
      setMessage(provider.id, "Signed out.");
    } catch {
      setMessage(provider.id, "Unable to sign out from the VS Code extension.");
    }
  };

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        overflow: "auto",
        padding: 20,
        color: "var(--text)",
      }}
    >
      <p style={{ margin: "0 0 12px", color: "var(--text-dim)", fontSize: 12 }}>
        {t("auth.title")}
      </p>
      {loading ? (
        <p
          style={{ margin: "0 0 8px", color: "var(--text-dim)", fontSize: 12 }}
        >
          {t("common.loading")}
        </p>
      ) : null}
      <div>
        {providers.map((provider) => {
          const isLoggedIn = loggedInIds.has(provider.id);
          const isExpanded = expandedId === provider.id;
          const message = messages[provider.id];
          return (
            <section
              key={provider.id}
              style={{
                borderBottom:
                  "1px solid var(--vscode-settings-headerBorder, var(--border))",
              }}
            >
              <button
                type="button"
                aria-expanded={isExpanded}
                onClick={() =>
                  setExpandedId((previous) =>
                    previous === provider.id ? null : provider.id
                  )
                }
                style={{
                  display: "flex",
                  width: "100%",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "14px 0",
                  border: 0,
                  background: "transparent",
                  color: "inherit",
                  font: "inherit",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <span
                    style={{ display: "block", fontSize: 13, fontWeight: 600 }}
                  >
                    {provider.name || t("auth.provider." + provider.id)}
                  </span>
                  <span
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: 5,
                      marginTop: 3,
                    }}
                  >
                    <code style={{ color: "var(--text-dim)", fontSize: 10 }}>
                      {provider.id}
                    </code>
                    {provider.supportsOAuth ? (
                      <CapabilityChip label={t("auth.chip.oauth")} />
                    ) : null}
                    <CapabilityChip label={t("auth.chip.apiKey")} />
                    {provider.localOnly ? (
                      <CapabilityChip label={t("auth.chip.local")} />
                    ) : null}
                  </span>
                </span>
                <StatusPill loggedIn={isLoggedIn} t={t} />
              </button>
              {isExpanded ? (
                <div
                  style={{
                    padding: "12px 0 12px 16px",
                    borderLeft: "2px solid var(--accent)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 8,
                      alignItems: "end",
                    }}
                  >
                    {provider.supportsOAuth ? (
                      <button
                        type="button"
                        onClick={() => void signIn(provider)}
                        style={buttonStyle}
                      >
                        {t("auth.action.oauth")}
                      </button>
                    ) : null}
                    <label
                      style={{
                        display: "grid",
                        gap: 4,
                        minWidth: 220,
                        flex: "1 1 220px",
                        color: "var(--text-muted)",
                        fontSize: 12,
                      }}
                    >
                      {t("auth.chip.apiKey")}
                      <input
                        type="password"
                        placeholder={t("auth.action.apiKeyPlaceholder")}
                        value={apiKeys[provider.id] ?? ""}
                        onChange={(event) =>
                          setApiKeys((previous) => ({
                            ...previous,
                            [provider.id]: event.target.value,
                          }))
                        }
                        aria-label={`${provider.name || t("auth.provider." + provider.id)} ${t("auth.chip.apiKey")}`}
                        style={{
                          padding: "5px 8px",
                          border:
                            "1px solid var(--vscode-input-border, var(--border))",
                          borderRadius: 2,
                          background:
                            "var(--vscode-input-background, var(--bg))",
                          color: "var(--vscode-input-foreground, var(--text))",
                          fontFamily: "var(--vscode-font-family)",
                          fontSize: 12,
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => void saveApiKey(provider)}
                      style={buttonStyle}
                    >
                      {t("auth.action.apiKey")}
                    </button>
                    {isLoggedIn ? (
                      <button
                        type="button"
                        onClick={() => void signOut(provider)}
                        style={{
                          ...buttonStyle,
                          background: "transparent",
                          color: "var(--text)",
                        }}
                      >
                        {t("auth.action.signOut")}
                      </button>
                    ) : null}
                  </div>
                  {message ? (
                    <p
                      role="status"
                      style={{
                        margin: "10px 0 0",
                        color:
                          "var(--vscode-editorWarning-foreground, var(--text-muted))",
                        fontSize: 12,
                      }}
                    >
                      {message}
                    </p>
                  ) : null}
                  <p
                    style={{
                      margin: "10px 0 0",
                      color: "var(--text-dim)",
                      fontSize: 12,
                    }}
                  >
                    {t("auth.footer")}
                  </p>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
      <footer
        style={{
          marginTop: 18,
          paddingTop: 12,
          borderTop:
            "1px solid var(--vscode-settings-headerBorder, var(--border))",
          color: "var(--text-dim)",
          fontSize: 12,
          lineHeight: 1.5,
        }}
      >
        OAuth flows require the terminal today. When supported, this webview
        reads and writes <code>~/.omp/agent/auth.json</code> through OMP.
      </footer>
    </div>
  );
}

function CapabilityChip({ label }: { label: string }): JSX.Element {
  return (
    <span
      style={{
        padding: "1px 5px",
        border: "1px solid var(--border)",
        borderRadius: 8,
        color: "var(--text-muted)",
        fontSize: 10,
        lineHeight: 1.3,
      }}
    >
      {label}
    </span>
  );
}

function StatusPill({
  loggedIn,
  t,
}: {
  loggedIn: boolean;
  t: (key: string) => string;
}): JSX.Element {
  return (
    <span
      style={{
        flex: "0 0 auto",
        padding: "3px 7px",
        borderRadius: 10,
        background: loggedIn
          ? "var(--vscode-inputOption-activeBackground, var(--accent))"
          : "var(--vscode-badge-background, var(--bg-panel))",
        color: loggedIn
          ? "var(--vscode-inputOption-activeForeground, var(--text))"
          : "var(--vscode-badge-foreground, var(--text-muted))",
        fontSize: 11,
      }}
    >
      {t(loggedIn ? "auth.status.loggedIn" : "auth.status.loggedOut")}
    </span>
  );
}
