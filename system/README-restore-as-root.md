# System-layer restore (run as root/sudo on the fresh install)

From the repo root:

```bash
# 1. noctalia + umbriel apt repo (both ship from pkg.noctalia.dev)
sudo cp system/etc/apt/sources.list.d/noctalia-trixie.sources /etc/apt/sources.list.d/
sudo mkdir -p /usr/share/keyrings
sudo cp system/usr-share-keyrings/nickh-archive-keyring.gpg /usr/share/keyrings/
sudo apt update

# 2. packages. Expect a handful to not exist / have different names; install the rest.
xargs -a system/apt-manual-packages.txt sudo apt install -y --no-install-recommends

# 3. login chain: greetd → noctalia-greeter (PASSWORD PROMPT, no autologin) → start-umbriel
sudo apt install noctalia-greeter          # ships the drop-in pointing at the toml below
sudo cp system/etc/greetd/noctalia-greeter.toml /etc/greetd/noctalia-greeter.toml
sudo systemctl enable --now greetd
```

Notes:

- **The active greeter config is `/etc/greetd/noctalia-greeter.toml`**, not the stock
  `config.toml` — the package drop-in `/usr/lib/systemd/system/greetd.service.d/noctalia-greeter.conf`
  starts `greetd --config` with that file. Autologin was deliberately removed on 2026-09-29:
  do NOT re-add an `[initial_session]` block unless you want passwordless boot-to-desktop.
- The keyring file is copied by path because `noctalia-trixie.sources` pins
  `Signed-By: /usr/share/keyrings/nickh-archive-keyring.gpg`. If the upstream keyring package
  exists in the repo, prefer installing it instead of the raw file copy.
- `dpkg-selections.txt` is the full installed-package census (name/version/arch) for reference —
  do NOT blind-replay it; use `apt-manual-packages.txt` (315 manually marked packages) instead.
- Docker/Slack/Spotify third-party repos (extrepo_*) get added by their own installers.
- After this + `restore.sh`, reboot once so greetd owns the login path.

## XnView MP Wayland bridge (2026-09-30)

XnView MP (vendor .deb → /opt/XnView) bundles Qt 6.10.3 with ONLY an xcb platform
plugin and cannot start on this Wayland-only box. After installing the deb, bridge
the system Qt6 Wayland plugins into its plugin dir:

```bash
ln -sfn /usr/lib/x86_64-linux-gnu/qt6/plugins/platforms/libqwayland-generic.so /opt/XnView/lib/platforms/libqwayland-generic.so
ln -sfn /usr/lib/x86_64-linux-gnu/qt6/plugins/platforms/libqwayland-egl.so    /opt/XnView/lib/platforms/libqwayland-egl.so
```

Plugins built against an older Qt minor (system 6.8) load into XnView's newer
runtime (6.10) — verified working. The symlinks are untracked by dpkg and survive
deb upgrades.
