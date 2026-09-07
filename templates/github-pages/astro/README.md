# Astro hook

Astro requires the base path in `astro.config.mjs` itself (it cannot be
overridden purely via CLI flag the way Vite's can). The generated workflow
exports `PAGES_BASE_PATH` (e.g. `/portfolio-a83f21/`) as an environment
variable during the build step — read it from your config:

```js
// astro.config.mjs
import { defineConfig } from "astro/config";

export default defineConfig({
  base: process.env.PAGES_BASE_PATH ?? "/",
});
```

Without this, asset URLs will 404 once deployed under
`https://OWNER.github.io/REPOSITORY/` (spec section 13).
