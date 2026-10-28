#!/usr/bin/env bash
# Agentic LIMS 一键安装脚本。
#
#   curl -fsSL ... | bash   ← 不推荐，先读一遍再跑
#   git clone <repo> && cd dsh-agentic-lims && ./setup.sh
#
# 做的事情：本地 MongoDB → 插件依赖 → 演示数据 → 把插件装进 DSH profile。
# 每一步都可重复执行（幂等），失败会带原因退出。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$REPO_ROOT/agentic-lims"
PROFILE="${DSH_PROFILE:-web}"
SEED_MODE="reset"   # reset = 干净演示库；demo = 预置停机/测试计划/候选方案
DO_MONGO=1
DO_DEPS=1
DO_SEED=1
DO_PLUGIN=1

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '  \033[33m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }

usage() {
  cat <<EOF
用法: ./setup.sh [选项]

  --profile <name>  装进哪个 DSH profile（默认 web，也可用 DSH_PROFILE 指定）
  --demo            导入带停机事件/测试计划/候选方案的完整演示数据
  --skip-mongo      不启动 MongoDB（已有实例时用）
  --skip-deps       不检查 node_modules
  --skip-seed       不导入演示数据
  --skip-plugin     只准备数据，不往 DSH 里装插件
  -h, --help        显示这段帮助
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="${2:?--profile 需要一个名字}"; shift 2 ;;
    --profile=*) PROFILE="${1#*=}"; shift ;;
    --demo) SEED_MODE="demo"; shift ;;
    --skip-mongo) DO_MONGO=0; shift ;;
    --skip-deps) DO_DEPS=0; shift ;;
    --skip-seed) DO_SEED=0; shift ;;
    --skip-plugin) DO_PLUGIN=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "未知参数：$1（用 --help 看用法）" ;;
  esac
done

printf '\033[1mAgentic LIMS · 安装脚本\033[0m\n'
info "仓库目录  $REPO_ROOT"
info "插件目录  $PLUGIN_DIR"
info "DSH profile  $PROFILE"

# ---------------------------------------------------------------- 0. 前置检查
bold "[0/4] 检查前置条件"

command -v node >/dev/null 2>&1 || fail "没有找到 node。先装 Node.js 20 或更高版本：https://nodejs.org"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || fail "Node.js 版本过低（当前 $(node -v)），需要 20 或更高"
ok "node $(node -v)"

command -v npm >/dev/null 2>&1 || fail "没有找到 npm（通常随 Node.js 一起安装）"
ok "npm $(npm -v)"

command -v pnpm >/dev/null 2>&1 || warn "没有找到 pnpm；DSH 的插件安装命令要转发给 pnpm，请先 npm i -g pnpm"
[ -f "$PLUGIN_DIR/package.json" ] || fail "插件目录不完整：$PLUGIN_DIR/package.json 不存在"

# ---------------------------------------------------------------- 1. MongoDB
if [ "$DO_MONGO" -eq 1 ]; then
  bold "[1/4] 准备 MongoDB"
  bash "$PLUGIN_DIR/scripts/start-mongo.sh"
else
  bold "[1/4] 跳过 MongoDB（--skip-mongo）"
fi

# ---------------------------------------------------------------- 2. 依赖
if [ "$DO_DEPS" -eq 1 ]; then
  bold "[2/4] 检查插件依赖"
  if [ -d "$PLUGIN_DIR/node_modules/mongodb" ]; then
    ok "依赖已就绪（node_modules/mongodb）"
  else
    info "安装依赖（只有一个 mongodb 驱动，通常几秒）"
    ( cd "$PLUGIN_DIR" && npm install --omit=dev --no-audit --no-fund ) || fail "npm install 失败"
    ok "依赖安装完成"
  fi
else
  bold "[2/4] 跳过依赖检查（--skip-deps）"
fi

# ---------------------------------------------------------------- 3. 演示数据
if [ "$DO_SEED" -eq 1 ]; then
  bold "[3/4] 导入演示数据"
  if [ "$SEED_MODE" = "demo" ]; then
    info "导入完整演示数据（含停机事件、测试计划、候选方案）"
    ( cd "$PLUGIN_DIR" && node scripts/reseed-demo.mjs ) || fail "演示数据导入失败"
  else
    info "导入干净的演示数据（从「零方案」开始）"
    ( cd "$PLUGIN_DIR" && node scripts/reset-demo-data.mjs ) || fail "演示数据导入失败"
  fi
  ok "数据已写入 MongoDB"
else
  bold "[3/4] 跳过数据导入（--skip-seed）"
fi

# ---------------------------------------------------------------- 4. 装插件
if [ "$DO_PLUGIN" -eq 1 ]; then
  bold "[4/4] 把插件装进 DSH"

  DSH_CMD=()
  if [ -n "${DSH_BIN:-}" ] && [ -x "${DSH_BIN}" ]; then
    DSH_CMD=("$DSH_BIN")
  elif command -v dsh >/dev/null 2>&1; then
    DSH_CMD=("$(command -v dsh)")
  elif [ -x "$REPO_ROOT/node_modules/.bin/dsh" ]; then
    DSH_CMD=("$REPO_ROOT/node_modules/.bin/dsh")
  fi

  if [ "${#DSH_CMD[@]}" -eq 0 ]; then
    warn "没有找到 dsh 命令，跳过自动安装。改用下面任一方式："
    cat <<EOF

    a) 让 dsh 在 PATH 里，再重跑本脚本：
         npm install -g @deepseek-ai/dsh

    b) 在 DSH 会话里让 Agent 执行：
         plugin_manager install_bundle { "target": "$PLUGIN_DIR" }

    c) 手动把 bundle 加进 profile（等价于 dsh plugin 做的事）：
         cd "\$DSH_HOME/profiles/$PROFILE"
         pnpm add "$PLUGIN_DIR"
         然后把 "$PLUGIN_DIR" 对应的包名追加进 package.json 的 dsh.profile.bundles

EOF
  else
    info "执行：${DSH_CMD[*]} plugin --profile $PROFILE add $PLUGIN_DIR"
    "${DSH_CMD[@]}" plugin --profile "$PROFILE" add "$PLUGIN_DIR" \
      || fail "插件安装失败；上面的 pnpm 输出里通常能看到原因"
    ok "已装入 profile「$PROFILE」"
  fi
else
  bold "[4/4] 跳过插件安装（--skip-plugin）"
fi

# ---------------------------------------------------------------- 收尾
bold "完成"
cat <<EOF
  重启 DSH Web（如果正在跑）：
      dsh web            # 或你平时用的启动命令 / npx @deepseek-ai/dsh web
  然后打开 http://127.0.0.1:3080 ，刷新页面。
  右侧边栏会出现「智能实验室 / Agentic LIMS」tab（找不到就点聊天标题栏右侧的烧瓶图标）。

  想再跑一次干净演示：   ./setup.sh --skip-plugin
  想清空所有方案重来：   node agentic-lims/scripts/reset-demo-data.mjs
  想换成完整演示数据：   ./setup.sh --demo --skip-plugin
EOF
