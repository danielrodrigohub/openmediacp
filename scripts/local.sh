#!/usr/bin/env bash
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
ACTION="${1:-status}"
# Use the caller's active Docker context; override with DOCKER_CONTEXT if needed.
COMPOSE=(docker compose --env-file .env.local-docker -f compose.local.yaml)
case "$ACTION" in
 prepare) node scripts/local-prepare.mjs;;
 build) node scripts/local-prepare.mjs;"${COMPOSE[@]}" build app ome;;
 init) "${COMPOSE[@]}" run --rm --no-deps --user root --cap-add CHOWN app sh -c 'node scripts/init-data.mjs && chown -R node:node /data';"${COMPOSE[@]}" run --rm -T --no-deps app node scripts/local-bootstrap.mjs;;
 up) "${COMPOSE[@]}" up -d --wait --wait-timeout 120;;
 stop) "${COMPOSE[@]}" stop;;
 status) "${COMPOSE[@]}" ps;;
 logs) "${COMPOSE[@]}" logs --tail=80 app ome;;
 *) echo 'Usage: scripts/local.sh prepare|build|init|up|stop|status|logs' >&2;exit 1;;
esac
