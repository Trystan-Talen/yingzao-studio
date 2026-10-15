#!/bin/zsh
# Finder 双击入口；与从终端运行共用同一套本机演示数据。
set -eu

export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/Library/pnpm:${PATH:-/usr/bin:/bin:/usr/sbin:/sbin}"
if ! command -v pnpm >/dev/null 2>&1; then
  export PATH="$PATH:$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback"
fi

servicePid=''
browserPid=''
autoOpen=1
appUrl='http://127.0.0.1:5174'

cleanup() {
  trap '' INT TERM HUP
  if [[ -n "$browserPid" ]]; then
    kill -TERM "$browserPid" 2>/dev/null || true
    wait "$browserPid" 2>/dev/null || true
  fi
  if [[ -n "$servicePid" ]]; then
    kill -TERM "$servicePid" 2>/dev/null || true
    wait "$servicePid" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 0' INT TERM HUP

TRAPZERR() {
  local exitCode=$?
  print -u2 -- '\n启动未完成，请查看上方错误信息。现有数据不会被清空。'
  if [[ -t 0 ]]; then
    read -r '?按回车关闭此窗口…' || true
  fi
  return "$exitCode"
}

fail() {
  print -u2 -- "$1"
  return 1
}

open_browser() {
  if (( autoOpen )); then
    /usr/bin/open "$appUrl" || print -- "请手动打开：$appUrl"
  fi
}

healthy() {
  local body
  body=$(/usr/bin/curl --noproxy '*' --fail --silent --max-time 2 "$1/api/v1/health") || return 1
  print -r -- "$body" | node -e '
    let input = "";
    process.stdin.on("data", chunk => input += chunk);
    process.stdin.on("end", () => {
      try {
        const { data } = JSON.parse(input);
        process.exit(data?.status === "ok" && data.database === "sqlite" && data.demoMode === true ? 0 : 1);
      } catch { process.exit(1); }
    });
  '
}

if [[ "${1:-}" == '--no-browser' ]]; then
  autoOpen=0
elif (( $# > 0 )); then
  fail '可直接双击启动，或从终端使用 --no-browser 启动而不打开浏览器。'
fi

cd -- "${0:A:h}/platform"
command -v node >/dev/null 2>&1 || fail '未找到 Node.js，请安装 Node.js 22.12+ 后重试。'
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit((major === 22 && minor >= 12) || major >= 24 ? 0 : 1)' \
  || fail "当前 Node.js $(node -v) 不受支持，需要 22.12+（22.x）或 24+。"

if healthy 'http://127.0.0.1:4310' && healthy "$appUrl"; then
  print -- "映造已在运行：$appUrl"
  open_browser
  exit 0
fi

for appPort in 4310 5174; do
  if /usr/sbin/lsof -nP -iTCP:"$appPort" -sTCP:LISTEN >/dev/null 2>&1; then
    /usr/sbin/lsof -nP -iTCP:"$appPort" -sTCP:LISTEN || true
    fail "端口 $appPort 已被占用，且映造尚未完整就绪。请稍后重试，或先关闭占用该端口的服务。"
  fi
done

export DEMO_MODE=true
export NODE_ENV=development
export HOST=127.0.0.1
export PORT=4310
export PUBLIC_ORIGIN="$appUrl"

if [[ ! -f node_modules/tsx/dist/cli.mjs || ! -f node_modules/vite/bin/vite.js || ! -d node_modules/better-sqlite3 ]]; then
  command -v pnpm >/dev/null 2>&1 || fail '未找到 pnpm，请安装 pnpm 11 后重试。'
  print -- '正在安装项目依赖，首次启动可能需要几分钟…'
  pnpm install --frozen-lockfile
fi

if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1; then
  print -- '未找到 FFmpeg/ffprobe，视频处理功能暂不可用；其余功能可正常启动。'
fi

node --import tsx scripts/seed-demo.ts
node --import tsx scripts/seed-demo-assets.ts
print -- "\n正在启动映造：$appUrl"
print -- '演示账号：demo@example.local'
print -- '演示密码：DemoStudio2026!'
print -- '请保持此窗口打开；按 Ctrl+C 或关闭此窗口停止本次启动的服务。'

# 直接使用已检查的 Node，确保 SQLite 原生模块与服务使用相同运行时。
node --import tsx scripts/dev.ts &
servicePid=$!
(
  for attempt in {1..60}; do
    kill -0 "$servicePid" 2>/dev/null || exit 0
    if healthy 'http://127.0.0.1:4310' && healthy "$appUrl"; then
      print -- "\n映造已就绪：$appUrl"
      open_browser
      exit 0
    fi
    sleep 1
  done
  print -- "服务尚未就绪，请查看上方日志；就绪后访问 $appUrl。"
) &
browserPid=$!
wait "$servicePid"
