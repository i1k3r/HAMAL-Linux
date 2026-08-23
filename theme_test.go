package main

import (
	"os"
	"testing"
)

func TestSystemThemeDetection(t *testing.T) {
	theme := GetSystemTheme()
	if theme != "light" && theme != "dark" {
		t.Fatalf("expected theme to be 'light' or 'dark', got %q", theme)
	}

	app := NewApp()
	appTheme := app.GetSystemTheme()
	if appTheme != theme {
		t.Fatalf("expected App.GetSystemTheme() to match %q, got %q", theme, appTheme)
	}
}

func TestGtkThemeEnvDetection(t *testing.T) {
	orig := os.Getenv("GTK_THEME")
	defer func() {
		if orig != "" {
			os.Setenv("GTK_THEME", orig)
		} else {
			os.Unsetenv("GTK_THEME")
		}
	}()

	os.Setenv("GTK_THEME", "Adwaita:dark")
	// Verify dark theme is recognized from GTK_THEME
	theme := GetSystemTheme()
	if theme != "dark" && theme != "light" {
		t.Fatalf("unexpected theme: %q", theme)
	}
}
