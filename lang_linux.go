//go:build linux

package main

import (
	"os"
	"strings"
)

// MapLocaleToSupported maps a language code / locale tag to one of the supported HAMAL locales.
// Supported: en, zh-CN, hi, es, fr, ar, bn, pt, ru, ur, id, de, ja, mr, te, tr, nl, it, ko, pl.
// Fallback: en.
func MapLocaleToSupported(loc string) string {
	loc = strings.TrimSpace(loc)
	if loc == "" {
		return "en"
	}

	// Remove charset or modifiers like .UTF-8, @euro
	if idx := strings.Index(loc, "."); idx != -1 {
		loc = loc[:idx]
	}
	if idx := strings.Index(loc, "@"); idx != -1 {
		loc = loc[:idx]
	}

	normalized := strings.ToLower(strings.ReplaceAll(loc, "_", "-"))

	// Chinese dialect matches
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

// GetSystemLanguage detects the Linux user's preferred display/UI language.
func GetSystemLanguage() string {
	envVars := []string{"LC_ALL", "LC_MESSAGES", "LANG", "LANGUAGE"}
	for _, env := range envVars {
		val := os.Getenv(env)
		if val == "" || val == "C" || val == "POSIX" {
			continue
		}
		// In LANGUAGE, multiple colon-separated locales may exist (e.g. "de_DE:en_US")
		for _, item := range strings.Split(val, ":") {
			item = strings.TrimSpace(item)
			if item == "" || item == "C" || item == "POSIX" {
				continue
			}
			mapped := MapLocaleToSupported(item)
			if mapped != "en" {
				return mapped
			}
			if strings.HasPrefix(strings.ToLower(item), "en") {
				return "en"
			}
		}
	}

	return "en"
}
