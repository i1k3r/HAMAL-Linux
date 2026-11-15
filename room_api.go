package main

// Room features of the desktop creator, on top of the embedded HAMAL server's HTTP API, the same
// endpoints the creator page of the HAMAL Docker release uses (internal/app/static/room.js):
//
//	GET  /api/v1/rooms/{token}                     room status, time left, devices at the table
//	GET  /api/v1/rooms/{token}/files               files and capacity
//	GET  /api/v1/rooms/{token}/texts               notes and the room log (server texts)
//	POST /api/v1/rooms/{token}/texts               write a note
//	POST /api/v1/rooms/{token}/files/{id}/share    share link (only when the server enables it)
//	POST /api/v1/rooms/{token}/shares/{id}/revoke  revoke a share link
//
// The webview cannot call the server directly for JSON (no CORS on the server), so these go
// through Go. Images, video and audio for previews load straight from the server by URL, like the
// reference page does.

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// RoomSeat is a device at the table.
type RoomSeat struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// RoomFile is a file on the table.
type RoomFile struct {
	FileID      string `json:"fileId"`
	Filename    string `json:"filename"`
	SizeBytes   int64  `json:"sizeBytes"`
	ContentType string `json:"contentType"`
	CreatedAt   string `json:"createdAt"`
	// Outbound is true for files laid down from this computer.
	Outbound bool `json:"outbound"`
}

// RoomText is a note, or a server message for the room log (SenderType "server").
type RoomText struct {
	ID         string `json:"id"`
	SenderType string `json:"senderType"`
	Content    string `json:"content"`
	SizeBytes  int64  `json:"sizeBytes"`
	CreatedAt  string `json:"createdAt"`
	IsSelf     bool   `json:"isSelf"`
}

// RoomSnapshot is everything the room view shows, read from the server in one call.
type RoomSnapshot struct {
	// Status is "ready", "closing", "closed", "expired" or "gone" (the room no longer exists).
	Status                  string     `json:"status"`
	RemainingSeconds        int        `json:"remainingSeconds"`
	ClosingRemainingSeconds int        `json:"closingRemainingSeconds"`
	Participants            []RoomSeat `json:"participants"`
	ParticipantCount        int        `json:"participantCount"`
	Files                   []RoomFile `json:"files"`
	TotalSizeBytes          int64      `json:"totalSizeBytes"`
	MaxRoomSize             int64      `json:"maxRoomSize"`
	FileCount               int        `json:"fileCount"`
	MaxFiles                int        `json:"maxFiles"`
	Texts                   []RoomText `json:"texts"`
	MaxTextSize             int        `json:"maxTextSize"`
	// MediaBaseURL + file ID is the file's URL on the local server, for previews.
	MediaBaseURL string `json:"mediaBaseUrl"`
	// ShareEnabled mirrors the server's global share setting (off by default, as in Docker).
	ShareEnabled bool `json:"shareEnabled"`
}

// ShareLink is a temporary public link to one file.
type ShareLink struct {
	ShareID   string `json:"shareId"`
	ShareURL  string `json:"shareUrl"`
	ExpiresAt string `json:"expiresAt"`
	Status    string `json:"status"`
}

var errNoRoom = errors.New("no active room")

// apiError is an error response from the server.
type apiError struct {
	Status  int
	Message string
}

func (e *apiError) Error() string {
	if e.Message != "" {
		return e.Message
	}
	return fmt.Sprintf("HAMAL returned HTTP %d", e.Status)
}

func isGone(err error) bool {
	var ae *apiError
	return errors.As(err, &ae) && (ae.Status == http.StatusGone || ae.Status == http.StatusNotFound)
}

func newClientSessionID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("cs_%x", time.Now().UnixNano())
	}
	return "cs_" + hex.EncodeToString(b)
}

// roomRequest sends a request for the active room. path is relative to /api/v1/rooms/{creator}.
func (b *BackendController) roomRequest(method, path string, body any, out any) (*ActiveRoom, error) {
	b.mu.RLock()
	active := b.activeRoom
	localURL := b.status.LocalURL
	b.mu.RUnlock()
	if active == nil || active.CreatorToken == "" || localURL == "" {
		return nil, errNoRoom
	}
	var rd io.Reader
	if body != nil {
		buf, err := json.Marshal(body)
		if err != nil {
			return active, err
		}
		rd = bytes.NewReader(buf)
	}
	req, err := http.NewRequest(method, localURL+"/api/v1/rooms/"+active.CreatorToken+path, rd)
	if err != nil {
		return active, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")
	if active.ClientSessionID != "" {
		req.Header.Set("X-Client-Session-ID", active.ClientSessionID)
	}
	resp, err := b.httpClient.Do(req)
	if err != nil {
		return active, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return active, err
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		var e struct {
			Error  string `json:"error"`
			Status string `json:"status"`
		}
		_ = json.Unmarshal(data, &e)
		msg := e.Error
		if e.Status != "" && (resp.StatusCode == http.StatusGone) {
			msg = e.Status
		}
		return active, &apiError{Status: resp.StatusCode, Message: msg}
	}
	if out != nil {
		if err := json.Unmarshal(data, out); err != nil {
			return active, fmt.Errorf("unexpected response from HAMAL: %w", err)
		}
	}
	return active, nil
}

// markRoomEnded moves the app to the closed screen when the server says the room is gone.
func (b *BackendController) markRoomEnded(active *ActiveRoom) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.activeRoom != active {
		return
	}
	if b.homeState.Status == "ready" || b.homeState.Status == "closing" {
		b.homeState.Status = "closed"
	}
	if b.pollCancel != nil {
		b.pollCancel()
		b.pollCancel = nil
	}
	b.activeRoom = nil
}

var shareFlagRe = regexp.MustCompile(`data-global-share-enabled="(true|false)"`)

// detectShareEnabled reads the server's share setting from the creator page, the same flag the
// reference room.js reads (data-global-share-enabled).
func (b *BackendController) detectShareEnabled(active *ActiveRoom) bool {
	b.mu.RLock()
	localURL := b.status.LocalURL
	b.mu.RUnlock()
	resp, err := b.httpClient.Get(localURL + "/c/" + active.CreatorToken)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	m := shareFlagRe.FindSubmatch(data)
	return m != nil && string(m[1]) == "true"
}

// RoomSnapshot reads the room, its files and its notes.
func (b *BackendController) RoomSnapshot() (RoomSnapshot, error) {
	var room struct {
		Status                  string `json:"status"`
		RemainingSeconds        int    `json:"remaining_seconds"`
		ClosingRemainingSeconds int    `json:"closing_remaining_seconds"`
		ParticipantCount        int    `json:"participant_count"`
		Participants            []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"participants"`
	}
	active, err := b.roomRequest(http.MethodGet, "", nil, &room)
	if errors.Is(err, errNoRoom) {
		// Closed from this computer (or replaced): there is no room left to show.
		return RoomSnapshot{Status: "gone"}, nil
	}
	if err != nil {
		if isGone(err) {
			b.markRoomEnded(active)
			st := "gone"
			var ae *apiError
			if errors.As(err, &ae) && (ae.Message == "closed" || ae.Message == "expired") {
				st = ae.Message
			}
			return RoomSnapshot{Status: st}, nil
		}
		return RoomSnapshot{}, err
	}

	snap := RoomSnapshot{
		Status:                  room.Status,
		RemainingSeconds:        room.RemainingSeconds,
		ClosingRemainingSeconds: room.ClosingRemainingSeconds,
		ParticipantCount:        room.ParticipantCount,
		Participants:            []RoomSeat{},
		Files:                   []RoomFile{},
		Texts:                   []RoomText{},
	}
	for _, p := range room.Participants {
		snap.Participants = append(snap.Participants, RoomSeat{ID: p.ID, Name: p.Name})
	}
	if room.Status == "closed" || room.Status == "expired" {
		b.markRoomEnded(active)
		return snap, nil
	}

	var files struct {
		Files []struct {
			FileID      string `json:"file_id"`
			Filename    string `json:"filename"`
			SizeBytes   int64  `json:"size_bytes"`
			ContentType string `json:"content_type"`
			Status      string `json:"status"`
			CreatedAt   string `json:"created_at"`
		} `json:"files"`
		TotalSizeBytes int64 `json:"total_size_bytes"`
		FileCount      int   `json:"file_count"`
		MaxRoomSize    int64 `json:"max_room_size"`
		MaxFiles       int   `json:"max_files"`
	}
	if _, err := b.roomRequest(http.MethodGet, "/files", nil, &files); err != nil {
		if isGone(err) {
			b.markRoomEnded(active)
			return RoomSnapshot{Status: "gone"}, nil
		}
		return RoomSnapshot{}, err
	}
	b.mu.RLock()
	for _, f := range files.Files {
		if f.Status != "" && f.Status != "ready" {
			continue
		}
		_, out := b.outboundFileIDs[f.FileID]
		snap.Files = append(snap.Files, RoomFile{
			FileID: f.FileID, Filename: f.Filename, SizeBytes: f.SizeBytes,
			ContentType: f.ContentType, CreatedAt: f.CreatedAt, Outbound: out,
		})
	}
	localURL := b.status.LocalURL
	b.mu.RUnlock()
	snap.TotalSizeBytes = files.TotalSizeBytes
	snap.FileCount = files.FileCount
	snap.MaxRoomSize = files.MaxRoomSize
	snap.MaxFiles = files.MaxFiles

	var texts struct {
		Texts []struct {
			ID         string `json:"id"`
			SenderType string `json:"sender_type"`
			Content    string `json:"content"`
			SizeBytes  int64  `json:"size_bytes"`
			CreatedAt  string `json:"created_at"`
			IsSelf     bool   `json:"is_self"`
		} `json:"texts"`
		MaxTextSize int `json:"max_text_size"`
	}
	if _, err := b.roomRequest(http.MethodGet, "/texts", nil, &texts); err != nil {
		if isGone(err) {
			b.markRoomEnded(active)
			return RoomSnapshot{Status: "gone"}, nil
		}
		return RoomSnapshot{}, err
	}
	for _, t := range texts.Texts {
		snap.Texts = append(snap.Texts, RoomText{
			ID: t.ID, SenderType: t.SenderType, Content: t.Content,
			SizeBytes: t.SizeBytes, CreatedAt: t.CreatedAt, IsSelf: t.IsSelf,
		})
	}
	snap.MaxTextSize = texts.MaxTextSize

	snap.MediaBaseURL = localURL + "/api/v1/rooms/" + active.CreatorToken + "/files/"
	if active.shareChecked.CompareAndSwap(false, true) {
		active.shareEnabled.Store(b.detectShareEnabled(active))
	}
	snap.ShareEnabled = active.shareEnabled.Load()
	return snap, nil
}

// SendNote writes a note on the table.
func (b *BackendController) SendNote(content string) (RoomText, error) {
	if strings.TrimSpace(content) == "" {
		return RoomText{}, errors.New("the note is empty")
	}
	var t struct {
		ID         string `json:"id"`
		SenderType string `json:"sender_type"`
		Content    string `json:"content"`
		SizeBytes  int64  `json:"size_bytes"`
		CreatedAt  string `json:"created_at"`
		IsSelf     bool   `json:"is_self"`
	}
	b.mu.RLock()
	sid := ""
	if b.activeRoom != nil {
		sid = b.activeRoom.ClientSessionID
	}
	b.mu.RUnlock()
	// Sent exactly as typed: indentation and newlines are content.
	active, err := b.roomRequest(http.MethodPost, "/texts", map[string]string{"content": content, "client_session_id": sid}, &t)
	if err != nil {
		if isGone(err) {
			b.markRoomEnded(active)
		}
		return RoomText{}, err
	}
	return RoomText{ID: t.ID, SenderType: t.SenderType, Content: t.Content, SizeBytes: t.SizeBytes, CreatedAt: t.CreatedAt, IsSelf: t.IsSelf}, nil
}

// CreateShareLink creates a temporary public link to a file. The server refuses (404) unless
// global sharing is enabled.
func (b *BackendController) CreateShareLink(fileID string, ttlSeconds int) (ShareLink, error) {
	var s struct {
		ShareID   string `json:"share_id"`
		ShareURL  string `json:"share_url"`
		ExpiresAt string `json:"expires_at"`
		Status    string `json:"status"`
	}
	if _, err := b.roomRequest(http.MethodPost, "/files/"+fileID+"/share", map[string]int{"ttl_seconds": ttlSeconds}, &s); err != nil {
		return ShareLink{}, err
	}
	return ShareLink{ShareID: s.ShareID, ShareURL: s.ShareURL, ExpiresAt: s.ExpiresAt, Status: s.Status}, nil
}

// RevokeShareLink ends a share link early.
func (b *BackendController) RevokeShareLink(shareID string) error {
	_, err := b.roomRequest(http.MethodPost, "/shares/"+shareID+"/revoke", nil, nil)
	return err
}

// fileName returns the name of a file in the active room.
func (b *BackendController) fileNames() (map[string]string, error) {
	var files struct {
		Files []struct {
			FileID   string `json:"file_id"`
			Filename string `json:"filename"`
		} `json:"files"`
	}
	if _, err := b.roomRequest(http.MethodGet, "/files", nil, &files); err != nil {
		return nil, err
	}
	out := make(map[string]string, len(files.Files))
	for _, f := range files.Files {
		out[f.FileID] = f.Filename
	}
	return out, nil
}

// SavedFile is one file of a "Save selected" run.
type SavedFile struct {
	FileID string `json:"fileId"`
	Name   string `json:"name"`
	Path   string `json:"path,omitempty"`
	Error  string `json:"error,omitempty"`
}

// safeName keeps a received filename inside the chosen folder.
func safeName(name string) string {
	name = filepath.Base(strings.ReplaceAll(name, "\\", "/"))
	name = strings.Map(func(r rune) rune {
		if r < 32 || r == '/' {
			return '_'
		}
		return r
	}, name)
	if name == "." || name == ".." || name == "" || name == string(filepath.Separator) {
		name = "file"
	}
	return name
}

// uniquePath returns dir/name, or dir/"stem (n).ext" when that name is taken.
func uniquePath(dir, name string) string {
	p := filepath.Join(dir, name)
	if _, err := os.Lstat(p); os.IsNotExist(err) {
		return p
	}
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	for _, multi := range []string{".tar.gz", ".tar.bz2", ".tar.xz", ".tar.zst"} {
		if strings.HasSuffix(strings.ToLower(name), multi) {
			ext = name[len(name)-len(multi):]
			stem = name[:len(name)-len(multi)]
		}
	}
	for i := 1; ; i++ {
		p = filepath.Join(dir, fmt.Sprintf("%s (%d)%s", stem, i, ext))
		if _, err := os.Lstat(p); os.IsNotExist(err) {
			return p
		}
	}
}

// SaveFilesToFolder saves the given files into dir, never overwriting what is there.
func (b *BackendController) SaveFilesToFolder(ctx context.Context, fileIDs []string, dir string) []SavedFile {
	names, err := b.fileNames()
	out := make([]SavedFile, 0, len(fileIDs))
	for _, id := range fileIDs {
		sf := SavedFile{FileID: id, Name: names[id]}
		switch {
		case err != nil:
			sf.Error = err.Error()
		case sf.Name == "":
			sf.Error = "This file is no longer in the room."
		default:
			p := uniquePath(dir, safeName(sf.Name))
			if derr := b.DownloadFileToPathContext(ctx, id, p); derr != nil {
				sf.Error = derr.Error()
			} else {
				sf.Path = p
			}
		}
		out = append(out, sf)
	}
	return out
}
