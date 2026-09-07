import { defineConfig } from "vite";

// No base path is hard-coded here — the deploy workflow passes
// --base="$PAGES_BASE_PATH" at build time so this project works both
// locally (base "/") and as a GitHub Pages project site.
export default defineConfig({});
