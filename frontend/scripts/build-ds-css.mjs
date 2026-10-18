// Compile the app's Tailwind stylesheet into plain CSS for the Claude Design sync.
// globals.css is Tailwind source (@import "tailwindcss", @theme, @utility), which the
// sync can't ship as-is. Output: frontend/.design-system/kadence.css (gitignored).
// Run from the repo root: node frontend/scripts/build-ds-css.mjs
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const from = resolve(frontend, "src/styles/globals.css");
const out = resolve(frontend, ".design-system/kadence.css");

// Also scan the authored preview cards so utilities used only there are generated.
const previews = resolve(frontend, "../.design-sync/previews");
const input = `${readFileSync(from, "utf8")}\n@source "${previews}";\n`;

const result = await postcss([tailwind({ base: frontend })]).process(input, { from, to: out });

// The app loads IBM Plex from Google Fonts in index.html; designs need the same faces.
const fonts = '@import url("https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap");\n';

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, fonts + result.css);
console.log(`wrote ${out} (${(result.css.length / 1024).toFixed(1)} KB)`);
