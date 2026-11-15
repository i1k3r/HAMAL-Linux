package main

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// readVersionFile returns the VERSION file's content, which must be a plain X.Y.Z version.
func readVersionFile(t *testing.T) string {
	t.Helper()
	raw, err := os.ReadFile("VERSION")
	if err != nil {
		t.Fatalf("read VERSION: %v", err)
	}
	v := strings.TrimSpace(string(raw))
	if !regexp.MustCompile(`^\d+\.\d+\.\d+$`).MatchString(v) {
		t.Fatalf("VERSION must be a plain X.Y.Z version without a v prefix, got %q", v)
	}
	if _, err := ParseVersion(v); err != nil {
		t.Fatalf("VERSION is not a valid version: %v", err)
	}
	return v
}

func TestVersionFileIsTheOnlyVersionSource(t *testing.T) {
	readVersionFile(t)

	// The snap takes its version from VERSION through adopt-info, never from a literal.
	snap, err := os.ReadFile(filepath.Join("snap", "snapcraft.yaml"))
	if err != nil {
		t.Fatalf("read snapcraft.yaml: %v", err)
	}
	if regexp.MustCompile(`(?m)^version:`).Match(snap) {
		t.Error("snap/snapcraft.yaml hardcodes a version; it must use adopt-info and the VERSION file")
	}
	if !regexp.MustCompile(`(?m)^adopt-info:\s*hamal\s*$`).Match(snap) {
		t.Error("snap/snapcraft.yaml must set adopt-info: hamal")
	}
	if !strings.Contains(string(snap), "craftctl set version=") {
		t.Error("snap/snapcraft.yaml must set the snap version from VERSION with craftctl")
	}

	// The build script injects the same file into the binary.
	build, err := os.ReadFile(filepath.Join("scripts", "build.sh"))
	if err != nil {
		t.Fatalf("read scripts/build.sh: %v", err)
	}
	if !strings.Contains(string(build), "-X main.AppVersion=") {
		t.Error("scripts/build.sh must inject AppVersion with -ldflags -X")
	}

	// No hardcoded release versions in Go sources or the frontend.
	literal := regexp.MustCompile(`v?\d+\.\d+\.\d+`)
	goFiles, _ := filepath.Glob("*.go")
	for _, f := range goFiles {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		src, _ := os.ReadFile(f)
		for _, line := range strings.Split(string(src), "\n") {
			if strings.Contains(line, "AppVersion =") && literal.MatchString(line) {
				t.Errorf("%s hardcodes the app version: %s", f, strings.TrimSpace(line))
			}
		}
	}
	for _, f := range []string{"frontend/src/index.html", "frontend/src/main.js"} {
		src, _ := os.ReadFile(f)
		if m := regexp.MustCompile(`\bv0\.\d+\.\d+\b`).Find(src); m != nil {
			t.Errorf("%s hardcodes a version (%s); the UI must ask GetAppVersion()", f, m)
		}
	}
}
