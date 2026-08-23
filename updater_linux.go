//go:build linux

package main

import (
	"errors"
)

// ExecuteReplacementScript is a stub on Linux to prevent unsafe in-place executable replacement.
func ExecuteReplacementScript(scriptPath string) error {
	return errors.New("self-update replacement is not supported on Linux. Please download the latest release from GitHub.")
}
