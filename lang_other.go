//go:build !linux

package main

import (
	"strings"
)

// MapLocaleToSupported maps a language code / locale tag to one of the supported HAMAL locales.
func MapLocaleToSupported(loc string) string {
	loc = strings.TrimSpace(loc)
	if loc == "" {
		return "en"
	}

	if idx := strings.Index(loc, "."); idx != -1 {
		loc = loc[:idx]
	}
	if idx := strings.Index(loc, "@"); idx != -1 {
		loc = loc[:idx]
	}

	normalized := strings.ToLower(strings.ReplaceAll(loc, "_", "-"))
	if strings.HasPrefix(normalized, "zh") {
		return "zh-CN"
	}

	parts := strings.Split(normalized, "-")
	base := parts[0]

	switch base {
	case "tr":
		return "tr"
	case "en":
		return "en"
	case "hi":
		return "hi"
	case "es":
		return "es"
	case "fr":
		return "fr"
	case "ar":
		return "ar"
	case "bn":
		return "bn"
	case "pt":
		return "pt"
	case "ru":
		return "ru"
	case "ur":
		return "ur"
	case "id", "in":
		return "id"
	case "de":
		return "de"
	case "ja":
		return "ja"
	case "mr":
		return "mr"
	case "te":
		return "te"
	case "nl":
		return "nl"
	case "it":
		return "it"
	case "ko":
		return "ko"
	case "pl":
		return "pl"
	default:
		return "en"
	}
}

// GetSystemLanguage returns fallback language for non-Linux platforms.
func GetSystemLanguage() string {
	return "en"
}
