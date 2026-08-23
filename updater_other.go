//go:build !linux

package main

import (
	"errors"
)

// ExecuteReplacementScript is a stub for non-Linux platforms.
func ExecuteReplacementScript(scriptPath string) error {
	return errors.New("self-update replacement is not supported on this platform")
}
