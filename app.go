package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// DownloadResult contains the result of a save/download request.
type DownloadResult struct {
	Success      bool   `json:"success"`
	SavedPath    string `json:"savedPath,omitempty"`
	ErrorMessage string `json:"errorMessage,omitempty"`
}

// FeedbackPayload represents user-submitted feedback.
type FeedbackPayload struct {
	Type    string `json:"type"`
	Message string `json:"message"`
	Email   string `json:"email,omitempty"`
}

// FeedbackResult contains the result of a feedback submission.
type FeedbackResult struct {
	Success    bool   `json:"success"`
	Configured bool   `json:"configured"`
	Message    string `json:"message"`
}

// App struct
type App struct {
	ctx     context.Context
	backend *BackendController
	updater *UpdaterController
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{
		backend: NewBackendController(),
		updater: NewUpdaterController(),
	}
}

// startup is called at application startup
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	// Hook callback for inbound files received from phone / participant
	a.backend.SetOnFileReceived(func(file ReceivedFile) {
		runtime.EventsEmit(a.ctx, "file-received", file)
	})

	_ = a.backend.Start()

	// Register native file drop handler — single authoritative upload dispatcher
	runtime.OnFileDrop(a.ctx, func(x, y int, paths []string) {
		if len(paths) == 0 {
			return
		}
		go a.dispatchUploadBatch(paths)
	})

	// Start native background system theme monitor
	go a.monitorSystemTheme(ctx)

	// Start asynchronous background GitHub update check (non-blocking)
	go a.checkUpdatesBackground()
}

// checkUpdatesBackground checks GitHub releases silently and notifies frontend if an update exists.
func (a *App) checkUpdatesBackground() {
	time.Sleep(2 * time.Second)
	if a.ctx == nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	info, err := a.updater.CheckForUpdates(ctx, "", AppVersion)
	if err != nil || !info.Available {
		return
	}

	runtime.EventsEmit(a.ctx, "update-available", info)
}

// dispatchUploadBatch processes a slice of file paths sequentially through the upload pipeline.
func (a *App) dispatchUploadBatch(paths []string) {
	total := len(paths)
	if total == 0 {
		return
	}

	successCount := 0
	failedCount := 0
	var lastError string

	for i, filePath := range paths {
		fname := filepath.Base(filePath)
		runtime.EventsEmit(a.ctx, "upload-started", map[string]interface{}{
			"filename": fname,
			"index":    i + 1,
			"total":    total,
		})

		res := a.backend.UploadFile(filePath, func(percent int) {
			runtime.EventsEmit(a.ctx, "upload-progress", map[string]interface{}{
				"filename": fname,
				"percent":  percent,
				"index":    i + 1,
				"total":    total,
			})
		})

		if res.Success {
			successCount++
			runtime.EventsEmit(a.ctx, "upload-file-complete", map[string]interface{}{
				"fileId":        res.FileID,
				"filename":      res.Filename,
				"sizeBytes":     res.SizeBytes,
				"sizeFormatted": formatBytes(res.SizeBytes),
				"index":         i + 1,
				"total":         total,
			})
		} else {
			failedCount++
			lastError = res.ErrorMessage
			runtime.EventsEmit(a.ctx, "upload-file-error", map[string]interface{}{
				"filename": fname,
				"error":    res.ErrorMessage,
				"index":    i + 1,
				"total":    total,
			})
		}
	}

	runtime.EventsEmit(a.ctx, "upload-batch-complete", map[string]interface{}{
		"total":        total,
		"successCount": successCount,
		"failedCount":  failedCount,
		"lastError":    lastError,
		"singleName":   filepath.Base(paths[0]),
	})
}

// SelectAndUploadFiles opens a native file selection dialog and uploads selected files.
func (a *App) SelectAndUploadFiles() {
	paths, err := runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select Files to Send",
	})
	if err != nil || len(paths) == 0 {
		return
	}

	go a.dispatchUploadBatch(paths)
}

// domReady is called after front-end resources have been loaded
func (a *App) domReady(ctx context.Context) {
}

// beforeClose is called when the application is about to quit
func (a *App) beforeClose(ctx context.Context) (prevent bool) {
	return false
}

// shutdown is called at application termination
func (a *App) shutdown(ctx context.Context) {
	_ = a.backend.Stop()
}

// GetHomeScreenState returns current room, QR, and connection status for the UI.
func (a *App) GetHomeScreenState() HomeScreenState {
	return a.backend.GetHomeScreenState()
}

// Retry attempts to recreate the room or reconnect backend.
func (a *App) Retry() HomeScreenState {
	return a.backend.Retry()
}

// CreateRoomWithConfig creates a new room with custom TTL and optional PIN.
func (a *App) CreateRoomWithConfig(ttlSeconds int, pin string) (HomeScreenState, error) {
	return a.backend.CreateRoomWithConfig(ttlSeconds, pin)
}

// CloseRoom closes the active room via the backend API.
func (a *App) CloseRoom() HomeScreenState {
	return a.backend.CloseRoom()
}

// ResetToSetup resets the home state to setup and invalidates old room session/polling.
func (a *App) ResetToSetup() HomeScreenState {
	return a.backend.ResetToSetup()
}

// UploadFile allows triggering an upload from a file path.
func (a *App) UploadFile(filePath string) UploadResult {
	return a.backend.UploadFile(filePath, nil)
}

// UploadFiles uploads multiple files sequentially.
func (a *App) UploadFiles(filePaths []string) []UploadResult {
	return a.backend.UploadFiles(filePaths, nil)
}

// DownloadFile opens a native Save File dialog and saves the received file to disk.
func (a *App) DownloadFile(fileID string, defaultFilename string) DownloadResult {
	if fileID == "" {
		return DownloadResult{
			Success:      false,
			ErrorMessage: "No file ID specified for download.",
		}
	}

	selectedPath, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Save Received File",
		DefaultFilename: defaultFilename,
	})
	if err != nil {
		return DownloadResult{
			Success:      false,
			ErrorMessage: fmt.Sprintf("Failed to open save dialog: %v", err),
		}
	}

	// User cancelled save dialog
	if selectedPath == "" {
		return DownloadResult{
			Success: false,
		}
	}

	err = a.backend.DownloadFileToPath(fileID, selectedPath)
	if err != nil {
		return DownloadResult{
			Success:      false,
			ErrorMessage: fmt.Sprintf("Failed to save file: %v", err),
		}
	}

	return DownloadResult{
		Success:   true,
		SavedPath: selectedPath,
	}
}

// GetServerStatus returns low-level diagnostic information about the in-process HAMAL server.
func (a *App) GetServerStatus() ServerStatus {
	return a.backend.GetStatus()
}

// GetSystemTheme returns the current detected system theme ("light" or "dark").
func (a *App) GetSystemTheme() string {
	return GetSystemTheme()
}

// GetSystemLanguage returns the detected UI language mapped to a supported HAMAL locale.
func (a *App) GetSystemLanguage() string {
	return GetSystemLanguage()
}

// SubmitFeedback handles feedback submission.
// If HAMAL_FEEDBACK_URL is configured, it forwards the payload via HTTP POST.
// Otherwise, it returns a graceful unconfigured status without error.
func (a *App) SubmitFeedback(payload FeedbackPayload) FeedbackResult {
	feedbackURL := os.Getenv("HAMAL_FEEDBACK_URL")
	if feedbackURL == "" {
		return FeedbackResult{
			Success:    false,
			Configured: false,
			Message:    "Feedback is not available yet. Please try again later.",
		}
	}

	body, err := json.Marshal(map[string]interface{}{
		"type":      payload.Type,
		"message":   payload.Message,
		"email":     payload.Email,
		"os":        "linux",
		"version":   AppVersion,
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
	if err != nil {
		return FeedbackResult{
			Success:    false,
			Configured: true,
			Message:    "Failed to process feedback payload.",
		}
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Post(feedbackURL, "application/json", bytes.NewReader(body))
	if err != nil {
		return FeedbackResult{
			Success:    false,
			Configured: true,
			Message:    "Unable to reach feedback service. Please check your connection and try again.",
		}
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return FeedbackResult{
			Success:    true,
			Configured: true,
			Message:    "Thank you for helping us improve HAMAL ❤️",
		}
	}

	return FeedbackResult{
		Success:    false,
		Configured: true,
		Message:    fmt.Sprintf("Server returned status: %d", resp.StatusCode),
	}
}

// OpenFeedbackEmail opens the system default email client addressed to hamalapp@outlook.com.
func (a *App) OpenFeedbackEmail() {
	if a.ctx != nil {
		runtime.BrowserOpenURL(a.ctx, "mailto:hamalapp@outlook.com?subject=HAMAL%20Feedback")
	}
}

// GetAppVersion returns the current application version constant.
func (a *App) GetAppVersion() string {
	return AppVersion
}

// CheckForUpdates manually checks GitHub releases for a newer version.
func (a *App) CheckForUpdates() UpdateInfo {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	info, err := a.updater.CheckForUpdates(ctx, "", AppVersion)
	if err != nil && info.ErrorMessage == "" {
		info.ErrorMessage = err.Error()
	}
	return info
}

// ApplyUpdate handles the update action on Linux by directing the user to the GitHub release page.
func (a *App) ApplyUpdate(assetURL string) (bool, string) {
	if assetURL != "" && a.ctx != nil {
		runtime.BrowserOpenURL(a.ctx, assetURL)
	}
	return false, "Please download the updated package from the GitHub release page."
}

// Greet returns a greeting message to verify Go-JS bridge
func (a *App) Greet(name string) string {
	return fmt.Sprintf("Hello %s, HAMAL Linux backend bridge is operational!", name)
}
