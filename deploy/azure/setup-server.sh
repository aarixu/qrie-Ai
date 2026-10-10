#!/usr/bin/env bash
# QRIE: prepare a fresh Azure VM (Ubuntu Server 24.04 LTS) to serve the three
# web apps and run the nightly database backup. Run it as root, from the copy
# of deploy/azure on the VM. Running it again is safe: each step checks what
# is there first, or rewrites a file that only this script writes.
#
#   sudo bash ~/qrie-kit/setup-server.sh --admin-ip 203.0.113.7 --domain example.in
#
# Options (each can also be given as the environment variable in capitals):
#   --admin-ip ADDRESS     required. The only address (or range, such as
#                          203.0.113.0/24) the firewall lets reach SSH.
#   --domain DOMAIN        the domain whose teacher., app. and admin. names point
#                          at this VM. With it, the sites are written for port 80
#                          so Let's Encrypt can check the names (README.md).
#   --supabase-ref REF     the Supabase project the apps' CSP allows
#                          (default ueemqirxyrltdmqgnidy).
#   --pg-major N           the PostgreSQL client's major version (default 17:
#                          the project's server is 17.6, per supabase/.temp/
#                          postgres-version, which the Supabase CLI wrote).
#   --deploy-user NAME     the SSH user deploy-apps.ps1 signs in as (default qrie).
#   --allow-other-admin-ip go on although this SSH session comes from an address
#                          --admin-ip does not cover.
#
# README.md in this folder says what comes before this and after it.
set -euo pipefail

ADMIN_IP=${ADMIN_IP:-}
DOMAIN=${DOMAIN:-}
SUPABASE_REF=${SUPABASE_REF:-ueemqirxyrltdmqgnidy}
PG_MAJOR=${PG_MAJOR:-17}
DEPLOY_USER=${DEPLOY_USER:-qrie}
ALLOW_OTHER_ADMIN_IP=${ALLOW_OTHER_ADMIN_IP:-0}

die() { echo "setup-server: $*" >&2; exit 1; }
step() { echo; echo "== $*"; }

while [ $# -gt 0 ]; do
  case $1 in
    --admin-ip) ADMIN_IP=${2:?--admin-ip needs an address}; shift 2 ;;
    --domain) DOMAIN=${2:?--domain needs a domain}; shift 2 ;;
    --supabase-ref) SUPABASE_REF=${2:?--supabase-ref needs a project ref}; shift 2 ;;
    --pg-major) PG_MAJOR=${2:?--pg-major needs a number}; shift 2 ;;
    --deploy-user) DEPLOY_USER=${2:?--deploy-user needs a user name}; shift 2 ;;
    --allow-other-admin-ip) ALLOW_OTHER_ADMIN_IP=1; shift ;;
    -h | --help) awk 'NR > 1 && /^#/ { print; next } NR > 1 { exit }' "$0"; exit 0 ;;
    *) die "unknown option: $1 (--help lists them)" ;;
  esac
done

KIT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# ---------------------------------------------------------------------------
# Checks before anything changes.
# ---------------------------------------------------------------------------

[ "$(id -u)" -eq 0 ] || die "run it with sudo"
# shellcheck source=/dev/null
. /etc/os-release
[ "${ID:-}" = ubuntu ] && [ "${VERSION_ID:-}" = 24.04 ] ||
  die "written for Ubuntu 24.04; this is ${PRETTY_NAME:-an unknown system}"
command -v python3 >/dev/null || die "python3 is missing (Ubuntu 24.04 server images have it)"

[ -n "$ADMIN_IP" ] || die "--admin-ip is required: the address you SSH from (on the VM: echo \"\${SSH_CONNECTION%% *}\")"
python3 - "$ADMIN_IP" <<'PY' || die "--admin-ip must be one address or a range of at least /16 (IPv4) or /32 (IPv6), not: $ADMIN_IP"
import ipaddress, sys
net = ipaddress.ip_network(sys.argv[1], strict=False)
sys.exit(0 if net.prefixlen >= (16 if net.version == 4 else 32) else 1)
PY

if [ -n "$DOMAIN" ]; then
  DOMAIN=$(printf '%s' "$DOMAIN" | tr '[:upper:]' '[:lower:]')
  [[ $DOMAIN =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]] || die "--domain is not a domain name: $DOMAIN"
fi
[[ $SUPABASE_REF =~ ^[a-z0-9]{20}$ ]] || die "--supabase-ref must be the 20-character project ref, not: $SUPABASE_REF"
[[ $PG_MAJOR =~ ^[0-9]{2}$ ]] || die "--pg-major must be a major version such as 17, not: $PG_MAJOR"

id "$DEPLOY_USER" >/dev/null 2>&1 || die "there is no user $DEPLOY_USER on this VM (--deploy-user)"
DEPLOY_HOME=$(getent passwd "$DEPLOY_USER" | cut -d: -f6)
[ -s "$DEPLOY_HOME/.ssh/authorized_keys" ] ||
  die "$DEPLOY_USER has no key in $DEPLOY_HOME/.ssh/authorized_keys; switching SSH passwords off would shut everyone out"

# The firewall below lets only --admin-ip reach SSH. If this very session comes
# from somewhere else, enabling it would cut the session, so stop first.
session_ip=$(who -m 2>/dev/null | sed -n 's/.*(\([0-9A-Fa-f:.]*\))[[:space:]]*$/\1/p' || true)
if [ -n "$session_ip" ] && [ "$ALLOW_OTHER_ADMIN_IP" != 1 ]; then
  python3 - "$session_ip" "$ADMIN_IP" <<'PY' ||
import ipaddress, sys
sys.exit(0 if ipaddress.ip_address(sys.argv[1]) in ipaddress.ip_network(sys.argv[2], strict=False) else 1)
PY
    die "this SSH session comes from $session_ip, which --admin-ip $ADMIN_IP does not cover, so the firewall would shut you out. Run again with --admin-ip $session_ip, or add --allow-other-admin-ip if you are sure."
fi

export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a
apt_get() { apt-get -y -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold "$@"; }

# Installs a text file from the kit with any Windows line endings removed.
install_text() { # mode source destination
  local tmp
  tmp=$(mktemp)
  sed 's/\r$//' "$2" > "$tmp"
  install -m "$1" -o root -g root "$tmp" "$3"
  rm -f "$tmp"
}

# ---------------------------------------------------------------------------
step "Packages: update, upgrade, and what this VM needs"
# ---------------------------------------------------------------------------
apt_get update
apt_get upgrade
apt_get install ca-certificates curl gnupg ufw fail2ban python3-systemd unattended-upgrades \
  nginx certbot python3-certbot-nginx
# python3-certbot-nginx is there for running `certbot --nginx` by hand. The
# kit itself gets certificates with --webroot (README.md), so certbot never
# edits the nginx files qrie-render-sites writes.

# ---------------------------------------------------------------------------
step "Directories"
# ---------------------------------------------------------------------------
install -d -m 0700 -o root -g root /etc/qrie
install -d -m 0755 -o root -g root /var/www/qrie /var/www/letsencrypt /usr/local/share/qrie /usr/local/share/qrie/nginx
for site in teacher app admin; do
  install -d -m 0755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/var/www/qrie/$site" "/var/www/qrie/$site/releases"
done
install -d -m 0700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_HOME/qrie-upload"

# ---------------------------------------------------------------------------
step "Automatic security updates"
# ---------------------------------------------------------------------------
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
cat > /etc/apt/apt.conf.d/52qrie-unattended-upgrades <<'EOF'
// Written by deploy/azure/setup-server.sh.
// When an unattended upgrade leaves the VM needing a restart, it restarts at
// 03:30 India time: an hour after the nightly backup starts (02:30).
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "03:30";
EOF
systemctl enable --now unattended-upgrades

# ---------------------------------------------------------------------------
step "Time zone: Asia/Kolkata"
# ---------------------------------------------------------------------------
timedatectl set-timezone Asia/Kolkata
echo "clock synchronised: $(timedatectl show -p NTPSynchronized --value)"

# ---------------------------------------------------------------------------
step "Swap: 2 GB, unless some is already on"
# ---------------------------------------------------------------------------
if [ -n "$(swapon --show --noheadings)" ]; then
  echo "swap is already on:"
  swapon --show
else
  if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
  fi
  swapon /swapfile
  grep -qE '^/swapfile[[:space:]]' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ---------------------------------------------------------------------------
step "Firewall (ufw): SSH from $ADMIN_IP only, then 80 and 443"
# ---------------------------------------------------------------------------
# The SSH rule goes in before the firewall is switched on.
ufw default deny incoming
ufw default allow outgoing
ufw allow from "$ADMIN_IP" to any port 22 proto tcp comment 'qrie: ssh from the admin'
ufw allow 80/tcp comment 'qrie: http (lets encrypt checks, redirect)'
ufw allow 443/tcp comment 'qrie: https'
previous_ip=$(cat /etc/qrie/admin-ip 2>/dev/null || true)
if [ -n "$previous_ip" ] && [ "$previous_ip" != "$ADMIN_IP" ]; then
  ufw delete allow from "$previous_ip" to any port 22 proto tcp || true
fi
# Any SSH rule open to everyone, from an earlier setup by hand.
ufw delete allow OpenSSH >/dev/null 2>&1 || true
ufw delete allow 22/tcp >/dev/null 2>&1 || true
ufw delete allow 22 >/dev/null 2>&1 || true
echo "$ADMIN_IP" > /etc/qrie/admin-ip
ufw --force enable
ufw status verbose

# ---------------------------------------------------------------------------
step "fail2ban: the sshd jail"
# ---------------------------------------------------------------------------
cat > /etc/fail2ban/jail.d/qrie.local <<EOF
# Written by deploy/azure/setup-server.sh.
[sshd]
enabled = true
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
ignoreip = 127.0.0.1/8 ::1 $ADMIN_IP
EOF
systemctl enable fail2ban
systemctl restart fail2ban
jail_up=no
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if fail2ban-client status sshd >/dev/null 2>&1; then jail_up=yes; break; fi
  sleep 1
done
[ "$jail_up" = yes ] || die "fail2ban's sshd jail did not start: journalctl -u fail2ban"
fail2ban-client status sshd

# ---------------------------------------------------------------------------
step "sshd: keys only, no root"
# ---------------------------------------------------------------------------
# sshd keeps the first value it reads for an option, and its main file
# includes sshd_config.d/*.conf in name order before its own lines, so a
# file named 00-... decides these three.
SSHD_CONF=/etc/ssh/sshd_config.d/00-qrie-hardening.conf
had_conf=no
[ -f "$SSHD_CONF" ] && { cp -p "$SSHD_CONF" "$SSHD_CONF.before"; had_conf=yes; }
cat > "$SSHD_CONF" <<'EOF'
# Written by deploy/azure/setup-server.sh.
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
AuthenticationMethods publickey
EOF
chmod 0644 "$SSHD_CONF"
undo_sshd() {
  if [ "$had_conf" = yes ]; then mv -f "$SSHD_CONF.before" "$SSHD_CONF"; else rm -f "$SSHD_CONF"; fi
}
mkdir -p /run/sshd && chmod 0755 /run/sshd
if ! sshd -t; then
  undo_sshd
  die "sshd -t refused the new settings; they were taken out again and sshd was not reloaded"
fi
effective=$(sshd -T 2>/dev/null)
for want in 'passwordauthentication no' 'kbdinteractiveauthentication no' 'permitrootlogin no'; do
  if ! grep -qx "$want" <<< "$effective"; then
    undo_sshd
    die "after the change sshd still does not say '$want' (sshd -T); another file in /etc/ssh decides it. Nothing was reloaded."
  fi
done
rm -f "$SSHD_CONF.before"
systemctl reload ssh || systemctl restart ssh
echo "sshd: password and keyboard-interactive sign-in off, root sign-in off"

# ---------------------------------------------------------------------------
step "Node.js 22 (NodeSource), for the brain runner later"
# ---------------------------------------------------------------------------
if node --version 2>/dev/null | grep -q '^v22\.'; then
  echo "node $(node --version) is already here"
else
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key |
    gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt_get update
  apt_get install nodejs
fi
node --version | grep -q '^v22\.' || die "node is not version 22 after the install: $(node --version)"

# ---------------------------------------------------------------------------
step "PostgreSQL $PG_MAJOR client (PGDG), for pg_dump"
# ---------------------------------------------------------------------------
if [ -x "/usr/lib/postgresql/$PG_MAJOR/bin/pg_dump" ]; then
  echo "postgresql-client-$PG_MAJOR is already here"
else
  install -d -m 0755 /usr/share/postgresql-common/pgdg
  curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
  apt_get update
  apt_get install "postgresql-client-$PG_MAJOR"
fi
"/usr/lib/postgresql/$PG_MAJOR/bin/pg_dump" --version

# ---------------------------------------------------------------------------
step "azcopy (packages.microsoft.com)"
# ---------------------------------------------------------------------------
if command -v azcopy >/dev/null; then
  echo "azcopy is already here"
else
  tmp=$(mktemp -d)
  curl -fsSL -o "$tmp/packages-microsoft-prod.deb" "https://packages.microsoft.com/config/ubuntu/${VERSION_ID}/packages-microsoft-prod.deb"
  dpkg -i "$tmp/packages-microsoft-prod.deb"
  rm -rf "$tmp"
  apt_get update
  apt_get install azcopy
fi
azcopy --version

# ---------------------------------------------------------------------------
step "sudo: the two root commands a deploy runs"
# ---------------------------------------------------------------------------
tmp=$(mktemp)
cat > "$tmp" <<EOF
# Written by deploy/azure/setup-server.sh: what activate-release.sh (run by
# deploy-apps.ps1 as $DEPLOY_USER) needs as root, and nothing else.
$DEPLOY_USER ALL=(root) NOPASSWD: /usr/sbin/nginx -t, /usr/bin/systemctl reload nginx
EOF
visudo -cf "$tmp" >/dev/null || { rm -f "$tmp"; die "visudo refused the sudoers rule"; }
install -m 0440 -o root -g root "$tmp" /etc/sudoers.d/qrie-deploy
rm -f "$tmp"

# ---------------------------------------------------------------------------
step "nginx"
# ---------------------------------------------------------------------------
rm -f /etc/nginx/sites-enabled/default
cat > /etc/nginx/conf.d/qrie.conf <<'EOF'
# Written by deploy/azure/setup-server.sh. Ubuntu's nginx.conf leaves these
# three commented out; they are set here once for every site.
server_tokens off;
gzip_vary on;
gzip_types text/plain text/css application/javascript application/json image/svg+xml;
EOF
install_text 0644 "$KIT/nginx/site.conf.template" /usr/local/share/qrie/nginx/site.conf.template
install_text 0755 "$KIT/nginx/render-sites.sh" /usr/local/sbin/qrie-render-sites
systemctl enable nginx
if [ -n "$DOMAIN" ]; then
  /usr/local/sbin/qrie-render-sites --domain "$DOMAIN" --supabase-ref "$SUPABASE_REF"
else
  nginx -t
  systemctl reload-or-restart nginx
  echo "no --domain: the sites are not written yet (qrie-render-sites --domain <domain>)"
fi
if systemctl cat certbot.timer >/dev/null 2>&1; then
  systemctl enable --now certbot.timer
else
  echo "warning: certbot.timer is not installed, so certificates will not renew by themselves" >&2
fi

# ---------------------------------------------------------------------------
step "The nightly backup (qrie-backup.timer)"
# ---------------------------------------------------------------------------
install_text 0755 "$KIT/backup/qrie-backup.sh" /usr/local/sbin/qrie-backup
install_text 0644 "$KIT/backup/row-counts.sql" /usr/local/share/qrie/row-counts.sql
install_text 0644 "$KIT/backup/qrie-backup.service" /etc/systemd/system/qrie-backup.service
install_text 0644 "$KIT/backup/qrie-backup.timer" /etc/systemd/system/qrie-backup.timer
install_text 0600 "$KIT/backup/backup.env.example" /etc/qrie/backup.env.example
systemctl daemon-reload
if [ -f /etc/qrie/backup.env ]; then
  chown root:root /etc/qrie/backup.env
  chmod 0600 /etc/qrie/backup.env
  systemctl enable --now qrie-backup.timer
  systemctl list-timers qrie-backup.timer --no-pager
else
  echo "no /etc/qrie/backup.env yet, so the timer is not on (README.md, \"Backups\")"
fi

# ---------------------------------------------------------------------------
step "Done"
# ---------------------------------------------------------------------------
cat <<EOF
This VM now:
  - takes SSH from $ADMIN_IP only, with keys only, and no root sign-in;
  - allows 80 and 443 from anywhere;
  - serves /var/www/qrie/<site>/current over https once that site has its
    certificate and a release has been deployed.
Next (README.md): the Azure network security group, the certificates, the
Supabase settings, the first deploy from the laptop, and the backup settings.
EOF
