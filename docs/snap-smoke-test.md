# Snap install and smoke test

Run this on a real Ubuntu machine (Ubuntu 24.04 desktop, amd64, with snapd) before a snap is published. It checks the `.snap` built by the `Build and test` workflow. Use a test machine or a VM: step 2 removes any installed `hamal` snap and its room data.

You also need a phone (or a second computer) on the same Wi-Fi or Ethernet network.

## 1. Get the snap from CI

```bash
# RUN_ID is the "Build and test" run for the commit under review.
gh run download RUN_ID -R i1k3r/HAMAL-Linux -n hamal-snap -D hamal-snap
cd hamal-snap
ls                                   # expect hamal_0.9.0_amd64.snap
sha256sum hamal_0.9.0_amd64.snap     # must match the hash printed by the "Check snap metadata" step
```

Without `gh`, download the `hamal-snap` artifact from the run page and unzip it.

## 2. Check the metadata and install

```bash
snap info --verbose ./hamal_0.9.0_amd64.snap   # expect version 0.9.0, confinement strict, license Proprietary

snap list hamal && sudo snap remove --purge hamal   # only if a hamal snap is already installed

sudo snap install --dangerous ./hamal_0.9.0_amd64.snap
snap list hamal                      # expect Version 0.9.0, Notes "-" (not devmode or classic)
```

`--dangerous` is needed because a locally built snap is not signed by the store. Such an install does not receive automatic refreshes; that path can only be checked after a store release.

## 3. Check interfaces

```bash
snap connections hamal
```

Expect these plugs to be connected: `network`, `network-bind`, `home`, `desktop`, `desktop-legacy`, `wayland`, `x11`, `opengl`, `gsettings`, `gnome-46-2404`, `gtk-3-themes`, `icon-themes`, `sound-themes`. `removable-media` is not connected automatically.

If `gnome-46-2404` or the theme plugs show `-`, install the providers and connect them:

```bash
sudo snap install gnome-46-2404 gtk-common-themes
sudo snap connect hamal:gnome-46-2404 gnome-46-2404:gnome-46-2404
sudo snap connect hamal:gtk-3-themes gtk-common-themes:gtk-3-themes
sudo snap connect hamal:icon-themes gtk-common-themes:icon-themes
sudo snap connect hamal:sound-themes gtk-common-themes:sound-themes
```

Check the snap environment:

```bash
snap run --shell hamal -c 'echo "SNAP=$SNAP SNAP_NAME=$SNAP_NAME XDG_DATA_HOME=$XDG_DATA_HOME"'
# expect SNAP=/snap/hamal/x1, SNAP_NAME=hamal and XDG_DATA_HOME under ~/snap/hamal/
```

## 4. Watch for confinement denials

Keep this running in a second terminal for the rest of the test:

```bash
sudo journalctl -f | grep -E 'apparmor="DENIED"|audit.*seccomp' | grep -i hamal
```

## 5. Start the app

```bash
sudo ufw status        # if active, allow your LAN for this test, e.g. sudo ufw allow from 192.168.1.0/24
hamal                  # starts the app and prints its log to this terminal
```

Also start it once from the applications menu and check the HAMAL icon and the name "HAMAL File Transfer".

## 6. Manual checks

| # | Action | Expected |
|---|--------|----------|
| 1 | Open the app | The Light Table home screen appears, in the desktop's theme and language |
| 2 | Open About | Version `v0.9.0` and "Installed from the Snap Store. Updates arrive automatically." No update banner appears |
| 3 | Create a room with lifespan 5 minutes and PIN `4821` | The table, lamp and "PIN to join" appear |
| 4 | Show QR, scan it with the phone, enter the PIN | The phone joins and appears as a seat on the table |
| 5 | Upload a photo from the phone | It appears on the table. Download opens the system save dialog. Saving to `~/Downloads` shows Saved and the file opens |
| 6 | Click Add files and pick two files from `~/Documents` | The upload tray shows progress and both files appear on the phone |
| 7 | Drag a file from the file manager onto the table | It uploads and appears on the phone |
| 8 | Upload a `.sh` file from the phone | It is marked as potentially executable |
| 9 | Click Write a note, type two lines (Shift+Enter between them), press Enter | The note appears on the table and on the phone with both lines. Copy puts it on the clipboard |
| 10 | Send a note from the phone | It appears on the desktop table marked Note; the room log notes it |
| 11 | Copy an image (for example a screenshot) and press Ctrl+V on the table | A file `pasted-image-<time>.png` uploads and appears on the phone |
| 12 | Click View on a photo, then use the arrow keys, S and Esc | The viewer shows the photo, moves between items, S opens the save dialog, Esc closes |
| 13 | Type in Find, pick the Images filter, change the sort | The table shows only matching items in the chosen order |
| 14 | Switch to List, select two files, click Save selected and pick a folder that already holds one of them | Both are saved; the existing file is kept and the new copy gets ` (1)` in its name |
| 15 | Add a large file (over 500 MB) and click Cancel in the upload tray while it sends | It leaves the tray and never appears on the phone |
| 16 | Press `?`, then open the ⋯ room menu | The shortcut list appears; the menu shows Show QR, Copy link, theme, Keyboard shortcuts, About and Close room |
| 17 | Close the room and confirm | The closed screen appears on the desktop and the phone can no longer use the room |
| 18 | After about a minute, run `ls ~/snap/hamal/current/.local/share/HAMAL/files` | The room's files are gone |
| 19 | Optional: `sudo snap connect hamal:removable-media`, then save a received file to a USB drive under `/media` | The save succeeds |

The denial log from step 4 must stay empty, apart from known harmless WebKit or GTK lines that you note in the review.

## 7. Clean up

```bash
sudo snap remove --purge hamal
sudo snap install hamal        # optional: go back to the store version
```

Record the date, Ubuntu version, snapd version (`snap version`), the snap's sha256 and the result of each check in the pull request.
