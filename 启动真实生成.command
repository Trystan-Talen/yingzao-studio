#!/bin/zsh
# 真实模式独立入口；不播种演示数据，不自动生成或充值。
set -eu
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/Library/pnpm:${PATH:-/usr/bin:/bin:/usr/sbin:/sbin}"

TRAPZERR() {
  local exitCode=$?
  print -u2 -- '\n真实模式未能启动，请查看上方提示；已有数据与密钥配置不会被清空。'
  if [[ -t 0 ]]; then
    read -r '?按回车关闭此窗口…' || true
  fi
  return "$exitCode"
}

cd -- "${0:A:h}/platform"
command -v node >/dev/null 2>&1 || { print -u2 -- '请先安装 Node.js（运行环境）22.12+ 或24+。'; exit 1; }
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit((major === 22 && minor >= 12) || major >= 24 ? 0 : 1)' \
  || { print -u2 -- '当前运行环境版本不受支持，需要22.12+（22.x）或24+。'; exit 1; }
if [[ ! -f node_modules/tsx/dist/cli.mjs || ! -f node_modules/vite/bin/vite.js || ! -d node_modules/better-sqlite3 ]]; then
  print -u2 -- '项目依赖不完整。请先在 platform（应用目录）执行 pnpm install --frozen-lockfile（按锁定版本安装依赖）。'
  exit 1
fi

node --import tsx scripts/start-real.ts "$@"
