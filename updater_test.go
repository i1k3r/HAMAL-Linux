package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestSemanticVersionComparison(t *testing.T) {
	testCases := []struct {
		current  string
		latest   string
		expected bool // true if update should be available
	}{
		// 1. Same version -> no update
		{"v0.8.0", "v0.8.0", false},
		{"0.8.0", "0.8.0", false},
		{"v1.0.0", "v1.0.0", false},
		{"v0.8.0", "0.8.0", false},

		// 2. Older current version -> update available
		{"v0.8.0", "v0.8.1", true},
		{"v0.8.0", "v0.9.0", true},
		{"v0.8.1", "v0.9.0", true},
		{"v0.9.0", "v1.0.0", true},
		{"v0.8.0", "v1.0.0", true},
		{"0.8.0", "0.8.1", true},
		{"v0.8.0", "v0.8.0-beta", false}, // prerelease not higher

		// 3. Newer current version -> no update
		{"v0.8.1", "v0.8.0", false},
		{"v0.9.0", "v0.8.0", false},
		{"v1.0.0", "v0.8.0", false},
		{"v1.0.0", "v0.9.9", false},
		{"v2.0.0", "v1.9.9", false},

		// 4. Invalid versions -> safely ignored (no panic, false)
		{"", "v0.8.1", false},
		{"v0.8.0", "", false},
		{"invalid", "v0.8.1", false},
		{"v0.8.0", "not-a-version", false},
		{"v0.8.0", "v1.0", false},
		{"v0.8.0", "abc.def.ghi", false},
	}

	for _, tc := range testCases {
		avail := IsUpdateAvailable(tc.current, tc.latest)
		if avail != tc.expected {
			t.Errorf("IsUpdateAvailable(%q, %q) = %v, expected %v", tc.current, tc.latest, avail, tc.expected)
		}
	}
}

func TestCheckForUpdatesWithMockServer(t *testing.T) {
	updater := NewUpdaterController()
	ctx := context.Background()

	// 1. Successful newer release with HAMAL-Linux asset
	serverSuccess := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		release := GitHubRelease{
			TagName: "v0.8.1",
			Name:    "HAMAL-Linux v0.8.1",
			Body:    "Linux release: Bug fixes and improvements",
			HTMLURL: "https://github.com/i1k3r/HAMAL-Linux/releases/tag/v0.8.1",
			Assets: []GitHubAsset{
				{
					Name:               "HAMAL-Linux",
					BrowserDownloadURL: "http://127.0.0.1/HAMAL-Linux",
					Size:               15000000,
					ContentType:        "application/octet-stream",
				},
			},
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(release)
	}))
	defer serverSuccess.Close()

	info, err := updater.CheckForUpdates(ctx, serverSuccess.URL, "v0.8.0")
	if err != nil {
		t.Fatalf("unexpected error on valid release check: %v", err)
	}
	if !info.Available {
		t.Fatal("expected update to be available for v0.8.0 -> v0.8.1")
	}
	if info.LatestVersion != "v0.8.1" {
		t.Fatalf("expected latest version 'v0.8.1', got %q", info.LatestVersion)
	}
	if info.AssetURL != "http://127.0.0.1/HAMAL-Linux" {
		t.Fatalf("expected asset URL, got %q", info.AssetURL)
	}
	if info.AssetSize != 15000000 {
		t.Fatalf("expected asset size 15000000, got %d", info.AssetSize)
	}

	// 2. Same version in release -> Available: false
	infoSame, err := updater.CheckForUpdates(ctx, serverSuccess.URL, "v0.8.1")
	if err != nil {
		t.Fatalf("unexpected error on same version check: %v", err)
	}
	if infoSame.Available {
		t.Fatal("expected update to NOT be available for same version v0.8.1 == v0.8.1")
	}

	// 3. Newer version currently running -> Available: false
	infoNewer, err := updater.CheckForUpdates(ctx, serverSuccess.URL, "v0.9.0")
	if err != nil {
		t.Fatalf("unexpected error on newer version check: %v", err)
	}
	if infoNewer.Available {
		t.Fatal("expected update to NOT be available when current is v0.9.0 > v0.8.1")
	}

	// 4. Release without asset -> uses release HTML URL
	serverNoAsset := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		release := GitHubRelease{
			TagName: "v0.8.1",
			Name:    "HAMAL-Linux v0.8.1",
			HTMLURL: "https://github.com/i1k3r/HAMAL-Linux/releases/tag/v0.8.1",
			Assets:  []GitHubAsset{},
		}
		_ = json.NewEncoder(w).Encode(release)
	}))
	defer serverNoAsset.Close()

	infoNoAsset, err := updater.CheckForUpdates(ctx, serverNoAsset.URL, "v0.8.0")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !infoNoAsset.Available {
		t.Fatal("expected Available: true even without direct asset (falls back to release URL)")
	}
	if infoNoAsset.AssetURL != "https://github.com/i1k3r/HAMAL-Linux/releases/tag/v0.8.1" {
		t.Fatalf("expected release HTML URL fallback, got %q", infoNoAsset.AssetURL)
	}

	// 5. Release API returns HTTP 404
	server404 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"message":"Not Found"}`, http.StatusNotFound)
	}))
	defer server404.Close()

	info404, err := updater.CheckForUpdates(ctx, server404.URL, "v0.8.0")
	if err == nil {
		t.Fatal("expected error for HTTP 404")
	}
	if info404.Available {
		t.Fatal("expected Available: false on HTTP 404")
	}

	// 6. Release API returns HTTP 500
	server500 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
	}))
	defer server500.Close()

	info500, err := updater.CheckForUpdates(ctx, server500.URL, "v0.8.0")
	if err == nil {
		t.Fatal("expected error for HTTP 500")
	}
	if info500.Available {
		t.Fatal("expected Available: false on HTTP 500")
	}

	// 7. Request Timeout -> fails safely
	timeoutCtx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	serverSlow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(300 * time.Millisecond)
		w.WriteHeader(http.StatusOK)
	}))
	defer serverSlow.Close()

	infoTimeout, err := updater.CheckForUpdates(timeoutCtx, serverSlow.URL, "v0.8.0")
	if err == nil {
		t.Fatal("expected timeout error")
	}
	if infoTimeout.Available {
		t.Fatal("expected Available: false on timeout")
	}
}

func TestFileSHA256Checksum(t *testing.T) {
	tempDir := t.TempDir()
	testFile := filepath.Join(tempDir, "test.bin")
	_ = os.WriteFile(testFile, []byte("HAMAL Linux v0.8.0"), 0644)

	checksum, err := CalculateFileSHA256(testFile)
	if err != nil {
		t.Fatalf("failed to calculate checksum: %v", err)
	}
	if checksum == "" {
		t.Fatal("expected non-empty SHA256 checksum")
	}
	if len(checksum) != 64 {
		t.Fatalf("expected 64 character hex string, got %d chars: %s", len(checksum), checksum)
	}
}

func TestAppVersionComesFromVersionFile(t *testing.T) {
	want := "v" + readVersionFile(t)
	app := NewApp()
	// Test binaries are built without -ldflags, so they report "dev"; a build that injects the
	// version must inject exactly the VERSION file.
	if got := app.GetAppVersion(); got != "dev" && got != want {
		t.Fatalf("GetAppVersion() = %q, want %q (from VERSION) or \"dev\"", got, want)
	}
	if IsUpdateAvailable("dev", "v99.0.0") {
		t.Fatal("a dev build must never report an available update")
	}
}

func TestSnapInstallDetection(t *testing.T) {
	t.Setenv("SNAP", "")
	t.Setenv("SNAP_NAME", "")
	if IsSnapInstall() {
		t.Fatal("expected a plain install without SNAP variables")
	}
	t.Setenv("SNAP", "/snap/hamal/x1")
	t.Setenv("SNAP_NAME", "hamal")
	if !IsSnapInstall() {
		t.Fatal("expected a snap install when snapd variables are set")
	}
	if !NewApp().IsSnapPackage() {
		t.Fatal("IsSnapPackage() should report the snap install to the UI")
	}
}

func TestSnapInstallNeverChecksGitHub(t *testing.T) {
	t.Setenv("SNAP", "/snap/hamal/x1")
	t.Setenv("SNAP_NAME", "hamal")

	app := NewApp()
	info := app.CheckForUpdates()
	if info.Available || info.LatestVersion != "" || info.ErrorMessage != "" {
		t.Fatalf("snap install should report no update without contacting GitHub, got %+v", info)
	}
	ok, msg := app.ApplyUpdate(ReleasesPageURLPrefix + "/tag/v99.0.0")
	if ok || msg == "" {
		t.Fatalf("ApplyUpdate must do nothing for snap installs, got (%v, %q)", ok, msg)
	}
}

func TestApplyUpdateOnlyOpensReleasePages(t *testing.T) {
	t.Setenv("SNAP", "")
	t.Setenv("SNAP_NAME", "")
	valid := []string{
		"https://github.com/i1k3r/HAMAL-Linux/releases",
		"https://github.com/i1k3r/HAMAL-Linux/releases/tag/v0.8.5",
	}
	invalid := []string{
		"",
		"http://github.com/i1k3r/HAMAL-Linux/releases/tag/v0.8.5",
		"https://github.com/i1k3r/HAMAL-Linux/releases.evil.example/x",
		"https://evil.example/i1k3r/HAMAL-Linux/releases",
		"https://user@github.com/i1k3r/HAMAL-Linux/releases",
		"https://github.com/someone/else/releases",
		"file:///etc/passwd",
	}
	for _, u := range valid {
		if !IsReleasePageURL(u) {
			t.Errorf("IsReleasePageURL(%q) = false, want true", u)
		}
	}
	for _, u := range invalid {
		if IsReleasePageURL(u) {
			t.Errorf("IsReleasePageURL(%q) = true, want false", u)
		}
	}
	// Without a Wails context nothing is opened, but an invalid URL is refused before that.
	if ok, msg := NewApp().ApplyUpdate("https://evil.example/"); ok || msg != "Not a HAMAL-Linux release page." {
		t.Fatalf("ApplyUpdate accepted a non-release URL: (%v, %q)", ok, msg)
	}
}
