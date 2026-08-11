// Stubs for configuration surfaces the extension does not embed yet.
// Every handler returns the same shape the pre-migration configSurface did,
// keeping the webview's degraded-mode paths intact.

import type { Handler } from "./index";

export const skillsSearchHandler: Handler<"skillsSearch"> = () => ({
  results: [],
});
export const skillsInstallHandler: Handler<"skillsInstall"> = () => ({
  success: false,
  error: "Not supported in VS Code extension",
});
export const skillsCheckHandler: Handler<"skillsCheck"> = () => ({
  updates: [],
});
export const skillsUpdateHandler: Handler<"skillsUpdate"> = () => ({
  success: false,
  error: "Not supported in VS Code extension",
});
export const skillsPatchHandler: Handler<"skillsPatch"> = () => ({
  success: false,
  error: "Not supported in VS Code extension",
});

export const pluginsActionHandler: Handler<"pluginsAction"> = () => ({
  success: false,
  error: "Not supported in VS Code extension",
});

export const authProvidersListHandler: Handler<"authProvidersList"> = () => ({
  providers: [],
});
export const authAllProvidersListHandler: Handler<
  "authAllProvidersList"
> = () => ({ providers: [] });
export const authLoginHandler: Handler<"authLogin"> = () => ({
  success: false,
  error: "Not supported in VS Code extension",
});
export const authLogoutHandler: Handler<"authLogout"> = () => ({
  success: true,
});
export const authApiKeySetHandler: Handler<"authApiKeySet"> = () => ({
  success: false,
  error: "Not supported in VS Code extension",
});
export const authApiKeyDeleteHandler: Handler<"authApiKeyDelete"> = () => ({
  success: false,
  error: "Not supported in VS Code extension",
});
