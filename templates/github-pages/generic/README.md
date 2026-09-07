# Generic project hook

Used when a `package.json` has a `build` script but no recognized
framework config is found. Set `build.command` and `build.output`
explicitly in `.github/deployment.yml` if the defaults (`npm run build`,
`dist/`) don't match your project, and read `PAGES_BASE_PATH` from the
environment in your own build tooling if you need base-path awareness.
