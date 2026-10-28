#!/usr/bin/env bash
# 启动 Agentic LIMS 使用的 MongoDB（默认 127.0.0.1:27018）。
#
# 数据目录放在仓库内（.data/mongodb），因此在 DSH 文件沙箱里也能写入，
# 也不会和系统上已有的 MongoDB（通常占 27017）冲突。
#
# 优先使用本机 mongod；本机没有但装了 Docker 时，自动起一个容器。
#
# 可覆盖的环境变量：
#   AGENTIC_LIMS_MONGOD          mongod 可执行文件路径（不设则自动探测）
#   AGENTIC_LIMS_MONGO_DBPATH    数据目录（默认 <repo>/.data/mongodb）
#   AGENTIC_LIMS_MONGO_PORT      端口（默认 27018）
#   AGENTIC_LIMS_MONGO_LOGPATH   日志文件（默认 <repo>/.data/logs/mongod.log）
#   AGENTIC_LIMS_MONGO_IMAGE     Docker 镜像（默认 mongo:7）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DBPATH="${AGENTIC_LIMS_MONGO_DBPATH:-$ROOT/.data/mongodb}"
LOGPATH="${AGENTIC_LIMS_MONGO_LOGPATH:-$ROOT/.data/logs/mongod.log}"
PORT="${AGENTIC_LIMS_MONGO_PORT:-27018}"
IMAGE="${AGENTIC_LIMS_MONGO_IMAGE:-mongo:7}"
CONTAINER="agentic-lims-mongo"

# ---------------------------------------------------------------- 探测 mongod
find_mongod() {
  if [ -n "${AGENTIC_LIMS_MONGOD:-}" ] && [ -x "${AGENTIC_LIMS_MONGOD}" ]; then
    printf '%s' "$AGENTIC_LIMS_MONGOD"
    return 0
  fi
  if command -v mongod >/dev/null 2>&1; then
    command -v mongod
    return 0
  fi
  # Homebrew（Apple Silicon / Intel）、Linux 发行版、官方 tarball 的常见位置
  local candidate
  for candidate in \
    /opt/homebrew/opt/mongodb-community/bin/mongod \
    /opt/homebrew/opt/mongodb-community@8.0/bin/mongod \
    /opt/homebrew/opt/mongodb-community@7.0/bin/mongod \
    /usr/local/opt/mongodb-community/bin/mongod \
    /usr/local/opt/mongodb-community@8.0/bin/mongod \
    /usr/local/opt/mongodb-community@7.0/bin/mongod \
    /opt/homebrew/bin/mongod \
    /usr/local/bin/mongod \
    /usr/bin/mongod \
    /usr/local/mongodb/bin/mongod \
    /mongodb/bin/mongod; do
    if [ -x "$candidate" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

# ---------------------------------------------------------------- 就绪探测
# 有 mongosh/mongo 就用它 ping；没有就退化成 TCP 探测，不强求装 shell。
probe() {
  if command -v mongosh >/dev/null 2>&1; then
    mongosh --port "$PORT" --quiet --eval 'db.runCommand({ping:1})' >/dev/null 2>&1
  elif command -v mongo >/dev/null 2>&1; then
    mongo --port "$PORT" --quiet --eval 'db.runCommand({ping:1})' >/dev/null 2>&1
  else
    (exec 3<>"/dev/tcp/127.0.0.1/$PORT") >/dev/null 2>&1
  fi
}

wait_ready() {
  for _ in $(seq 1 60); do
    if probe; then
      echo "[agentic-lims] MongoDB 就绪：127.0.0.1:$PORT"
      return 0
    fi
    sleep 0.5
  done
  return 1
}

mkdir -p "$DBPATH" "$(dirname "$LOGPATH")"

if probe; then
  echo "[agentic-lims] MongoDB 已经在 127.0.0.1:$PORT 上运行，跳过启动"
  exit 0
fi

# ---------------------------------------------------------------- 本机 mongod
if MONGOD="$(find_mongod)"; then
  echo "[agentic-lims] 启动 $(basename "$MONGOD")（端口 $PORT，数据目录 $DBPATH）"
  "$MONGOD" --dbpath "$DBPATH" --port "$PORT" --bind_ip 127.0.0.1 --logpath "$LOGPATH" --fork >/dev/null
  if wait_ready; then
    exit 0
  fi
  echo "[agentic-lims] mongod 没能在 30 秒内就绪，日志：$LOGPATH" >&2
  tail -n 20 "$LOGPATH" >&2 || true
  exit 1
fi

# ---------------------------------------------------------------- Docker 兜底
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo "[agentic-lims] 本机没有 mongod，改用 Docker 容器 $CONTAINER（镜像 $IMAGE）"
  if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
    echo "[agentic-lims] 容器已存在，直接使用"
  else
    docker run -d --name "$CONTAINER" -p "127.0.0.1:$PORT:27017" \
      -v "$DBPATH:/data/db" "$IMAGE" >/dev/null
  fi
  if wait_ready; then
    exit 0
  fi
  echo "[agentic-lims] Docker 里的 MongoDB 没有就绪，看看：docker logs $CONTAINER" >&2
  exit 1
fi

cat >&2 <<EOF
[agentic-lims] 没有找到 mongod，也没有可用的 Docker。

请任选一种方式装一个 MongoDB 7 或 8，然后重新运行：

  macOS (Homebrew)
    brew tap mongodb/brew
    brew install mongodb-community

  Ubuntu / Debian
    sudo apt-get install -y mongodb-org

  Docker
    docker run -d --name $CONTAINER -p 127.0.0.1:$PORT:27017 $IMAGE

  Windows
    用 MongoDB 官方安装包，或跑上面的 Docker 命令。

已经装在非标准路径时，指定路径即可：

  AGENTIC_LIMS_MONGOD=/path/to/mongod ./agentic-lims/scripts/start-mongo.sh
EOF
exit 1
