package main

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// AppVersion is the application version. The VERSION file at the repository root is the single
// source of truth; release builds inject it at link time:
//
//	go build -ldflags "-X main.AppVersion=v$(cat VERSION)"
//
// scripts/build.sh and snap/snapcraft.yaml both do this, so the binary and the snap always carry
// the same version. A build without the flag reports "dev", which never triggers an update notice.
var AppVersion = "dev"

// SemVersion represents a parsed semantic version (Major.Minor.Patch).
type SemVersion struct {
	Major int
	Minor int
	Patch int
	Raw   string
}

var semverRegex = regexp.MustCompile(`^[vV]?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$`)

// ParseVersion parses a semantic version string (e.g., "v0.8.0", "0.8.1", "1.0.0").
func ParseVersion(v string) (SemVersion, error) {
	v = strings.TrimSpace(v)
	matches := semverRegex.FindStringSubmatch(v)
	if matches == nil {
		return SemVersion{}, fmt.Errorf("invalid semantic version format: %q", v)
	}

	major, err := strconv.Atoi(matches[1])
	if err != nil {
		return SemVersion{}, fmt.Errorf("invalid major version in %q: %w", v, err)
	}

	minor, err := strconv.Atoi(matches[2])
	if err != nil {
		return SemVersion{}, fmt.Errorf("invalid minor version in %q: %w", v, err)
	}

	patch, err := strconv.Atoi(matches[3])
	if err != nil {
		return SemVersion{}, fmt.Errorf("invalid patch version in %q: %w", v, err)
	}

	return SemVersion{
		Major: major,
		Minor: minor,
		Patch: patch,
		Raw:   v,
	}, nil
}

// CompareVersions compares two version strings (v1 and v2).
// Returns:
//
//	-1 if v1 < v2
//	 0 if v1 == v2
//	 1 if v1 > v2
//
// Returns an error if either version is invalid.
func CompareVersions(v1, v2 string) (int, error) {
	sv1, err := ParseVersion(v1)
	if err != nil {
		return 0, err
	}
	sv2, err := ParseVersion(v2)
	if err != nil {
		return 0, err
	}

	if sv1.Major != sv2.Major {
		if sv1.Major < sv2.Major {
			return -1, nil
		}
		return 1, nil
	}

	if sv1.Minor != sv2.Minor {
		if sv1.Minor < sv2.Minor {
			return -1, nil
		}
		return 1, nil
	}

	if sv1.Patch != sv2.Patch {
		if sv1.Patch < sv2.Patch {
			return -1, nil
		}
		return 1, nil
	}

	return 0, nil
}

// IsUpdateAvailable returns true only if latestVersion is valid and strictly greater than currentVersion.
func IsUpdateAvailable(currentVersion, latestVersion string) bool {
	cmp, err := CompareVersions(currentVersion, latestVersion)
	if err != nil {
		return false
	}
	return cmp < 0
}
