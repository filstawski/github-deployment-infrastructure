# Vite hook

No changes are usually required. The generated workflow automatically runs:

```bash
npm run build -- --base="$PAGES_BASE_PATH"
```

where `PAGES_BASE_PATH` is `/<deployment-repository-name>/`. Vite's `--base`
CLI flag overrides `base` from `vite.config.*` for the duration of that
build, so your own config does not need to hard-code a base path.

If your `build` script does not forward extra arguments to `vite build`
(for example it runs a wrapper script), set `build.command` explicitly in
`.github/deployment.yml` and read `process.env.PAGES_BASE_PATH` yourself.
