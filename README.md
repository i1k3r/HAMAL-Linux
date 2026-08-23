# HAMAL for Linux · Creator Dispatch

<div align="center">
  <img src="frontend/src/brand/hamal-logo-light.svg#gh-light-mode-only" alt="HAMAL Logo Light" width="320">
  <img src="frontend/src/brand/hamal-logo-dark.svg#gh-dark-mode-only" alt="HAMAL Logo Dark" width="320">
  <br/><br/>
  <p><strong>Point-to-point, private, ephemeral local network file transfer for Linux desktops.</strong></p>
  <p>Visual and functional twin of HAMAL-Windows powered by the Linux-native HAMAL engine.</p>
</div>

---

## Overview

**HAMAL-Linux** brings the high-performance local network courier experience to Linux desktops with complete visual and interactive parity to HAMAL-Windows.

- **Zero Cloud**: Transfers stream directly over your local Wi-Fi / Ethernet at wire speed.
- **Ephemeral Rooms**: Provision temporary rooms with configurable lifespan (5 minutes to 24 hours) and optional participant PIN codes.
- **Auto-Expiring & Safe Purge**: All uploaded files and metadata are permanently removed upon expiration or when closed.
- **Visual Clone of HAMAL-Windows**: Identical typography, dark/light themes, animations, creator dispatch cards, dropzone, and newest-first file management.
- **Complete Localization**: Full support for all 20 locales with native RTL layout handling.
- **Linux-Native Engine**: Directly integrates `github.com/i1k3r/HAMAL` and adheres to XDG directory specifications.

---

## Architecture

```
HAMAL-Windows Frontend (Visual Source of Truth)
                    │
   ┌────────────────┴────────────────┐
   │                                 │
HAMAL-Windows                  HAMAL-Linux
(Windows API Backend)          (Linux-Native HAMAL Engine)
```

- **Frontend**: Single-page desktop app built with modern HTML5, CSS custom properties, and JavaScript.
- **Desktop Host**: [Wails v2](https://wails.io) bridging Go to the WebKitGTK webview.
- **Engine**: In-process HAMAL backend listening on dynamic TCP port with automated LAN IP discovery, streaming multipart file pipes, and periodic cleanup workers.
- **Storage**: Fully compliant with XDG Base Directory Specification:
  - Data: `$XDG_DATA_HOME/HAMAL` (fallback: `~/.local/share/HAMAL`)
  - Config: `$XDG_CONFIG_HOME/HAMAL` (fallback: `~/.config/HAMAL`)

---

## Building from Source

### Prerequisites

- **Go**: 1.23 or newer
- **Wails CLI**: `go install github.com/wailsapp/wails/v2/cmd/wails@latest`
- **Linux Packages** (Ubuntu/Debian):
  ```bash
  sudo apt install build-essential libgtk-3-dev libwebkit2gtk-4.0-dev
  ```

### Build Command

To build the native Linux binary:

```bash
# Using Wails
wails build

# Or using Go directly
go build -v -o build/bin/HAMAL-Linux .
```

### Running Tests

```bash
go test -v ./...
go vet ./...
```

---

## Desktop Integration

To integrate HAMAL into your Linux desktop application launcher:

```bash
# Copy binary
sudo cp build/bin/HAMAL-Linux /usr/local/bin/

# Copy desktop file
cp build/linux/hamal.desktop ~/.local/share/applications/

# Copy icon
mkdir -p ~/.local/share/icons/hicolor/scalable/apps/
cp build/linux/hamal.svg ~/.local/share/icons/hicolor/scalable/apps/hamal.svg
```

---

## License

[MIT License](LICENSE) © 2026 i1k3r
