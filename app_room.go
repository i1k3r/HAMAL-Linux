package main

// Wails bindings for the room view: notes, the room snapshot, previews, saving several files,
// pasted images, the upload tray and share links.

import (
	"fmt"
	"os"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// maxPasteBytes limits a pasted image (it crosses the webview bridge as base64).
const maxPasteBytes = 100 << 20

// GetRoomSnapshot returns the room, its files and notes, read from the embedded server.
func (a *App) GetRoomSnapshot() (RoomSnapshot, error) {
	snap, err := a.backend.RoomSnapshot()
	if err == nil && (snap.Status == "closed" || snap.Status == "expired" || snap.Status == "gone") {
		a.uploads.RoomEnded()
	}
	return snap, err
}

// SendNote writes a note on the table.
func (a *App) SendNote(content string) (RoomText, error) {
	return a.backend.SendNote(content)
}

// noteFileName is the name a note gets as a file, like the reference: note-HH-MM.txt.
func noteFileName(t time.Time) string {
	return fmt.Sprintf("note-%02d-%02d.txt", t.Hour(), t.Minute())
}

// SendNoteAsFile lays a note too long for a note on the table as a .txt file.
func (a *App) SendNoteAsFile(content string) error {
	_, err := a.uploads.AddData(noteFileName(time.Now()), []byte(content))
	return err
}

// UploadPastedImage lays an image pasted with Ctrl+V on the table. name is
// pasted-image-<time>.<ext>, as in the reference.
func (a *App) UploadPastedImage(name, base64Data string) error {
	if !pastedNameRe.MatchString(name) {
		return fmt.Errorf("unexpected name for a pasted image: %q", name)
	}
	data, err := decodeUploadData(name, base64Data, maxPasteBytes)
	if err != nil {
		return err
	}
	_, err = a.uploads.AddData(name, data)
	return err
}

// GetUploads lists the upload tray.
func (a *App) GetUploads() []UploadItem { return a.uploads.Items() }

// CancelUpload stops a queued or sending upload.
func (a *App) CancelUpload(id string) bool { return a.uploads.Cancel(id) }

// RetryUpload sends a failed upload again.
func (a *App) RetryUpload(id string) bool { return a.uploads.Retry(id) }

// RemoveUpload takes a failed or finished upload off the tray.
func (a *App) RemoveUpload(id string) bool { return a.uploads.Remove(id) }

// SaveSelectedResult is the outcome of "Save selected".
type SaveSelectedResult struct {
	Cancelled bool        `json:"cancelled"`
	Folder    string      `json:"folder,omitempty"`
	Files     []SavedFile `json:"files"`
	Error     string      `json:"error,omitempty"`
}

// SaveSelectedFiles asks for a folder and saves the files there. Names that are taken get a
// number, so nothing in the folder is overwritten.
func (a *App) SaveSelectedFiles(fileIDs []string) SaveSelectedResult {
	if len(fileIDs) == 0 {
		return SaveSelectedResult{Files: []SavedFile{}}
	}
	dir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title:                "Save selected files to a folder",
		CanCreateDirectories: true,
	})
	if err != nil {
		return SaveSelectedResult{Error: fmt.Sprintf("Failed to open folder dialog: %v", err), Files: []SavedFile{}}
	}
	if dir == "" {
		return SaveSelectedResult{Cancelled: true, Files: []SavedFile{}}
	}
	return SaveSelectedResult{Folder: dir, Files: a.backend.SaveFilesToFolder(a.ctx, fileIDs, dir)}
}

// SaveNote saves a note as a .txt file through the native save dialog.
func (a *App) SaveNote(content string) DownloadResult {
	p, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Save note",
		DefaultFilename: noteFileName(time.Now()),
		Filters:         []runtime.FileFilter{{DisplayName: "Text (*.txt)", Pattern: "*.txt"}},
	})
	if err != nil {
		return DownloadResult{ErrorMessage: fmt.Sprintf("Failed to open save dialog: %v", err)}
	}
	if p == "" {
		return DownloadResult{}
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		return DownloadResult{ErrorMessage: fmt.Sprintf("Failed to save note: %v", err)}
	}
	return DownloadResult{Success: true, SavedPath: p}
}

// CreateShareLink creates a temporary public link to a file (only when the server enables it).
func (a *App) CreateShareLink(fileID string, ttlSeconds int) (ShareLink, error) {
	return a.backend.CreateShareLink(fileID, ttlSeconds)
}

// RevokeShareLink ends a share link early.
func (a *App) RevokeShareLink(shareID string) error {
	return a.backend.RevokeShareLink(shareID)
}
