<div align="center">

<img src="frontend/src/brand/hamal-logo-light.svg#gh-light-mode-only" alt="HAMAL Logo Light" width="320" />
<img src="frontend/src/brand/hamal-logo-dark.svg#gh-dark-mode-only" alt="HAMAL Logo Dark" width="320" />

# HAMAL for Linux

**Fast, private, temporary file transfer.**

[![Platform](https://img.shields.io/badge/Platform-Linux%20x86--64-FCC624?logo=linux&logoColor=black)](https://github.com/i1k3r/HAMAL-Linux)
[![Packaging](https://img.shields.io/badge/Snap%20Store-Available-E95420?logo=snapcraft&logoColor=white)](https://snapcraft.io/hamal)
[![Go](https://img.shields.io/badge/Go-1.25+-00ADD8?logo=go&logoColor=white)](https://go.dev/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

</div>

---

## Overview

**HAMAL-Linux** is the official desktop application for Linux systems powered by the Linux-native HAMAL engine. It allows you to create temporary transfer rooms on your local network, enabling phones, tablets, and computers to upload and download files at full wire speed without routing data through third-party servers.

### Core Features

- **Point-to-Point Local Transfers**: Files stream directly across your local network (Wi-Fi or Ethernet) at gigabit speeds with zero cloud relay.
- **No Cloud Storage**: Data exists solely in memory and local temporary storage on your machine during the transfer lifecycle.
- **QR-Based Room Joining**: Participants simply scan a high-contrast QR code or open a local LAN URL to connect immediately without app installation.
- **Temporary Rooms & Lifespans**: Provision rooms with customizable time-to-live (5 minutes up to 24 hours).
- **Automatic Expiration & Purge**: When a room expires or is closed, all stored files, buffers, and metadata are permanently and securely deleted.
- **Optional Participant PIN**: Protect transfers with an optional 4–8 character PIN code to prevent unauthorized access on shared networks.
- **Participant Close Room**: Connected mobile clients can close the room directly from their phone when the exchange is finished.
- **Server-Authoritative Room Closing**: Coordinated 10-second countdown lifecycle ensuring graceful termination and state synchronization across creator and participants.
- **Visual File Type Icons & Warnings**: Pixel-art SVG file-type badges and safety indicators for potentially executable binaries.
- **20-Language Localization**: Full native translations for English, Turkish, Chinese, Hindi, Spanish, French, Arabic, Bengali, Portuguese, Russian, Urdu, Indonesian, German, Japanese, Marathi, Telugu, Dutch, Italian, Korean, and Polish (including RTL layout support).
- **System Theme & Language Detection**: Automatically inherits your desktop's dark/light color scheme and system locale.
- **Responsible Use Gate**: Integrated safety and regulatory acknowledgement for transparent, secure usage.

---

## Supported Platform & Architecture

- **Operating System**: Linux (Ubuntu, Debian, Fedora, Arch Linux, openSUSE, etc.)
- **Architecture**: **Linux x86-64 / AMD64**

---

## Installation & Quick Start

### 1. Install Runtime Dependencies (Ubuntu / Debian)

HAMAL-Linux requires GTK3 and WebKit2GTK 4.1:

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

### 2. Run the Application

Download the release binary, grant execute permissions, and run:

```bash
chmod +x HAMAL-Linux
./HAMAL-Linux
```

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
- **HAMAL server module**: `go.mod` replaces `github.com/i1k3r/HAMAL` with `../HAMAL`, so check out [i1k3r/HAMAL](https://github.com/i1k3r/HAMAL) next to this repository at the commit `go.mod` records (`0072645cba81`)
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

Build the binary first, then pack it:

```bash
scripts/build.sh
snapcraft pack
```

The `Build and test` GitHub Actions workflow does the same on Ubuntu 24.04 and uploads the `.snap` as a build artifact for review. It does not publish to the Snap Store.

### Running Tests

```bash
go test -v ./...
go vet ./...
node scripts/check-i18n.mjs
```

### Updates

- **Snap Store installs** are updated by snapd's automatic refresh. The app does not check GitHub and never shows an update notice.
- **Plain binary installs** check GitHub Releases at startup and, when a newer release exists, offer to open the release page. HAMAL never downloads or replaces its own executable.

---

## Storage & XDG Compliance

HAMAL-Linux strictly complies with the XDG Base Directory Specification:
- **Data Directory**: `$XDG_DATA_HOME/HAMAL` (default: `~/.local/share/HAMAL`)
- **Config Directory**: `$XDG_CONFIG_HOME/HAMAL` (default: `~/.config/HAMAL`)

---

## Responsible Use

HAMAL is intended solely for lawful, authorized peer-to-peer data synchronization and local file delivery. Users are responsible for ensuring that shared content complies with applicable local laws and network usage policies.

---

## License

HAMAL is source-available software licensed under the
[HAMAL Source-Available Organizational Use License](LICENSE).

Organizations may freely use, modify, fork, and deploy HAMAL for their own
internal operations, including commercial business operations.

Commercial redistribution, resale, productization, and offering HAMAL or
derivative works as a commercial service require separate permission from
the copyright holder.
