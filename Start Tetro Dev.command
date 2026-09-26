#!/bin/zsh
cd -- "${0:A:h}" || exit 1
# Finder-launched terminals may not load the Node installation used by Codex.
if ! command -v node >/dev/null 2>&1; then
  export PATH="$HOME/.hermes/node/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
fi
if ! command -v node >/dev/null 2>&1; then
  print 'Node.js is required to run Tetro Dev. Install Node, then open this launcher again.'
  exit 1
fi
exec node frontend/scripts/dev-desktop.mjs
