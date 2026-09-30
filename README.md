# futuratrauma/configs — desktop restore bundle

Snapshot of the Wayland desktop on **vezhnavets** (Debian 13 trixie, x86_64), taken **2026-09-29**,
updated **2026-09-30**:
**umbriel** (compositor) + **noctalia** (shell/bar/dock), kitty, oh-my-posh, spicetify, BT
A2DP↔HFP auto-switch stack, fonts, and the small hand-written scripts that make it all work.

## Layout

```
home/               mirror of $HOME — restore target for `cp -a home/. ~/`
  .bashrc .bash_profile .profile .gitconfig
  .config/          umbriel noctalia kitty oh-my-posh spotify spicetify Kvantum gtk-3.0 gtk-4.0
                    kdedefaults menus (applications.menu fix) systemd/user (bt-call-autoswitch)
  .config/mimeapps.list   explicit default apps: images→XnView, video→mpv, text→zed, folders→Thunar
  .local/bin/       bt-profile-set bt-call-autoswitch kitty-askpass (sudo askpass, no KDE)
  .local/state/noctalia/settings.toml   ← noctalia's REAL live config (not .config/noctalia)
  .local/share/     fonts, applications overrides, dbus-1 (FileManager1→Thunar override),
                    noctalia-plugins-local (BT-profile widget)
  Pictures/         wallhaven-p8j8je.jpg (live wallpaper), cat-bg-learninglab.png (kitty art source)
  tools/            make-breeze-noir-green.sh — rebuilds the custom phthalo-green icon theme
system/             needs root to restore — see system/README-restore-as-root.md
restore.sh          user-level restore (idempotent, backs up existing targets)
```

Not included on purpose: Thunderbird/Zen/Slack/Cursor profiles (app data, multi-GB), waybar
unit + dp1-unlock-watcher unit (dead leftovers on this machine), KDE/latte configs (purged).

## Fresh-install restore order

1. **System layer first** (root): `bash system/README-restore-as-root.md` steps — noctalia apt
   repo + keyring, then the package list, then greetd.
2. `./restore.sh` (as your normal user, NOT root) — see its `--check` mode.
3. `systemctl --user enable --now bt-call-autoswitch` (restore.sh does this if systemd user is live).
4. Reboot / re-login through **greetd → noctalia-greeter**.
5. Extras with external installers (not in the bundle to keep the repo slim):

   | Tool | Get it |
   |---|---|
   | oh-my-posh | `curl -fsSL https://raw.githubusercontent.com/JanDeDobbeleer/oh-my-posh/main/script/install.sh \| sh` (or bundled version 31.4.0 from GitHub releases — `oh-my-posh.dev` DNS is flaky) |
   | spicetify | `curl -fsSL https://raw.githubusercontent.com/spicetify/cli/main/install.sh \| sh`, install Spotify, then `spicetify apply` (config already restored) |
   | matugen | `pipx install matugen` |
   | kubectl | `curl -LO https://dl.k8s.io/release/stable.txt` → `https://dl.k8s.io/release/v$(cat stable.txt)/bin/linux/amd64/kubectl` |
   | kubelogin | exec credential plugin for the regula cluster — rebuild per its repo, binary is not bundled |
   | zed | `curl -fssl https://zed.dev/install.sh \| sh` (symlink `~/.local/bin/zed` is not bundled) |
   | AnyDesk | UNINSTALLED 2026-09-29 (X11 removal). If ever needed back: amd64 deb from `https://dl.anydesk.com/` — but it is X11-only and needs an X server on this box |

## Things the config assumes (why restoring only configs is not enough)

- **Wayland-only since 2026-09-29**: X11 was fully removed — no xwayland package, no
  xwayland-satellite (binary quarantined, not bundled), umbriel `xwayland = false`.
  Spotify runs Wayland-native via `--ozone-platform=wayland` (see spotify.desktop override).
  AnyDesk was uninstalled with it — it is X11-only and will NOT run again unless an X
  server (e.g. xwayland-satellite) is deliberately brought back.
- **noctalia runs as a systemd transient unit** launched from umbriel autostart with
  `WAYLAND_DISPLAY=wayland-0` passed explicitly (a bare respawn dies and takes bar+dock with it).
  All of this is inside the restored `config.toml`.
- **BT stack**: `bt-call-autoswitch.service` watches PipeWire for real (non-passive) mic streams
  and flips the WH-CH720N between A2DP and HFP via `bt-profile-set`. **It needs `jq`** — jq was
  once removed by an apt autoremove cascade (2026-09-29) and the watcher silently idled; it is
  in `system/apt-manual-packages.txt`, marked manual. The bar widget comes from
  `.local/share/noctalia-plugins-local` — after restore re-register it:
  `noctalia msg plugins source add local ~/.local/share/noctalia-plugins-local && noctalia msg plugins enable ivan/bt-call-profile`
  (the nested `.git` was stripped from the copy).
- **`kitty-askpass`** (sudo askpass) prompts in a kitty window — no KDE dependency.
  `kdaskpass` (kdialog-based) and `xwayland-satellite` are RETIRED 2026-09-30 with the
  second KDE purge (kdialog, ksshaskpass, konsole, kate, kfind, kile all purged;
  dolphin kept but demoted — Thunar is the file manager).
- **Autologin is OFF**: the greeter config (`system/etc/greetd/noctalia-greeter.toml`) has no
  `[initial_session]` — the greeter asks for the password at boot. Do not re-add it.
- **Fonts** live in `~/.local/share/fonts` (fc-cache by restore.sh). `msr.ttf` (15 MB) is bundled
  because its origin can't be re-downloaded.
- **kitty background** `cat-left.png` is pre-composited inside `.config/kitty/Background/`;
  the original art is in `home/Pictures/` if it ever needs regenerating.

## 2026-09-30 update — media, file manager, theming

- **VLC is permanently retired on this box**: VLC 3's Qt GUI is X11-gated (silent fail
  without an X server) and its Wayland window path (wl_shell) is dead on modern
  compositors — it segfaults in the caca fallback. **mpv** is the video player
  (in `system/apt-manual-packages.txt`); audio stays on Spotify.
- **XnView MP** (deb at /opt/XnView, bundles Qt 6.10 xcb-only) runs on Wayland only
  after symlinking the system Qt6 wayland platform plugins into
  `/opt/XnView/lib/platforms/` — see `system/README-restore-as-root.md`.
- **File manager = Thunar** (+gvfs, tumbler, xarchiver, thunar-archive-plugin for
  right-click extract). Dolphin is still installed but demoted; the
  `org.freedesktop.FileManager1` dbus name is overridden to Thunar via
  `home/.local/share/dbus-1/`. `~/.config/menus/applications.menu` is a user-level
  fix — trixie ships NO applications.menu and without it KDE's ksycoca builds empty
  (empty "open with" dialogs).
- **GTK theming**: theme = Breeze-Dark (`breeze-gtk-theme`), icons = custom
  **Breeze-Noir-White-Green** (rebuild with `tools/make-breeze-noir-green.sh` — the
  61 MB theme is deliberately not bundled), accent #04bf9d + file-view background
  via `home/.config/gtk-3.0/gtk.css`. dconf (`gsettings`) is the authoritative
  backend — settings.ini mirrors it.
- **umbriel config changes**: daily-driver parking rules are now gated with
  `match.at_startup = true` (mid-session launches open focused on the current
  screen), resize binds Mod+±/Mod+Shift+± added, `focus_on_activate = true`, and the
  session-wide `GTK_THEME` env override was REMOVED (it silently defeated every GTK
  theme setting).
