#!/usr/bin/env bash
# Restore the vezhnavets desktop config bundle into $HOME. Run as your normal user, NOT root.
# Idempotent: pre-existing targets are moved aside to <path>.pre-restore-<ts> instead of being clobbered.
set -euo pipefail

BUNDLE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$BUNDLE/home"
TS="$(date +%Y%m%d-%H%M%S)"
CHECK=0
[[ "${1:-}" == "--check" ]] && CHECK=1

[[ $EUID -ne 0 ]] || { echo "refusing to run as root — this restores into \$HOME"; exit 1; }
[[ -d "$SRC" ]] || { echo "missing $SRC — run from inside the bundle"; exit 1; }

place() {  # place <src-relative-path> [file|dir]
  local rel="$1" s="$SRC/$1" d="$HOME/$1"
  [[ -e "$s" ]] || { echo "  (skip, not in bundle: $rel)"; return; }
  if [[ -e "$d" ]]; then
    if [[ $CHECK -eq 1 ]]; then echo "  WOULD REPLACE: $d"; return; fi
    mv "$d" "$d.pre-restore-$TS"
    echo "  replaced (old kept: $d.pre-restore-$TS)"
  else
    [[ $CHECK -eq 1 ]] && { echo "  WOULD CREATE: $d"; return; }
    echo "  created: $d"
  fi
  mkdir -p "$(dirname "$d")"
  cp -a "$s" "$d"
}

echo "== dotfiles =="
for f in .bashrc .bash_profile .profile .gitconfig; do place "$f"; done

echo "== .config app dirs =="
for d in umbriel noctalia kitty oh-my-posh spotify spicetify Kvantum gtk-3.0 gtk-4.0 kdedefaults menus; do
  place ".config/$d"
done
place ".config/systemd/user/bt-call-autoswitch.service"

echo "== noctalia live state =="
place ".local/state/noctalia/settings.toml"

echo "== mime defaults / XDG menus / dbus overrides =="
place ".config/mimeapps.list"
place ".config/menus"
place ".local/share/dbus-1"

echo "== local bin =="
for b in bt-call-autoswitch bt-profile-set kitty-askpass; do
  place ".local/bin/$b"
done
if [[ $CHECK -eq 0 ]]; then
  mkdir -p "$HOME/.local/bin"
  chmod +x "$HOME/.local/bin/"{bt-call-autoswitch,bt-profile-set,kitty-askpass} 2>/dev/null || true
fi

echo "== fonts / app overrides / noctalia plugin source =="
place ".local/share/fonts"
place ".local/share/applications"
place ".local/share/noctalia-plugins-local"

echo "== pictures (wallpaper + kitty art) =="
mkdir -p "$HOME/Pictures"
place "Pictures/wallhaven-p8j8je.jpg"
place "Pictures/cat-bg-learninglab.png"

if [[ $CHECK -eq 1 ]]; then
  echo; echo "check mode — nothing was changed."; exit 0
fi

echo "== finishing =="
if command -v fc-cache >/dev/null; then fc-cache -f "$HOME/.local/share/fonts"; fi

if systemctl --user is-system-running >/dev/null 2>&1 || [[ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ]]; then
  systemctl --user daemon-reload
  systemctl --user enable --now bt-call-autoswitch.service && echo "bt-call-autoswitch: enabled+started" || true
else
  echo "WARN: no systemd user session — after first graphical login run:"
  echo "  systemctl --user enable --now bt-call-autoswitch"
fi

cat <<'EOF'

── manual steps this script cannot do ─────────────────────────────
1. BEFORE first login: system/ layer as root — see system/README-restore-as-root.md
   (noctalia apt repo + keyring, package list, /etc/greetd/config.toml).
2. External tools not bundled (see README table): oh-my-posh, spicetify, matugen,
   kubectl, kubelogin, zed, AnyDesk (amd64 deb — double-check Architecture!).
3. Re-register the noctalia bar plugin:
     noctalia msg plugins source add local ~/.local/share/noctalia-plugins-local
     noctalia msg plugins enable ivan/bt-call-profile
4. Install Spotify, then: spicetify apply
5. Icon theme: the custom Breeze-Noir-White-Green is NOT bundled (61 MB of SVGs) —
   rebuild it with:  tools/make-breeze-noir-green.sh
   (downloads l4k1's White-Blue-V-2 via the OCS API, hue-shifts blues to green).
   Until then GTK apps fall back to Adwaita; gsettings already points at the name.
6. Log out/in (or reboot) so greetd → noctalia-greeter → umbriel owns the session.
7. Re-enter the secret scrubbed from the bundle:
     wallhaven key      → ~/.local/state/noctalia/settings.toml,
                          [plugin_settings."noctalia/wallhaven"]  api_key = "…"
──────────────────────────────────────────────────────────────────
EOF
