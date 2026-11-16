#!/bin/zsh
# 本机已准备样例的独立入口；不重新导入数据，不自动生成或加积分。
set -eu
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/Library/pnpm:${PATH:-/usr/bin:/bin:/usr/sbin:/sbin}"
cd -- "${0:A:h}/platform"
command -v node >/dev/null 2>&1 || { print -u2 -- '请先安装 Node.js（运行环境）22.12+ 或24+。'; exit 1; }
if [[ ! -f var/comparison-lab/launch.mjs ]]; then
  print -u2 -- '尚未准备本机独立对比数据；请按 design-assets/comparison-fixtures/README.md（样例说明）完成备份恢复和导入。'
  exit 1
fi
node var/comparison-lab/launch.mjs "$@"
