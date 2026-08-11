// Build script:
//   - extension host code  → dist/extension.js  (CJS, external: vscode)
//   - webview React app    → dist/webview.js    (IIFE, browser)
//   - webview CSS (Tailwind v4) → dist/webview.css
const esbuild = require("esbuild");
const { execSync } = require("child_process");
const path = require("path");

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

const common = {
  logLevel: "info",
  // Keep sourcemaps for debugging, but always minify: the webview bundle is
  // ~12MB unminified and takes several seconds to load in VS Code.
  sourcemap: true,
  minify: true,
  bundle: true,
  target: ["es2022"],
};

function buildCss() {
  console.log("[css] compiling webview.css with Tailwind v4…");
  execSync(
    `pnpm exec tailwindcss -i src/ui/webview.css -o dist/webview.css ${production ? "--minify" : ""}`,
    { cwd: __dirname, stdio: "inherit" },
  );
}

async function main() {
  const ctx = await esbuild.context({
    ...common,
    entryPoints: [path.join(__dirname, "src/extension.ts")],
    outfile: path.join(__dirname, "dist/extension.js"),
    format: "cjs",
    platform: "node",
    // ESM deps (e.g. @earendil-works/pi-coding-agent) reference
    // `import.meta.url`; esbuild stubs it as `{}` in CJS output, so a top-
    // level `fileURLToPath(import.meta.url)` throws at activate time. Inject
    // a CJS-safe shim via the banner and route `import.meta.url` to it.
    banner: {
      js: "var __ompImportMetaUrl=require('url').pathToFileURL(__filename).href;",
    },
    define: {
      "import.meta.url": "__ompImportMetaUrl",
    },
    // better-sqlite3 is a native addon — it cannot be bundled; it must be
    // resolved from node_modules at runtime.
    external: ["vscode", "better-sqlite3"],
  });

  const webviewCtx = await esbuild.context({
    ...common,
    entryPoints: [path.join(__dirname, "src/ui/main.tsx")],
    outfile: path.join(__dirname, "dist/webview.js"),
    format: "iife",
    platform: "browser",
    alias: {
      "@": path.join(__dirname, "src/ui/omp"),
      "next/navigation": path.join(__dirname, "src/ui/shims/next-navigation.ts"),
      os: path.join(__dirname, "src/ui/shims/os.ts"),
      path: path.join(__dirname, "src/ui/shims/path.ts"),
    },
    // mermaid + syntax highlighter pull in node builtins; stub them.
    define: { "process.env.NODE_ENV": production ? '"production"' : '"development"' },
  });

  if (watch) {
    await Promise.all([ctx.watch(), webviewCtx.watch()]);
    // Tailwind CSS is rebuilt by the npm watch task via a separate watcher;
    // for simplicity, rebuild once at start in watch mode too.
    buildCss();
    console.log("watching…");
  } else {
    await Promise.all([ctx.rebuild(), webviewCtx.rebuild()]);
    await Promise.all([ctx.dispose(), webviewCtx.dispose()]);
    buildCss();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
