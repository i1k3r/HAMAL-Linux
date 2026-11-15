<div align="center">

<img src="frontend/src/brand/hamal-logo-light.svg#gh-light-mode-only" alt="HAMAL Logo Light" width="320" />
<img src="frontend/src/brand/hamal-logo-dark.svg#gh-dark-mode-only" alt="HAMAL Logo Dark" width="320" />

# HAMAL for Linux

**Fast, private, temporary file transfer.**

[![Platform](https://img.shields.io/badge/Platform-Linux%20x86--64-FCC624?logo=linux&logoColor=black)](https://github.com/i1k3r/HAMAL-Linux)
[![Packaging](https://img.shields.io/badge/Snap%20Store-Available-E95420?logo=snapcraft&logoColor=white)](https://snapcraft.io/hamal)
[![Go](https://img.shields.io/badge/Go-1.25+-00ADD8?logo=go&logoColor=white)](https://go.dev/)
[![License](https://img.shields.io/badge/License-Source--Available-lightgrey?style=flat-square)](LICENSE)

</div>

---

## Overview

**HAMAL for Linux** (HAMAL File Transfer) is the Linux desktop app for HAMAL. It runs the HAMAL server inside the app on your computer and opens temporary transfer rooms on your local network. Phones, tablets and other computers on the same network join a room from their browser and send files to, or receive files from, this computer. Files never go through a cloud service.

### Features in v0.9.0

- **Local network transfers**: Files travel over your Wi-Fi or Ethernet network to and from the HAMAL server running on this computer. Speed depends on your network and devices. Transfers use plain HTTP, so use HAMAL on networks you trust.
- **No cloud storage**: Files that are on a room's table are stored on this computer, in HAMAL's data directory (see [Storage](#storage)), and nowhere else.
- **QR joining**: Other devices join by scanning the room's QR code or opening its local network address in a browser. They need no app or account.
- **Temporary rooms**: Choose a room lifespan from 5 minutes to 24 hours. A lamp on the table shows how long the room has left.
- **Automatic cleanup**: When a room expires or you close it, its files are deleted from this computer by HAMAL's background cleanup, which runs every minute.
- **Optional PIN**: Protect a room with a PIN of 4 to 8 digits, as the HAMAL server requires.
- **Native file handling**: Add files with the system file dialog or by dragging them onto the table, and save received files with the system save dialog.
- **Notes**: Write a note, command or link on the table from the composer (Enter sends, Shift+Enter adds a line), copy or save any note, and send a note that is too long for a note as a `.txt` file.
- **Paste images**: Ctrl+V lays a copied image on the table as `pasted-image-<time>.<ext>`.
- **Previews**: Images, video and audio open in a viewer with Previous, Next and Save (arrow keys, S and Esc work too).
- **Find, filter and sort**: Search the table, filter it by kind (images, video, audio, documents, archives, notes, other) and sort by newest, name or size.
- **Table and list views**: Switch between the table and a list. Rooms with more than 24 items open in the list.
- **Save selected**: In the list, select several files and save them to a folder in one go. Names that are taken get a number, so nothing is overwritten.
- **Upload tray**: Each upload shows its progress and speed, and can be cancelled while it waits or sends, retried when it fails, and removed afterwards.
- **Room status**: The top bar shows the room's size and file count against its limits, the devices at the table and a room log. The room menu holds Show QR, Copy link, theme, keyboard shortcuts, About and Close room. Press `?` for the shortcut list.
- **Share links**: The bundled server, like the published Docker image, ships with public share links turned off, so the share button stays hidden. The desktop shows it automatically if a server enables them.
- **Executable warnings**: Files that could be programs or scripts are marked before you save them.
- **Limits**: Up to 100 files and 10 GiB per room, set by the bundled HAMAL server.
- **20 languages**: English, Turkish, Chinese, Hindi, Spanish, French, Arabic, Bengali, Portuguese, Russian, Urdu, Indonesian, German, Japanese, Marathi, Telugu, Dutch, Italian, Korean and Polish, with right-to-left layout for Arabic and Urdu.
- **Desktop theme and language**: HAMAL follows your desktop's light or dark theme and its language.
- **Updates**: Snap Store installs update automatically. Plain binary installs point you to the GitHub release page (see [Updates](#updates)).

Only the room creator, on this computer, can close a room early.

---

## Supported Platform & Architecture

- **Operating System**: Linux (Ubuntu, Debian, Fedora, Arch Linux, openSUSE, etc.)
- **Architecture**: **Linux x86-64 / AMD64**

---

## Installation & Quick Start

### Snap Store (recommended)

```bash
sudo snap install hamal
```

The snap is strictly confined and updates automatically through the Snap Store.

### Release binary

#### 1. Install runtime dependencies (Ubuntu / Debian)

The binary needs GTK 3 and WebKitGTK 4.1:

```bash
sudo apt update
sudo apt install -y libgtk-3-0 libwebkit2gtk-4.1-0
```

*For Fedora / RHEL:*
```bash
sudo dnf install gtk3 webkit2gtk4.1
```

*For Arch Linux:*
```bash
sudo pacman -S gtk3 webkit2gtk-4.1
```

#### 2. Run the application

Download the binary from the [release page](https://github.com/i1k3r/HAMAL-Linux/releases), make it executable and run it:

```bash
chmod +x HAMAL-Linux
./HAMAL-Linux
```

Other devices must be able to reach this computer on the port HAMAL picks at startup. If a firewall such as `ufw` is active, allow incoming connections from your local network.

---

## Desktop Integration (Optional)

To integrate HAMAL into your desktop application launcher and system menus:

```bash
# Install binary system-wide
sudo cp HAMAL-Linux /usr/local/bin/

# Install desktop shortcut
cp build/linux/hamal.desktop ~/.local/share/applications/

# Install scalable icon
mkdir -p ~/.local/share/icons/hicolor/scalable/apps/
cp build/linux/hamal.svg ~/.local/share/icons/hicolor/scalable/apps/hamal.svg
```

---

## Building from Source

### Prerequisites

- **Go**: 1.25 or newer (see `go.mod`)
- **HAMAL server module**: `go.mod` replaces `github.com/i1k3r/HAMAL` with `../HAMAL`, so check out [i1k3r/HAMAL](https://github.com/i1k3r/HAMAL) next to this repository at the commit `go.mod` records (`6fad72ec956e`)
- **Build Packages (Ubuntu / Debian)**:
  ```bash
  sudo apt install -y build-essential libgtk-3-dev libwebkit2gtk-4.1-dev pkg-config
  ```

### Version

The `VERSION` file is the single source of truth. `scripts/build.sh` injects it into the binary (`-ldflags -X main.AppVersion=v<VERSION>`), and `snap/snapcraft.yaml` sets the snap version from the same file. To release a new version, change `VERSION` only.

### Build Command

```bash
scripts/build.sh
```

This builds `./HAMAL-Linux` with the Wails production tags and WebKitGTK 4.1 (`desktop,production,webkit2_41`) and checks that the binary carries the version from `VERSION`. A plain `go build` without the script reports the version `dev`.

### Building the Snap

The snap builds the binary from source, so no prebuilt binary or `../HAMAL` checkout is needed:

```bash
snapcraft pack
```

The `hamal-server` part pulls i1k3r/HAMAL at the commit `go.mod` records, and the `hamal` part points the `replace` directive at that checkout and runs `scripts/build.sh` with Go 1.25 from the `go` snap. Launchpad builds the same way. The `Build and test` GitHub Actions workflow builds the snap from a clean checkout and uploads the `.snap` as a build artifact for review. It does not publish to the Snap Store.

Before publishing a snap, install it on a real Ubuntu machine and run the checks in [docs/snap-smoke-test.md](docs/snap-smoke-test.md).

### Running Tests

```bash
go test -v ./...
go vet ./...
node scripts/check-i18n.mjs
scripts/check-css-parity.sh   # the room CSS is the reference lighttable.css, unchanged

# Parity with the HAMAL Docker reference (a reference server on port 7700)
HAMAL_REFERENCE_URL=http://127.0.0.1:7700 go test -run TestParityWithReferenceServer -v .
```

### Updates

- **Snap Store installs** are updated by snapd's automatic refresh. The app does not check GitHub and never shows an update notice.
- **Plain binary installs** check GitHub Releases at startup and, when a newer release exists, offer to open the release page. HAMAL never downloads or replaces its own executable.

---

## Storage

HAMAL keeps room data (a small database and the files on room tables) in `$XDG_DATA_HOME/HAMAL`, which is `~/.local/share/HAMAL` by default. The snap keeps it inside the snap's own data area, `~/snap/hamal/current/.local/share/HAMAL`. Files are deleted when their room expires or is closed.

---

## Responsible Use

HAMAL is intended solely for lawful, authorized local file transfer. Users are responsible for ensuring that shared content complies with applicable local laws and network usage policies.

---

## License

HAMAL is source-available software licensed under the
[HAMAL Source-Available Organizational Use License](LICENSE).

Organizations may freely use, modify, fork, and deploy HAMAL for their own
internal operations, including commercial business operations.

Commercial redistribution, resale, productization, and offering HAMAL or
derivative works as a commercial service require separate permission from
the copyright holder.
