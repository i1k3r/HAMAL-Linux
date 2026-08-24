# HAMAL — Snap Store Listing Artwork & Visual Assets

This directory contains the official marketing screenshots and featured banner for **HAMAL-Linux** on the Ubuntu App Center / Snap Store.

All visual assets were captured directly from the actual running HAMAL application and follow the Dieter Rams / Braun-inspired dark technical visual language with signature warm amber (`#D97706` / `#F59E0B`) accents.

---

## Asset Directory Structure

```text
snap-store-assets/
├── banner/
│   └── hamal-featured-banner.png       # 2160 × 720 px (3:1 standard Snap Store banner)
├── screenshots/
│   ├── hamal-linux-01-creator.png      # 1920 × 1080 px (Creator Setup & Room Provisioning)
│   ├── hamal-linux-02-transfer.png     # 1920 × 1080 px (Active Transfer Room & QR Code)
│   ├── hamal-linux-03-participant.png  # 1080 × 1920 px (Participant Mobile Web Interface)
│   └── hamal-linux-04-files.png        # 1920 × 1080 px (Gigabit Wire-Speed Streaming & Activity)
└── README.md
```

---

## 1. Screenshots Overview

| File | Resolution | Size | Role / Description |
| :--- | :--- | :--- | :--- |
| **`hamal-linux-02-transfer.png`** | **1920 × 1080** | **~67 KB** | **PRIMARY SCREENSHOT (Recommended)**<br>Shows the core HAMAL desktop experience: active room countdown, high-contrast QR code for device pairing, PIN protection, local IP link with one-click copy, drag-and-drop dropzone, and multi-format files in room with pixel-art file icons (`.pdf`, `.zip`, `.png`, `.sh` executable warning indicator). |
| **`hamal-linux-01-creator.png`** | **1920 × 1080** | **~64 KB** | **Setup & Feature Overview**<br>Demonstrates the creator room initialization screen with lifespan selector (TTL: 5m to 24h), optional participant PIN code, and the 3-step ephemeral transfer workflow. |
| **`hamal-linux-03-participant.png`** | **1080 × 1920** | **~105 KB** | **Mobile Web Participant Interface**<br>Demonstrates the responsive mobile web interface opened by scanning the QR code: live room status, countdown timer, active peer count, file upload dropzone, files in room with green "İndirildi" / "Saved" download state, and restrained bottom room-close button. |
| **`hamal-linux-04-files.png`** | **1920 × 1080** | **~61 KB** | **High-Speed Transfer Activity**<br>Demonstrates direct peer-to-peer LAN file streaming in progress (`4k_production_b_roll.mp4` at 94.2 MB/s wire speed), progress indicator, active peer count, and delivered file badges. |

---

## 2. Featured Banner

| File | Dimensions | Aspect Ratio | Size |
| :--- | :--- | :--- | :--- |
| **`hamal-featured-banner.png`** | **2160 × 720 px** | **3:1** | **~126 KB** |

* **Headline**: *"Fast, private, temporary file transfer."*
* **Tagline**: *"Transfer documents, media, and folders directly across devices on your local network. Zero cloud storage, instantaneous QR code connection, and automatic expiration."*
* **Key Feature Highlights**:
  * `Full LAN Wire Speed`
  * `Zero Cloud Storage`
  * `Instant QR Pair`
  * `Auto-Purge`
* **Composition**: Side-by-side elevation combining the desktop creator dispatch window and mobile participant interface over a subtle technical grid backdrop with dark amber radial glow.

---

## 3. Snap Store Compliance & Specifications

* **Supported Formats**: PNG (lossless, optimized).
* **File Size Constraint**: All images are well below the Snap Store limit (< 200 KB each, maximum limit is 2 MB).
* **Aspect Ratios**: 16:9 for desktop screenshots, 9:16 for mobile interface, 3:1 for featured banner.
* **Content Safety**: All UI elements maintain comfortable safety margins from the canvas edges to avoid cropping on varying store viewport sizes.
