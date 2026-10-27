#!/usr/bin/env bash
# Start the local MongoDB used by the Agentic LIMS MVP.
# The data directory lives inside the workspace so the DSH file sandbox can write it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DBPATH="${AGENTIC_LIMS_MONGO_DBPATH:-$ROOT/.data/mongodb}"
LOGPATH="$ROOT/.data/logs/mongod.log"
PORT="${AGENTIC_LIMS_MONGO_PORT:-27018}"
MONGOD="${AGENTIC_LIMS_MONGOD:-/opt/homebrew/opt/mongodb-community@4.4/bin/mongod}"

mkdir -p "$DBPATH" "$(dirname "$LOGPATH")"

if mongosh --port "$PORT" --quiet --eval 'db.runCommand({ping:1})' >/dev/null 2>&1; then
  echo "MongoDB already running on 127.0.0.1:$PORT"
  exit 0
fi

"$MONGOD" --dbpath "$DBPATH" --port "$PORT" --bind_ip 127.0.0.1 --logpath "$LOGPATH" --fork
for _ in $(seq 1 30); do
  if mongosh --port "$PORT" --quiet --eval 'db.runCommand({ping:1})' >/dev/null 2>&1; then
    echo "MongoDB ready on 127.0.0.1:$PORT (dbpath: $DBPATH)"
    exit 0
  fi
  sleep 0.5
done

echo "MongoDB did not become ready; see $LOGPATH" >&2
exit 1
