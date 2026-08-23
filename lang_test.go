package main

import (
	"os"
	"testing"
)

func TestLanguageMappingAndSystemLanguage(t *testing.T) {
	testCases := []struct {
		input    string
		expected string
	}{
		{"en", "en"},
		{"en-US", "en"},
		{"en-GB", "en"},
		{"tr", "tr"},
		{"tr-TR", "tr"},
		{"tr_TR.UTF-8", "tr"},
		{"zh-CN", "zh-CN"},
		{"zh_CN.UTF-8", "zh-CN"},
		{"zh-Hans-CN", "zh-CN"},
		{"zh", "zh-CN"},
		{"hi", "hi"},
		{"hi-IN", "hi"},
		{"es", "es"},
		{"es-ES", "es"},
		{"es-MX", "es"},
		{"fr", "fr"},
		{"fr-FR", "fr"},
		{"fr-CA", "fr"},
		{"ar", "ar"},
		{"ar-SA", "ar"},
		{"ar-EG", "ar"},
		{"bn", "bn"},
		{"bn-BD", "bn"},
		{"bn-IN", "bn"},
		{"pt", "pt"},
		{"pt-BR", "pt"},
		{"pt-PT", "pt"},
		{"ru", "ru"},
		{"ru-RU", "ru"},
		{"ur", "ur"},
		{"ur-PK", "ur"},
		{"id", "id"},
		{"id-ID", "id"},
		{"in-ID", "id"},
		{"de", "de"},
		{"de-DE", "de"},
		{"de-AT", "de"},
		{"ja", "ja"},
		{"ja-JP", "ja"},
		{"mr", "mr"},
		{"mr-IN", "mr"},
		{"te", "te"},
		{"te-IN", "te"},
		{"nl", "nl"},
		{"nl-NL", "nl"},
		{"nl-BE", "nl"},
		{"it", "it"},
		{"it-IT", "it"},
		{"it-CH", "it"},
		{"ko", "ko"},
		{"ko-KR", "ko"},
		{"pl", "pl"},
		{"pl-PL", "pl"},
		// Fallbacks
		{"", "en"},
		{"unknown-locale", "en"},
		{"xx-YY", "en"},
	}

	for _, tc := range testCases {
		res := MapLocaleToSupported(tc.input)
		if res != tc.expected {
			t.Errorf("MapLocaleToSupported(%q) = %q, expected %q", tc.input, res, tc.expected)
		}
	}

	// Verify GetSystemLanguage() returns a valid non-empty supported locale
	sysLang := GetSystemLanguage()
	if sysLang == "" {
		t.Fatal("expected non-empty system language")
	}

	app := NewApp()
	appLang := app.GetSystemLanguage()
	if appLang != sysLang {
		t.Fatalf("expected App.GetSystemLanguage() to match %q, got %q", sysLang, appLang)
	}
}

func TestEnvironmentLanguageParsing(t *testing.T) {
	origLang := os.Getenv("LANG")
	origLcAll := os.Getenv("LC_ALL")
	origLanguage := os.Getenv("LANGUAGE")
	defer func() {
		if origLang != "" {
			os.Setenv("LANG", origLang)
		} else {
			os.Unsetenv("LANG")
		}
		if origLcAll != "" {
			os.Setenv("LC_ALL", origLcAll)
		} else {
			os.Unsetenv("LC_ALL")
		}
		if origLanguage != "" {
			os.Setenv("LANGUAGE", origLanguage)
		} else {
			os.Unsetenv("LANGUAGE")
		}
	}()

	os.Setenv("LC_ALL", "tr_TR.UTF-8")
	// On Linux, GetSystemLanguage() should return "tr"
	mapped := MapLocaleToSupported(os.Getenv("LC_ALL"))
	if mapped != "tr" {
		t.Fatalf("expected 'tr', got %q", mapped)
	}

	os.Setenv("LC_ALL", "zh_CN.UTF-8")
	mappedZh := MapLocaleToSupported(os.Getenv("LC_ALL"))
	if mappedZh != "zh-CN" {
		t.Fatalf("expected 'zh-CN', got %q", mappedZh)
	}

	os.Setenv("LC_ALL", "de_DE.UTF-8@euro")
	mappedDe := MapLocaleToSupported(os.Getenv("LC_ALL"))
	if mappedDe != "de" {
		t.Fatalf("expected 'de', got %q", mappedDe)
	}
}
