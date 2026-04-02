#!/usr/bin/env bash
set -euo pipefail

MODEL="${OPENCLAUDE_LOCAL_MODEL:-qwen2.5-coder:7b}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

info() {
  printf "[openclaude-bootstrap] %s\n" "$1"
}

warn() {
  printf "[openclaude-bootstrap] %s\n" "$1" >&2
}

usage() {
  cat <<'EOF'
Usage: bash scripts/bootstrap-local-web.sh [--help]

Bootstraps local browser UI mode:
- checks required tools
- verifies Ollama is running
- pulls local model if missing
- installs npm dependencies if needed
- launches http://localhost:8787

Optional env:
- OPENCLAUDE_LOCAL_MODEL (default: qwen2.5-coder:7b)
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    warn "Missing required command: $1"
    exit 1
  fi
}

need_cmd npm
need_cmd curl
need_cmd ollama

if ! curl -fsS "http://127.0.0.1:11434/api/tags" >/dev/null; then
  warn "Ollama is not running at http://127.0.0.1:11434"
  warn "Start Ollama first in another terminal: ollama serve"
  exit 1
fi

if ! ollama list | awk 'NR>1 {print $1}' | grep -Fxq "${MODEL}"; then
  info "Pulling Ollama model: ${MODEL}"
  ollama pull "${MODEL}"
else
  info "Model already available: ${MODEL}"
fi

cd "${ROOT_DIR}"

if [[ ! -d node_modules ]]; then
  info "Installing npm dependencies"
  npm install
else
  info "npm dependencies already installed"
fi

info "Launching local browser UI on http://localhost:8787"
OPENAI_MODEL="${MODEL}" npm run web:local
