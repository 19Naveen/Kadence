# Design sync notes (Kadence)

## Setup specific to this repo
- Kadence's frontend is an app, not a published library: there is no `dist/` or `.d.ts` build. The sync
  bundles a barrel entry, `frontend/src/design-system/index.ts`, and lists components explicitly in
  `componentSrcMap`. Add a component there AND in the barrel to sync it.
- Prop contracts don't extract (no compiled declarations), so every component's props are hand-written in
  `dtsPropsFor`. Changing a component's props means updating its `dtsPropsFor` entry too.
- `globals.css` is Tailwind 4 source. `buildCmd` (`node frontend/scripts/build-ds-css.mjs`, run from the
  repo root) compiles it to `frontend/.design-system/kadence.css` (gitignored) — run it before
  `package-build.mjs`. It also scans `.design-sync/previews/` so utilities used only in previews compile.
- Only utilities the app (or previews) use are compiled; the conventions header tells the design agent to
  fall back to `hsl(var(--token))` inline styles. Tokens are HSL triplets, not colours.
- Fonts: IBM Plex Sans/Mono load from Google Fonts via a remote `@import` prepended by the CSS script
  (`[FONT_REMOTE]`, expected).
- `lucide-react` is merged into `window.Kadence` via `extraEntries` (icons the app uses everywhere); it is
  most of the ~1.5 MB bundle.
- `AuthCardLayout` is deliberately not synced: it renders a router `Link` (needs a Router provider) and is a
  sign-in page shell. `AppShell` is app chrome, not synced.
- Render check uses the system Chromium: `DS_CHROMIUM_PATH=/usr/bin/chromium` with the `playwright` library
  installed in `.ds-sync/` (`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`), no Playwright browser download.
- Shell quirk on this machine: `cd` is aliased to zoxide; use absolute paths or `builtin cd`.

## Known render warns
- `[FONT_REMOTE]` for IBM Plex — expected, fonts are served by Google Fonts.

## Re-sync risks
- `dtsPropsFor` is a hand copy of each component's props interface; it silently goes stale when props change.
- The compiled stylesheet only contains utilities used at build time; new utilities used by designs won't
  exist until they're used in the app or a preview and the CSS is rebuilt.
- The remote font `@import` depends on Google Fonts at render time.
- Previews compose real classes (`btn`, `field-label`, …); renaming a class in `globals.css` breaks them
  without a build error — re-run the render check and capture.
