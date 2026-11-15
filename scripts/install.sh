#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
# Run from an extracted release. Supports fresh Ubuntu 22.04/24.04 amd64 VPSs.
TASK_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PANEL_DOMAIN='' MEDIA_DOMAIN='' INGEST_DOMAIN='' ACME_EMAIL='' TLS_MODE='direct' CERT_PATH='' KEY_PATH='' DRY_RUN=0
usage(){ cat <<'TXT'
OpenMediaCP · VPS installer
  sudo bash scripts/install.sh --panel panel.example.com --media media.example.com \
    --ingest ingest.example.com --email admin@example.com [--tls direct|cloudflare]
  Cloudflare origin certificate: add --cert /path/origin.pem --key /path/origin.key
  --dry-run prints the plan without changing the host.
TXT
}
while (($#));do
 case "$1" in
  --panel) PANEL_DOMAIN="${2:?Missing domain}";shift 2;;
  --media) MEDIA_DOMAIN="${2:?Missing domain}";shift 2;;
  --ingest) INGEST_DOMAIN="${2:?Missing domain}";shift 2;;
  --email) ACME_EMAIL="${2:?Missing email}";shift 2;;
  --tls) TLS_MODE="${2:?Missing TLS mode}";shift 2;;
  --cert) CERT_PATH="${2:?Missing certificate path}";shift 2;;
  --key) KEY_PATH="${2:?Missing key path}";shift 2;;
  --dry-run) DRY_RUN=1;shift;;
  --help|-h) usage;exit 0;;
  *) usage;exit 1;;
 esac
done
for domain in "$PANEL_DOMAIN" "$MEDIA_DOMAIN" "$INGEST_DOMAIN";do
 [[ ${#domain} -le 253 && "$domain" =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$ ]]||{ echo 'Use valid lowercase fully qualified domains.' >&2;exit 1;}
done
[[ "$PANEL_DOMAIN" != "$MEDIA_DOMAIN" && "$PANEL_DOMAIN" != "$INGEST_DOMAIN" && "$MEDIA_DOMAIN" != "$INGEST_DOMAIN" ]]||{ echo 'Use three different subdomains.' >&2;exit 1; }
[[ "$ACME_EMAIL" =~ ^[a-zA-Z0-9._+%-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]]||{ echo 'A valid ACME email is required.' >&2;exit 1; }
[[ "$TLS_MODE" == direct || "$TLS_MODE" == cloudflare ]]||exit 1
if [[ "$TLS_MODE" == cloudflare ]];then [[ -r "$CERT_PATH" && -r "$KEY_PATH" ]]||{ echo 'Cloudflare mode requires readable Origin CA certificate and private key.' >&2;exit 1; };fi
printf 'Install in: %s\nPanel: https://%s\nMedia: https://%s\nRTMP ingress: %s:1935 (DNS only)\nTLS mode: %s\n' "$TASK_ROOT" "$PANEL_DOMAIN" "$MEDIA_DOMAIN" "$INGEST_DOMAIN" "$TLS_MODE"
echo 'Plan: official Docker packages if absent, pinned image digests, application build, vulnerability scans, persistent data, administrator bootstrap, HTTPS proxy.'
if ((DRY_RUN));then exit 0;fi
[[ $EUID == 0 ]]||{ echo 'Run with sudo.' >&2;exit 1; }
[[ "$(uname -m)" == x86_64 ]]||{ echo 'This release supports amd64 only.' >&2;exit 1; }
source /etc/os-release
[[ "$ID" == ubuntu && ( "$VERSION_ID" == 22.04 || "$VERSION_ID" == 24.04 ) ]]||{ echo 'Supported host: Ubuntu 22.04/24.04 amd64.' >&2;exit 1; }
cd "$TASK_ROOT"
[[ ! -f .env ]]||{ echo 'An installation configuration already exists. Follow the upgrade guide; no data was overwritten.' >&2;exit 1; }
trap 'echo "Installation stopped. Existing data was preserved. Review the last error before retrying." >&2' ERR
if ! command -v docker >/dev/null;then
 if dpkg-query -W -f='${Status}' docker.io 2>/dev/null | grep -q 'install ok installed';then echo 'Existing distribution Docker detected. Install the official Compose plugin before proceeding.' >&2;exit 1;fi
 apt-get update
 apt-get install -y ca-certificates curl gnupg openssl python3
 install -m 0755 -d /etc/apt/keyrings
 curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
 chmod a+r /etc/apt/keyrings/docker.asc
 cat > /etc/apt/sources.list.d/docker.sources <<APT
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME:-$VERSION_CODENAME}
Components: stable
Architectures: amd64
Signed-By: /etc/apt/keyrings/docker.asc
APT
 apt-get update
 apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
else
 apt-get update
 apt-get install -y openssl python3 ca-certificates curl
fi
docker compose version >/dev/null
systemctl enable --now docker
# Resolve mutable release tags once and retain exact registry digests.
pin_image(){ docker pull "$1" >&2;docker image inspect --format '{{index .RepoDigests 0}}' "$1"; }
NODE_IMAGE="$(pin_image node:24-alpine)"
OME_IMAGE="$(pin_image ovenmedialabs/ovenmediaengine:v0.21.0)"
CADDY_IMAGE="$(pin_image caddy:2)"
TRIVY_IMAGE="$(pin_image aquasec/trivy:0.76.1)"
OME_API_TOKEN="$(openssl rand -hex 32)"
OME_ADMISSION_SECRET="$(openssl rand -hex 32)"
PROXY_SECRET="$(openssl rand -hex 32)"
OME_WORKER_SECRET="$(openssl rand -hex 32)"
cat > .env <<VARS
PANEL_DOMAIN=$PANEL_DOMAIN
MEDIA_DOMAIN=$MEDIA_DOMAIN
INGEST_DOMAIN=$INGEST_DOMAIN
ACME_EMAIL=$ACME_EMAIL
TLS_MODE=$TLS_MODE
NODE_IMAGE=$NODE_IMAGE
OME_IMAGE=$OME_IMAGE
CADDY_IMAGE=$CADDY_IMAGE
TRIVY_IMAGE=$TRIVY_IMAGE
OME_API_TOKEN=$OME_API_TOKEN
OME_ADMISSION_SECRET=$OME_ADMISSION_SECRET
PROXY_SECRET=$PROXY_SECRET
OME_WORKER_SECRET=$OME_WORKER_SECRET
VARS
chmod 600 .env
mkdir -p deploy/certs
if [[ "$TLS_MODE" == cloudflare ]];then
 openssl x509 -in "$CERT_PATH" -noout -checkend 2592000 >/dev/null
 for domain in "$PANEL_DOMAIN" "$MEDIA_DOMAIN";do openssl x509 -in "$CERT_PATH" -noout -checkhost "$domain" >/dev/null;done
 cert_pub="$(openssl x509 -in "$CERT_PATH" -pubkey -noout | openssl pkey -pubin -outform DER | openssl dgst -sha256)"
 key_pub="$(openssl pkey -in "$KEY_PATH" -pubout -outform DER | openssl dgst -sha256)"
 [[ "$cert_pub" == "$key_pub" ]]||{ echo 'Certificate and key do not match.' >&2;exit 1; }
 install -m 600 "$CERT_PATH" deploy/certs/origin.pem
 install -m 600 "$KEY_PATH" deploy/certs/origin.key
 # Add Origin CA TLS to both sites. No Flexible SSL or certificate verification bypass.
 python3 - <<'PY'
from pathlib import Path
p=Path('deploy/Caddyfile');s=p.read_text()
for host in ['PANEL_DOMAIN','MEDIA_DOMAIN']:
    marker='{$'+host+'} {'
    s=s.replace(marker,marker+'\n tls /certs/origin.pem /certs/origin.key')
p.write_text(s)
PY
fi
docker compose config --quiet
docker compose build --pull app ome
bash scripts/security-scan.sh
docker compose run --rm --no-deps --user root --cap-add CHOWN app sh -c 'node scripts/init-data.mjs && chown -R node:node /data'
read -r -p 'Superadministrator username: ' ADMIN_USERNAME < /dev/tty
read -r -s -p 'Password (15–128 characters): ' ADMIN_PASSWORD < /dev/tty;echo
read -r -s -p 'Confirm password: ' ADMIN_CONFIRM < /dev/tty;echo
[[ "$ADMIN_PASSWORD" == "$ADMIN_CONFIRM" ]]||{ echo 'Passwords do not match. No administrator created.' >&2;exit 1; }
printf '%s' "$ADMIN_PASSWORD" | docker compose run --rm -T --no-deps app node scripts/admin.mjs create "$ADMIN_USERNAME"
unset ADMIN_PASSWORD ADMIN_CONFIRM
# Validate the proxy configuration with its actual image before starting the stack.
docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose up -d --wait --wait-timeout 180
printf '\nInstalled. Sign in at https://%s/login\n' "$PANEL_DOMAIN"
echo 'Confirm DNS, TLS and live-to-fallback playback using docs/vps.md before serving viewers.'
echo 'At the provider firewall, allow 80/443 TCP and restrict 1935 TCP to encoder IPs. Docker-published ports can bypass UFW rules.'
