package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const (
	// DefaultReleaseAPIURL is the public GitHub Releases API endpoint for HAMAL-Linux.
	DefaultReleaseAPIURL = "https://api.github.com/repos/i1k3r/HAMAL-Linux/releases/latest"

	// ExpectedAssetNamePrefix is the release asset prefix for Linux builds.
	ExpectedAssetNamePrefix = "HAMAL-Linux"
)

// GitHubAsset represents a single asset attached to a GitHub release.
type GitHubAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Size               int64  `json:"size"`
	ContentType        string `json:"content_type"`
}

// GitHubRelease represents the GitHub latest release API response.
type GitHubRelease struct {
	TagName string        `json:"tag_name"`
	Name    string        `json:"name"`
	Body    string        `json:"body"`
	HTMLURL string        `json:"html_url"`
	Assets  []GitHubAsset `json:"assets"`
}

// UpdateInfo contains details about available updates for the UI.
type UpdateInfo struct {
	Available      bool   `json:"available"`
	CurrentVersion string `json:"currentVersion"`
	LatestVersion  string `json:"latestVersion"`
	AssetURL       string `json:"assetUrl"`
	AssetSize      int64  `json:"assetSize"`
	ReleaseNotes   string `json:"releaseNotes"`
	ReleaseURL     string `json:"releaseUrl"`
	ErrorMessage   string `json:"errorMessage,omitempty"`
}

// UpdaterController manages checking for application updates.
type UpdaterController struct {
	httpClient *http.Client
}

// NewUpdaterController creates a new UpdaterController instance.
func NewUpdaterController() *UpdaterController {
	return &UpdaterController{
		httpClient: &http.Client{
			Timeout: 15 * time.Second,
		},
	}
}

// CheckForUpdates queries GitHub latest release API and returns UpdateInfo.
func (u *UpdaterController) CheckForUpdates(ctx context.Context, apiURL string, currentVersion string) (UpdateInfo, error) {
	if apiURL == "" {
		apiURL = DefaultReleaseAPIURL
	}

	info := UpdateInfo{
		Available:      false,
		CurrentVersion: currentVersion,
	}

	// 1. Validate API URL scheme
	parsedURL, err := url.Parse(apiURL)
	if err != nil {
		return info, fmt.Errorf("invalid release API URL: %w", err)
	}

	isLocal := parsedURL.Hostname() == "127.0.0.1" || parsedURL.Hostname() == "localhost"
	if parsedURL.Scheme != "https" && !isLocal {
		return info, errors.New("release API URL must use HTTPS")
	}

	// 2. Perform GET request to GitHub Releases API
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return info, fmt.Errorf("failed to create update request: %w", err)
	}

	req.Header.Set("Accept", "application/vnd.github.v3+json")
	req.Header.Set("User-Agent", fmt.Sprintf("HAMAL-Linux-Updater/%s", strings.TrimPrefix(currentVersion, "v")))

	resp, err := u.httpClient.Do(req)
	if err != nil {
		return info, fmt.Errorf("update check request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return info, fmt.Errorf("release API returned HTTP %d", resp.StatusCode)
	}

	var release GitHubRelease
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return info, fmt.Errorf("failed to parse release metadata: %w", err)
	}

	// 3. Verify semantic version and compare with current
	if !IsUpdateAvailable(currentVersion, release.TagName) {
		info.LatestVersion = release.TagName
		return info, nil
	}

	// 4. Find matching Linux asset if attached, or point to release URL
	var targetAsset *GitHubAsset
	for i := range release.Assets {
		asset := &release.Assets[i]
		if strings.HasPrefix(asset.Name, ExpectedAssetNamePrefix) {
			targetAsset = asset
			break
		}
	}

	info.Available = true
	info.LatestVersion = release.TagName
	info.ReleaseNotes = release.Body
	info.ReleaseURL = release.HTMLURL

	if targetAsset != nil {
		info.AssetURL = targetAsset.BrowserDownloadURL
		info.AssetSize = targetAsset.Size
	} else {
		info.AssetURL = release.HTMLURL
	}

	return info, nil
}

// CalculateFileSHA256 computes the SHA-256 checksum of a file.
func CalculateFileSHA256(filePath string) (string, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}

	return hex.EncodeToString(h.Sum(nil)), nil
}
