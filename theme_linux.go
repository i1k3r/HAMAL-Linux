//go:build linux

package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// GetSystemTheme detects the current Linux system theme ("light" or "dark").
// Detection priority:
//  1. XDG Desktop Portal color-scheme (D-Bus / busctl)
//  2. GNOME / GTK gsettings color-scheme & gtk-theme
//  3. KDE Plasma kdeglobals
//  4. GTK_THEME environment variable
//  5. Default fallback: "light"
func GetSystemTheme() string {
	// 1. Check XDG Desktop Portal color-scheme via busctl or dbus-send if available
	if theme, ok := checkPortalColorScheme(); ok {
		return theme
	}

	// 2. Check GNOME/GTK gsettings
	if theme, ok := checkGsettingsTheme(); ok {
		return theme
	}

	// 3. Check KDE kdeglobals config
	if theme, ok := checkKdeTheme(); ok {
		return theme
	}

	// 4. Check GTK_THEME environment variable
	gtkTheme := strings.ToLower(os.Getenv("GTK_THEME"))
	if strings.Contains(gtkTheme, "dark") {
		return "dark"
	}

	return "light"
}

// checkPortalColorScheme queries the XDG Settings portal for color-scheme.
// Returns (theme, true) if successfully resolved, where:
// 1 = prefer-dark, 2 = prefer-light, 0 = no-preference
func checkPortalColorScheme() (string, bool) {
	cmd := exec.Command("busctl", "--user", "call",
		"org.freedesktop.portal.Desktop",
		"/org/freedesktop/portal/desktop",
		"org.freedesktop.portal.Settings",
		"Read", "ss",
		"org.freedesktop.appearance", "color-scheme")

	output, err := cmd.Output()
	if err == nil {
		outStr := string(output)
		if strings.Contains(outStr, "uint32 1") || strings.Contains(outStr, "u 1") || strings.Contains(outStr, "1") {
			return "dark", true
		}
		if strings.Contains(outStr, "uint32 2") || strings.Contains(outStr, "u 2") {
			return "light", true
		}
	}
	return "", false
}

// checkGsettingsTheme queries gsettings for GNOME color-scheme or gtk-theme.
func checkGsettingsTheme() (string, bool) {
	cmd := exec.Command("gsettings", "get", "org.gnome.desktop.interface", "color-scheme")
	output, err := cmd.Output()
	if err == nil {
		val := strings.ToLower(strings.TrimSpace(string(output)))
		if strings.Contains(val, "prefer-dark") {
			return "dark", true
		}
		if strings.Contains(val, "prefer-light") {
			return "light", true
		}
	}

	// Fallback to gtk-theme name
	cmd2 := exec.Command("gsettings", "get", "org.gnome.desktop.interface", "gtk-theme")
	output2, err2 := cmd2.Output()
	if err2 == nil {
		val2 := strings.ToLower(strings.TrimSpace(string(output2)))
		if strings.Contains(val2, "dark") {
			return "dark", true
		}
		if val2 != "" {
			return "light", true
		}
	}

	return "", false
}

// checkKdeTheme inspects KDE's kdeglobals configuration for dark color scheme.
func checkKdeTheme() (string, bool) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", false
	}

	kdeGlobalsPath := filepath.Join(home, ".config", "kdeglobals")
	data, err := os.ReadFile(kdeGlobalsPath)
	if err != nil {
		return "", false
	}

	content := strings.ToLower(string(data))
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "colorscheme=") || strings.HasPrefix(line, "theme=") {
			if strings.Contains(line, "dark") || strings.Contains(line, "black") {
				return "dark", true
			}
			return "light", true
		}
	}

	return "", false
}

// monitorSystemTheme periodically checks for Linux system theme changes and emits Wails runtime events.
func (a *App) monitorSystemTheme(ctx context.Context) {
	lastTheme := GetSystemTheme()
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			newTheme := GetSystemTheme()
			if newTheme != lastTheme {
				lastTheme = newTheme
				if a.ctx != nil {
					runtime.EventsEmit(a.ctx, "system-theme-changed", newTheme)
				}
			}
		}
	}
}
