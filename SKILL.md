---
name: install-universal-theme
description: Install or update the Universal Theme Chrome extension (any website, any theme) from its GitHub release zip, or from a zip the user already has, then walk the user through loading it in Chrome, Edge, Brave, or another Chromium browser.
---

# Install Universal Theme

Universal Theme is a Chrome extension that recolors any website with a theme the user picks. It is
installed from a zip with **Load unpacked**, not from the Chrome Web Store. Your job: put the
extension in a permanent folder, then guide the user through three clicks in the browser and
pasting their own API key. The whole thing takes a couple of minutes.

## 1. Get the zip

If the user gave you a zip file (named like `universal-theme-1.0.1.zip`), use that. Otherwise
download the latest release.

macOS / Linux:

```sh
url=$(curl -fsSL https://api.github.com/repos/BenjaminBenetti/universal-theme-extension/releases/latest \
  | grep -o '"browser_download_url": *"[^"]*universal-theme-[^"]*\.zip"' | head -1 | cut -d'"' -f4)
curl -fsSL "$url" -o /tmp/universal-theme.zip
```

Windows (PowerShell):

```powershell
$release = Invoke-RestMethod https://api.github.com/repos/BenjaminBenetti/universal-theme-extension/releases/latest
$asset = $release.assets | Where-Object name -like 'universal-theme-*.zip' | Select-Object -First 1
Invoke-WebRequest $asset.browser_download_url -OutFile "$env:TEMP\universal-theme.zip"
```

## 2. Unpack it into its permanent folder

The browser loads the extension from this folder every time it starts, so it must not be in
Downloads or a temp folder, and it must stay where it is. Keeping the same folder also keeps the
user's settings across updates. Replace the folder's contents completely, so nothing from an older
version is left behind. Use the zip from step 1 (or the user's zip) in place of the path below.

macOS / Linux (folder: `~/UniversalTheme`):

```sh
rm -rf ~/UniversalTheme && mkdir -p ~/UniversalTheme
unzip -q /tmp/universal-theme.zip -d ~/UniversalTheme \
  || python3 -m zipfile -e /tmp/universal-theme.zip ~/UniversalTheme
grep '"version"' ~/UniversalTheme/manifest.json
```

Windows (folder: `%USERPROFILE%\UniversalTheme`):

```powershell
$dir = Join-Path $env:USERPROFILE 'UniversalTheme'
if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
Expand-Archive "$env:TEMP\universal-theme.zip" -DestinationPath $dir
Select-String '"version"' (Join-Path $dir 'manifest.json')
```

Check that `manifest.json` sits directly in the folder (not in a subfolder). Tell the user which
version was installed. Copying the folder's full path to the clipboard saves them typing it in the
file picker later: `pbcopy` (macOS), `xclip -selection clipboard` or `wl-copy` (Linux),
`Set-Clipboard` (Windows).

## 3. Guide the user through the browser (first install only)

You cannot click inside the browser, and browsers refuse `chrome://` links opened from other apps,
so give the user these steps:

1. Paste `chrome://extensions` into the address bar (Edge: `edge://extensions`, Brave:
   `brave://extensions`).
2. Turn on **Developer mode** (a switch in the top right; in Edge it is in the left sidebar).
3. Click **Load unpacked** and choose the folder from step 2. In the file picker you can paste the
   path: **Cmd+Shift+G** on macOS, **Ctrl+L** on Linux, or the address bar on Windows.
4. Universal Theme appears, and its settings page opens. Paste a TypeSafe API key from
   [console.typesafe.ai](https://console.typesafe.ai) and click **Save**. The key never leaves
   their browser except to call TypeSafe; do not ask the user for it or handle it yourself.
5. Optional: pin it with the puzzle-piece icon in the toolbar. Clicking the octopus (Inky) picks a
   theme for the current site or for all sites.

The browser may say the extension is in developer mode or not from the Chrome Web Store. That is
expected for extensions installed this way.

## Updating

Repeat steps 1 and 2 (same folder), then ask the user to open `chrome://extensions` and click the
circular **Reload** arrow on the Universal Theme card. Settings and themes are kept.

## Uninstalling

Ask the user to click **Remove** on the Universal Theme card in `chrome://extensions`, then delete
the folder from step 2.
