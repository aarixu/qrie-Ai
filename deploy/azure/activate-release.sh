#!/usr/bin/env bash
# QRIE: put uploaded builds live on the VM. deploy-apps.ps1 copies this file
# and the builds into ~/qrie-upload and runs it as the deploy user:
#
#   bash ~/qrie-upload/activate-release.sh <stamp> <site>...
#
# Each <site> (teacher, app or admin) needs ~/qrie-upload/qrie-<site>-<stamp>.tgz.
#
#   1. Every build is unpacked into /var/www/qrie/<site>/releases/<stamp>.
#      The files under assets/ that the live release has as its own are
#      copied in too, so a page opened before the deploy can still fetch the
#      parts it has not loaded yet. Only that one release's own files are
#      carried, never older ones.
#   2. `nginx -t`. If it or anything before it fails, the new release
#      folders are removed and nothing has changed.
#   3. Each site's `current` link is pointed at its new release by a rename,
#      so any one request is answered wholly from the old release or wholly
#      from the new one. Then nginx reloads.
#   4. All but the newest five releases of each site are removed, and so are
#      the uploaded files.
#
# Back to the release before the live one:
#
#   bash ~/qrie-upload/activate-release.sh --rollback <site>
set -euo pipefail
export LC_ALL=C

WWW=/var/www/qrie
UPLOAD=$HOME/qrie-upload
KEEP=5

die() { echo "activate-release: $*" >&2; exit 1; }
valid_site() { case $1 in teacher | app | admin) return 0 ;; *) return 1 ;; esac; }

# The site's releases, oldest first.
releases_of() {
  local d
  for d in "$WWW/$1"/releases/*; do
    [ -d "$d" ] || continue
    d=${d##*/}
    if [[ $d =~ ^[0-9]{8}-[0-9]{6}$ ]]; then printf '%s\n' "$d"; fi
  done
}

# The release the site's `current` link points at, or nothing.
live_release() {
  if [ -L "$WWW/$1/current" ]; then basename "$(readlink -f "$WWW/$1/current")"; fi
}

switch_to() { # site release
  ln -sfn "releases/$2" "$WWW/$1/current.next"
  mv -Tf "$WWW/$1/current.next" "$WWW/$1/current"
}

if [ "${1:-}" = --rollback ]; then
  site=${2:-}
  valid_site "$site" || die "usage: activate-release.sh --rollback teacher|app|admin"
  now=$(live_release "$site")
  [ -n "$now" ] || die "$site has no live release"
  before=
  while IFS= read -r r; do
    if [[ $r < $now ]]; then before=$r; fi
  done < <(releases_of "$site")
  [ -n "$before" ] || die "$site has no release older than $now"
  sudo -n /usr/sbin/nginx -t
  switch_to "$site" "$before"
  sudo -n /usr/bin/systemctl reload nginx
  echo "$site: back to $before (was $now)"
  exit 0
fi

stamp=${1:-}
[[ $stamp =~ ^[0-9]{8}-[0-9]{6}$ ]] || die "usage: activate-release.sh <yyyymmdd-hhmmss> <site>... | --rollback <site>"
shift
[ $# -gt 0 ] || die "name at least one site"
for site in "$@"; do
  valid_site "$site" || die "unknown site: $site (teacher, app or admin)"
  [ -d "$WWW/$site/releases" ] || die "$WWW/$site/releases is missing: run setup-server.sh first"
  [ -f "$UPLOAD/qrie-$site-$stamp.tgz" ] || die "missing $UPLOAD/qrie-$site-$stamp.tgz"
  [ ! -e "$WWW/$site/releases/$stamp" ] || die "$site already has a release $stamp"
done

# 1 and 2: unpack, check. Until the links move, a failure removes what was made.
made=()
forget_unswitched() {
  local d
  for d in "${made[@]}"; do rm -rf -- "$d" "$d.own"; done
}
trap forget_unswitched EXIT

for site in "$@"; do
  new=$WWW/$site/releases/$stamp
  mkdir "$new"
  made+=("$new")
  tar -xzf "$UPLOAD/qrie-$site-$stamp.tgz" -C "$new" --no-same-owner
  [ -f "$new/index.html" ] || die "$site: the upload has no index.html"
  # This release's own asset files, for the next deploy to carry.
  if [ -d "$new/assets" ]; then
    (cd "$new" && find assets -type f | sort) > "$new.own"
  else
    : > "$new.own"
  fi
  live=$(live_release "$site")
  if [ -n "$live" ] && [ -f "$WWW/$site/releases/$live.own" ]; then
    carried=0
    while IFS= read -r f; do
      [ -n "$f" ] && [ ! -e "$new/$f" ] && [ -f "$WWW/$site/releases/$live/$f" ] || continue
      mkdir -p "$(dirname "$new/$f")"
      cp -p "$WWW/$site/releases/$live/$f" "$new/$f"
      carried=$((carried + 1))
    done < "$WWW/$site/releases/$live.own"
    echo "$site: carried $carried asset files over from $live"
  fi
  chmod -R u=rwX,go=rX "$new"
done

sudo -n /usr/sbin/nginx -t

# 3: switch every site, then reload. From here a release folder may be live,
# so a failure leaves the folders where they are.
made=()
trap - EXIT
for site in "$@"; do
  switch_to "$site" "$stamp"
  echo "$site: live release is now $stamp"
done
sudo -n /usr/bin/systemctl reload nginx

# 4: tidy.
for site in "$@"; do
  rm -f -- "$UPLOAD/qrie-$site-$stamp.tgz"
  live=$(live_release "$site")
  mapfile -t all < <(releases_of "$site")
  for ((i = 0; i < ${#all[@]} - KEEP; i++)); do
    old=${all[i]}
    [ "$old" = "$live" ] && continue
    rm -rf -- "$WWW/$site/releases/$old" "$WWW/$site/releases/$old.own"
    echo "$site: removed old release $old"
  done
done
