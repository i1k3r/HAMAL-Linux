//go:build !linux

package main

import (
	"context"
)

// GetSystemTheme returns fallback theme for non-Linux platforms.
func GetSystemTheme() string {
	return "light"
}

// monitorSystemTheme is a no-op on non-Linux platforms.
func (a *App) monitorSystemTheme(ctx context.Context) {
}
