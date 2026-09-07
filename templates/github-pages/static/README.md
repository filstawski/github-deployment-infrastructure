# Plain static site hook

No build step is run (`build.command` defaults to `true`, `build.output`
defaults to `.`). Use only relative asset paths in your HTML
(`./style.css`, not `/style.css`) so the site works correctly under a
project-page subpath like `https://OWNER.github.io/REPOSITORY/`.

A `404.html` fallback (a copy of `index.html`) is added automatically for
simple client-side routing.
