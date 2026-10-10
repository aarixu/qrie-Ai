#!/usr/bin/env bash
# QRIE: write the nginx sites for the web apps from site.conf.template.
# setup-server.sh installs it as /usr/local/sbin/qrie-render-sites.
#
#   sudo qrie-render-sites --domain example.in
#
# Sites and where they are served:
#   teacher  teacher.<domain>  apps/lms      (teachers and the School Portal)
#   app      app.<domain>      apps/student  (students and parents)
#   admin    admin.<domain>    apps/admin    (the Super Admin console, admin branch)
#
# For each site it writes /etc/nginx/sites-available/qrie-<site>.conf (linked
# into sites-enabled) and /etc/nginx/snippets/qrie-<site>-headers.conf. A site
# gets its https server only when /etc/letsencrypt/live/<site>.<domain>/
# fullchain.pem exists; until then it has port 80 alone, where Let's Encrypt
# checks the name and every other request is sent to https. It also writes
# qrie-default.conf, which turns away any name that is not one of the sites.
# Then `nginx -t`, and a reload.
#
# Options:
#   --domain DOMAIN      required
#   --supabase-ref REF   the project the CSP lets the apps reach (default ueemqirxyrltdmqgnidy)
#   --sites "LIST"       which sites to write (default "teacher app admin")
#   --out DIR            write under DIR instead of /etc/nginx, and do not test
#                        or reload nginx (to read the result first)
#   --certs DIR          where certbot keeps certificates (default /etc/letsencrypt/live)
#   --template FILE      default: /usr/local/share/qrie/nginx/site.conf.template,
#                        else site.conf.template beside this script
set -euo pipefail
shopt -u patsub_replacement 2>/dev/null || true

DOMAIN=
SUPABASE_REF=ueemqirxyrltdmqgnidy
SITES="teacher app admin"
OUT=/etc/nginx
TOUCH_NGINX=yes
CERTS=/etc/letsencrypt/live
TEMPLATE=

die() { echo "qrie-render-sites: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case $1 in
    --domain) DOMAIN=${2:?--domain needs a domain}; shift 2 ;;
    --supabase-ref) SUPABASE_REF=${2:?--supabase-ref needs a project ref}; shift 2 ;;
    --sites) SITES=${2:?--sites needs a list}; shift 2 ;;
    --out) OUT=${2:?--out needs a directory}; TOUCH_NGINX=no; shift 2 ;;
    --certs) CERTS=${2:?--certs needs a directory}; shift 2 ;;
    --template) TEMPLATE=${2:?--template needs a file}; shift 2 ;;
    -h | --help) awk 'NR > 1 && /^#/ { print; next } NR > 1 { exit }' "$0"; exit 0 ;;
    *) die "unknown option: $1 (--help lists them)" ;;
  esac
done

DOMAIN=$(printf '%s' "$DOMAIN" | tr '[:upper:]' '[:lower:]')
[[ $DOMAIN =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]] || die "--domain is required and must be a domain name"
[[ $SUPABASE_REF =~ ^[a-z0-9]{20}$ ]] || die "--supabase-ref must be the 20-character project ref"
if [ -z "$TEMPLATE" ]; then
  TEMPLATE=/usr/local/share/qrie/nginx/site.conf.template
  [ -f "$TEMPLATE" ] || TEMPLATE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/site.conf.template
fi
[ -f "$TEMPLATE" ] || die "no template at $TEMPLATE"

SB="https://$SUPABASE_REF.supabase.co"

# One Content-Security-Policy per app, from what each one loads (read on
# 2026-10-10 in the apps' source and in their builds of 2026-10-08):
#   - scripts: only the app's own files; no eval or new Function in either bundle.
#   - styles: 'unsafe-inline', because libraries in both apps add <style>
#     elements while they run.
#   - connect-src: the Supabase project ($SB): REST (the lms schema's
#     functions), Auth, Storage and Edge Functions (lms-signin, lms-admin). The
#     relay is an Edge Function on the same origin, so "Draft with AI" needs
#     nothing more if it is switched on with this project's relay. No wss:
#     neither app opens a Realtime channel.
#   - teacher: Google Fonts (Inter and Manrope, apps/lms/index.html); images
#     as data: (people's photos and drawn faces, apps/lms/src/lib/photos.ts)
#     and from the project (photos of work open as signed Storage addresses,
#     apps/lms/src/features/homework/detail.tsx).
#   - app: no outside fonts; images as data: (apps/student/src/lib/photos.ts)
#     and blob: (a page's photo shown before it is handed in,
#     apps/student/src/features/homework/photos.tsx).
#   - admin: as apps/admin/vercel.json on the admin branch has it, word for word.
#     Its connect-src allows any *.supabase.co project, not only this one.
csp_for() {
  case $1 in
    teacher)
      printf '%s' "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: $SB; connect-src 'self' $SB; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
      ;;
    app)
      printf '%s' "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' $SB; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
      ;;
    admin)
      printf '%s' "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://*.supabase.co; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
      ;;
    *) return 1 ;;
  esac
}

write_file() { # path, content on stdin; replaced in one rename
  cat > "$1.new"
  chmod 0644 "$1.new"
  mv -f "$1.new" "$1"
}

for site in $SITES; do
  csp_for "$site" > /dev/null || die "unknown site: $site (teacher, app or admin); nothing was written"
done

mkdir -p "$OUT/sites-available" "$OUT/sites-enabled" "$OUT/snippets"
rm -f "$OUT/sites-enabled/default"

write_file "$OUT/sites-available/qrie-default.conf" <<'EOF'
# QRIE: written by qrie-render-sites. Any request for a name that is not one
# of the QRIE sites (for example, the bare IP address) is closed unanswered.
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    return 444;
}

server {
    listen 443 ssl http2 default_server;
    listen [::]:443 ssl http2 default_server;
    server_name _;
    ssl_reject_handshake on;
    # The same as the sites, so no server on this port offers anything older.
    ssl_protocols TLSv1.2 TLSv1.3;
}
EOF
ln -sfn ../sites-available/qrie-default.conf "$OUT/sites-enabled/qrie-default.conf"

template=$(sed 's/\r$//' "$TEMPLATE")
summary=()
for site in $SITES; do
  csp=$(csp_for "$site") || die "unknown site: $site (teacher, app or admin)"
  host=$site.$DOMAIN

  write_file "$OUT/snippets/qrie-$site-headers.conf" <<EOF
# QRIE $site: the security headers of its https server. Written by
# qrie-render-sites; HSTS is here because only the https server includes it.
add_header Content-Security-Policy "$csp" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "no-referrer" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()" always;
add_header Strict-Transport-Security "max-age=31536000" always;
EOF

  if [ -f "$CERTS/$host/fullchain.pem" ]; then
    conf=$(printf '%s\n' "$template" | sed '/^#@TLS-\(BEGIN\|END\)$/d')
    summary+=("$host: https")
  else
    conf=$(printf '%s\n' "$template" | sed '/^#@TLS-BEGIN$/,/^#@TLS-END$/d')
    summary+=("$host: port 80 only, no certificate yet (README.md, step 8)")
  fi
  conf=${conf//__HOST__/"$host"}
  conf=${conf//__SITE__/"$site"}
  printf '%s\n' "$conf" | write_file "$OUT/sites-available/qrie-$site.conf"
  ln -sfn "../sites-available/qrie-$site.conf" "$OUT/sites-enabled/qrie-$site.conf"
done

if [ "$TOUCH_NGINX" = yes ]; then
  nginx -t
  systemctl reload-or-restart nginx
fi
printf '%s\n' "${summary[@]}"
