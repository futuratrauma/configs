#!/usr/bin/env bash
# Rebuilds the Breeze-Noir-White-Green icon theme from l4k1's Breeze-Noir-
# White-Blue-V-2 (gnome-look p/1361468). The custom theme is NOT bundled
# (61 MB of SVGs) — this script reproduces it exactly:
#   1. download the source theme via the OCS API (gnome-look web is
#      Anubis-bot-walled; api.pling.com works),
#   2. hue-shift every blue SVG (hue 185–215°) to phthalo green (166° ≈
#      #04bf9d), preserving lightness/saturation so gradients survive,
#   3. install to ~/.local/share/icons, fix the Thunar app icon
#      (org.xfce.thunar — otherwise the XFCE-rat fallback shows),
#      and activate via gsettings.
# Needs: curl, tar, python3, gtk-update-icon-cache (libgtk-3-bin).
set -euo pipefail

dest="$HOME/.local/share/icons"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

echo "== downloading Breeze-Noir-White-Blue-V-2 via OCS API =="
url="$(curl -s 'https://api.pling.com/ocs/v1/content/data/1361468' \
  | grep -oE '<downloadlink[0-9]*>[^<]+' | head -1 | sed 's/<[^>]*>//')"
[[ -n "$url" ]] || { echo "ERROR: no download link from OCS API"; exit 1; }
curl -sL -o "$work/theme.tar.xz" "$url"

tar xJf "$work/theme.tar.xz" -C "$work"
src="$work/Breeze-Noir-White-Blue-V-2"
[[ -d "$src" ]] || { echo "ERROR: unexpected tarball layout:"; ls "$work"; exit 1; }

echo "== installing + recoloring =="
rm -rf "$dest/Breeze-Noir-White-Green"
cp -r "$src" "$dest/Breeze-Noir-White-Green"
chmod -R u+w "$dest/Breeze-Noir-White-Green"   # some SVGs are read-only in the tarball

python3 - "$dest/Breeze-Noir-White-Green" <<'PY'
import colorsys, os, re, sys
root = sys.argv[1]
hexre = re.compile(rb'#[0-9a-fA-F]{6}\b')
def shift(m):
    s = m.group(0)
    r, g, b = int(s[1:3],16)/255, int(s[3:5],16)/255, int(s[5:7],16)/255
    h, l, c = colorsys.rgb_to_hls(r, g, b)
    if 185 <= h*360 <= 215:
        r2, g2, b2 = colorsys.hls_to_rgb(166/360, l, c)
        return b'#%02x%02x%02x' % (round(r2*255), round(g2*255), round(b2*255))
    return s
n = f = 0
for dp, _, fns in os.walk(root):
    for fn in fns:
        if not fn.endswith('.svg'):
            continue
        p = os.path.join(dp, fn)
        try:
            d = open(p, 'rb').read()
            d2 = hexre.sub(shift, d)
            if d2 != d:
                open(p, 'wb').write(d2)
                n += 1
        except OSError:
            f += 1  # absolute symlinks into /usr/share/icons/breeze-dark (root-owned)
print(f"recolored {n} svgs, skipped {f} (system-theme symlinks)")
PY

sed -i 's/^Name=.*/Name=Breeze-Noir-White-Green/; s/^Name\[en_GB\]=.*/Name[en_GB]=Breeze-Noir-White-Green/' \
  "$dest/Breeze-Noir-White-Green/index.theme"

echo "== thunar app icon (avoid the XFCE-rat fallback) =="
cd "$dest/Breeze-Noir-White-Green"
for f in $(find . -name 'system-file-manager.svg'); do
  cp "$f" "$(dirname "$f")/org.xfce.thunar.svg"
done

gtk-update-icon-cache -f -t "$dest/Breeze-Noir-White-Green"
gsettings set org.gnome.desktop.interface icon-theme 'Breeze-Noir-White-Green'
echo "done — restart the file manager:  systemctl --user restart thunar.service"
