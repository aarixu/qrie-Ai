#!/usr/bin/env bash
# Renders the nginx sites with ../nginx/render-sites.sh into a scratch folder
# (--out, so nginx is not touched): once with no certificates, once with a
# certificate for the teacher site only.
#   bash deploy/azure/tests/render-sites.test.sh
# It checks the files' text; it cannot run `nginx -t`, which needs nginx.
# (On Windows, Git Bash's ln -s makes copies here, which is all this needs.)
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
RENDER=$HERE/../nginx/render-sites.sh
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/certs"
pass=0; failn=0
ok() { echo "PASS: $*"; pass=$((pass + 1)); }
bad() { echo "FAIL: $*"; failn=$((failn + 1)); }
has() { grep -qF -- "$2" "$1"; }

bash "$RENDER" --domain Example.IN --out "$T/a" --certs "$T/certs" > /dev/null && ok "renders with no certificate" || bad "render a"
has "$T/a/sites-available/qrie-teacher.conf" 'listen 443' && bad "https server without a certificate" || ok "no https server without a certificate"
has "$T/a/sites-available/qrie-teacher.conf" '#@TLS' && bad "markers left in" || ok "markers taken out"
has "$T/a/sites-available/qrie-teacher.conf" 'server_name teacher.example.in;' && ok "the host name, in lower case" || bad "host"
has "$T/a/sites-available/qrie-teacher.conf" 'root /var/www/letsencrypt;' && ok "Let's Encrypt's path on port 80" || bad "acme"
has "$T/a/sites-available/qrie-app.conf" '__' && bad "a placeholder left" || ok "no placeholder left"

mkdir -p "$T/certs/teacher.example.in"; : > "$T/certs/teacher.example.in/fullchain.pem"
bash "$RENDER" --domain example.in --out "$T/b" --certs "$T/certs" > /dev/null && ok "renders with one certificate" || bad "render b"
has "$T/b/sites-available/qrie-teacher.conf" 'listen 443 ssl http2;' && ok "teacher gets its https server" || bad "teacher 443"
has "$T/b/sites-available/qrie-app.conf" 'listen 443' && bad "app has https without a certificate" || ok "app stays on port 80"
has "$T/b/sites-available/qrie-teacher.conf" 'root /var/www/qrie/teacher/current;' && ok "served from current" || bad "root"
has "$T/b/sites-available/qrie-teacher.conf" 'try_files $uri /index.html;' && ok "app routes fall back to index.html" || bad "fallback"
has "$T/b/sites-available/qrie-teacher.conf" 'add_header Cache-Control "no-store" always;' && ok "index.html is no-store" || bad "no-store"
has "$T/b/sites-available/qrie-teacher.conf" 'public, max-age=31536000, immutable' && ok "assets are immutable" || bad "immutable"
has "$T/b/snippets/qrie-teacher-headers.conf" "connect-src 'self' https://ueemqirxyrltdmqgnidy.supabase.co;" && ok "teacher CSP: the project" || bad "teacher connect-src"
has "$T/b/snippets/qrie-teacher-headers.conf" 'https://fonts.gstatic.com' && ok "teacher CSP: Google Fonts" || bad "teacher fonts"
has "$T/b/snippets/qrie-app-headers.conf" "img-src 'self' data: blob:;" && ok "app CSP: blob: previews" || bad "app img-src"
has "$T/b/snippets/qrie-app-headers.conf" 'fonts.g' && bad "app CSP allows Google Fonts" || ok "app CSP: no outside fonts"
has "$T/b/snippets/qrie-admin-headers.conf" "connect-src 'self' https://*.supabase.co;" && ok "admin CSP as its vercel.json" || bad "admin csp"
for h in 'X-Content-Type-Options "nosniff"' 'X-Frame-Options "DENY"' 'Referrer-Policy "no-referrer"' 'Permissions-Policy' 'Strict-Transport-Security'; do
  has "$T/b/snippets/qrie-app-headers.conf" "$h" && ok "header: $h" || bad "header missing: $h"
done
has "$T/b/sites-available/qrie-app.conf" 'Strict-Transport-Security' && bad "HSTS outside the https server" || ok "no HSTS in the port-80 file"
[ -e "$T/b/sites-enabled/qrie-teacher.conf" ] && ok "site enabled" || bad "not enabled"
has "$T/b/sites-available/qrie-default.conf" 'ssl_reject_handshake on;' && ok "the default server turns other names away" || bad "default server"

bash "$RENDER" --domain example.in --out "$T/c" --sites "teacher nope" 2> /dev/null && bad "unknown site accepted" || ok "an unknown site is refused"
[ ! -e "$T/c/sites-available/qrie-teacher.conf" ] && ok "nothing written after a refusal" || bad "wrote before refusing"
bash "$RENDER" --domain 'bad domain' --out "$T/d" 2> /dev/null && bad "bad domain accepted" || ok "a bad domain is refused"

echo "passed $pass, failed $failn"
[ "$failn" = 0 ]
