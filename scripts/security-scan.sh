#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
SCAN_ENV="${1:-.env}"
[[ "$SCAN_ENV" == .env || "$SCAN_ENV" == .env.local-docker ]]||exit 1
[[ -f "$SCAN_ENV" ]]||{ echo 'Missing environment configuration' >&2;exit 1; }
set -a;source "$SCAN_ENV";set +a
TRIVY_IMAGE="${TRIVY_IMAGE:-aquasec/trivy:0.76.1}"
mkdir -p reports
TASK_SCAN_DIR="$(mktemp -d)"
trap 'rm -rf -- "$TASK_SCAN_DIR"' EXIT
status=0
# Inspect exports without granting the scanner access to the Docker socket.
for service in app ome;do
 docker save "openmediacp-${service}:local" -o "$TASK_SCAN_DIR/image.tar"
 if ! docker run --rm --memory=1g -v "$TASK_SCAN_DIR:/scan:ro" -v openmediacp_trivy_cache:/root/.cache/ "$TRIVY_IMAGE" image --quiet --scanners vuln --parallel 1 --input /scan/image.tar --severity HIGH,CRITICAL --exit-code 1 --format json > "reports/${service}-vulnerabilities.json";then status=1;fi
 rm -f "$TASK_SCAN_DIR/image.tar"
done
if [[ "$SCAN_ENV" == .env ]];then
 if ! docker run --rm --memory=1g -v openmediacp_trivy_cache:/root/.cache/ "$TRIVY_IMAGE" image --quiet --scanners vuln --parallel 1 --image-src remote --severity HIGH,CRITICAL --exit-code 1 --format json "$CADDY_IMAGE" > reports/caddy-vulnerabilities.json;then status=1;fi
fi
if ((status));then echo 'Security gate failed. Review reports/ before deployment.' >&2;exit 1;fi
echo 'Image scans passed for the current vulnerability database. Review reports/ and rescan after updates.'
