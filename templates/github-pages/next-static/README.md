# Next.js (static export) hook

Requires `output: "export"` in `next.config.js` — the CLI's framework
detection refuses to proceed otherwise, since a server-rendered Next.js app
cannot be hosted on GitHub Pages.

Set `basePath` from the same environment variable the generated workflow
exports:

```js
// next.config.js
/** @type {import('next').NextConfig} */
module.exports = {
  output: "export",
  basePath: process.env.PAGES_BASE_PATH?.replace(/\/$/, "") ?? "",
};
```

Build output is expected at `out/` (Next's default for `output: "export"`).
