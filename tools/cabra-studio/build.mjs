// Bundles Cabra Studio into one self-contained HTML file (the Artifact):
//   node tools/cabra-studio/build.mjs  →  tools/cabra-studio/dist/cabra-studio.html
// The studio imports the game's own engine from src/cabra, so the preview is the real thing.
import { build } from "esbuild";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = await build({
  entryPoints: [join(here, "studio.ts")],
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: true,
  write: false,
  legalComments: "none",
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
// The dev page carries a charset meta for Vite; the Artifact wrapper supplies its own head.
const html = readFileSync(join(here, "index.html"), "utf8").replace(/^<meta charset="utf-8">\n/, "");
const tag = '<script type="module" src="./studio.ts"></script>';
if (!html.includes(tag)) throw new Error("studio script tag not found in index.html");
mkdirSync(join(here, "dist"), { recursive: true });
const file = join(here, "dist", "cabra-studio.html");
writeFileSync(file, html.replace(tag, () => `<script>\n${js}</script>`));
console.log(`wrote ${file} (${(Buffer.byteLength(html) / 1024 + js.length / 1024).toFixed(0)} KB)`);
