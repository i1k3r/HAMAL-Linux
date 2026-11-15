package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// startRoom starts the embedded server and opens a room.
func startRoom(t *testing.T) *BackendController {
	t.Helper()
	bc := NewBackendController()
	if err := bc.Start(); err != nil {
		t.Fatalf("failed to start backend: %v", err)
	}
	t.Cleanup(func() { _ = bc.Stop() })
	for i := 0; i < 50 && bc.GetHomeScreenState().Status != "setup"; i++ {
		time.Sleep(100 * time.Millisecond)
	}
	if err := bc.CreateRoom(); err != nil {
		t.Fatalf("failed to create room: %v", err)
	}
	return bc
}

// userNotes leaves out the server's own room-log messages ("Room created", "File uploaded: …").
func userNotes(s RoomSnapshot) []RoomText {
	var out []RoomText
	for _, x := range s.Texts {
		if x.SenderType != "server" {
			out = append(out, x)
		}
	}
	return out
}

func TestRoomSnapshotNotesAndFiles(t *testing.T) {
	bc := startRoom(t)

	snap, err := bc.RoomSnapshot()
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if snap.Status != "active" || len(snap.Files) != 0 || len(userNotes(snap)) != 0 {
		t.Fatalf("unexpected empty room snapshot: %+v", snap)
	}
	if snap.MaxRoomSize <= 0 || snap.MaxFiles <= 0 || snap.MaxTextSize != 64*1024 {
		t.Fatalf("room limits not read: size=%d files=%d text=%d", snap.MaxRoomSize, snap.MaxFiles, snap.MaxTextSize)
	}
	if snap.ShareEnabled {
		t.Fatal("share links must stay off: the embedded server uses the default config")
	}

	// A note from this computer, kept exactly as typed.
	note := "  indented\nsecond line\n"
	sent, err := bc.SendNote(note)
	if err != nil {
		t.Fatalf("send note: %v", err)
	}
	if sent.Content != note || sent.SenderType == "server" || !sent.IsSelf {
		t.Fatalf("note changed on the way: %+v", sent)
	}
	if _, err := bc.SendNote("   \n"); err == nil {
		t.Fatal("an empty note must be refused")
	}

	// A note from a phone.
	st := bc.GetStatus()
	body := `{"content":"from the phone","client_session_id":"phone-1"}`
	resp, err := http.Post(st.LocalURL+"/api/v1/rooms/"+bc.activeRoom.ParticipantToken+"/texts", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()

	// A file from this computer.
	p := filepath.Join(t.TempDir(), "photo.png")
	_ = os.WriteFile(p, []byte("\x89PNG\r\n\x1a\nnot really"), 0o644)
	if res := bc.UploadFile(p, nil); !res.Success {
		t.Fatalf("upload: %s", res.ErrorMessage)
	}

	snap, err = bc.RoomSnapshot()
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	notes := userNotes(snap)
	if len(notes) != 2 {
		t.Fatalf("expected 2 notes, got %d", len(notes))
	}
	var self, other int
	for _, tx := range notes {
		if tx.IsSelf {
			self++
		} else {
			other++
		}
	}
	if self != 1 || other != 1 {
		t.Fatalf("is_self must mark only this computer's note: self=%d other=%d", self, other)
	}
	if len(snap.Files) != 1 || !snap.Files[0].Outbound || snap.Files[0].Filename != "photo.png" {
		t.Fatalf("expected the sent file marked as outbound: %+v", snap.Files)
	}
	if !strings.HasPrefix(snap.MediaBaseURL, st.LocalURL+"/api/v1/rooms/"+bc.activeRoom.CreatorToken+"/files/") {
		t.Fatalf("unexpected media base %q", snap.MediaBaseURL)
	}
	// The preview URL serves the file to the webview.
	r, err := http.Get(snap.MediaBaseURL + snap.Files[0].FileID)
	if err != nil || r.StatusCode != 200 {
		t.Fatalf("preview URL failed: %v %v", err, r)
	}
	r.Body.Close()

	bc.CloseRoom()
	snap, err = bc.RoomSnapshot()
	if err != nil {
		t.Fatalf("snapshot after close: %v", err)
	}
	if snap.Status == "active" {
		t.Fatal("room still open after close")
	}
}

func TestSaveFilesToFolderNeverOverwrites(t *testing.T) {
	bc := startRoom(t)
	src := t.TempDir()
	for _, n := range []string{"report.pdf", "backup.tar.gz"} {
		_ = os.WriteFile(filepath.Join(src, n), []byte("content of "+n), 0o644)
	}
	var ids []string
	for _, n := range []string{"report.pdf", "backup.tar.gz"} {
		res := bc.UploadFile(filepath.Join(src, n), nil)
		if !res.Success {
			t.Fatal(res.ErrorMessage)
		}
		ids = append(ids, res.FileID)
	}

	dst := t.TempDir()
	_ = os.WriteFile(filepath.Join(dst, "report.pdf"), []byte("already here"), 0o644)
	ids = append(ids, "f_missing")
	got := bc.SaveFilesToFolder(context.Background(), ids, dst)
	if len(got) != 3 {
		t.Fatalf("expected 3 results, got %d", len(got))
	}
	if got[0].Path != filepath.Join(dst, "report (1).pdf") || got[1].Path != filepath.Join(dst, "backup.tar.gz") {
		t.Fatalf("unexpected paths: %+v", got)
	}
	if got[2].Error == "" {
		t.Fatal("a file that is not in the room must report an error")
	}
	if b, _ := os.ReadFile(filepath.Join(dst, "report.pdf")); string(b) != "already here" {
		t.Fatal("an existing file was overwritten")
	}
	if b, _ := os.ReadFile(got[0].Path); string(b) != "content of report.pdf" {
		t.Fatalf("saved content wrong: %q", b)
	}
	if fi, _ := os.Stat(got[0].Path); fi.Mode().Perm() != 0o644 {
		t.Fatalf("saved file mode %v", fi.Mode().Perm())
	}
	if m, _ := filepath.Glob(filepath.Join(dst, "*.part")); len(m) != 0 {
		t.Fatalf("temporary files left behind: %v", m)
	}
}

func TestUniquePathAndSafeName(t *testing.T) {
	dir := t.TempDir()
	for _, n := range []string{"a.txt", "a (1).txt", "x.tar.gz"} {
		_ = os.WriteFile(filepath.Join(dir, n), nil, 0o644)
	}
	cases := map[string]string{"a.txt": "a (2).txt", "x.tar.gz": "x (1).tar.gz", "new.txt": "new.txt"}
	for in, want := range cases {
		if got := filepath.Base(uniquePath(dir, in)); got != want {
			t.Errorf("uniquePath(%q) = %q, want %q", in, got, want)
		}
	}
	for in, want := range map[string]string{"../../etc/passwd": "passwd", `..\..\x.txt`: "x.txt", "..": "file", "": "file", "a\nb": "a_b"} {
		if got := safeName(in); got != want {
			t.Errorf("safeName(%q) = %q, want %q", in, got, want)
		}
	}
}

// recorder collects upload-tray events.
type recorder struct {
	mu     sync.Mutex
	events []UploadItem
}

func (r *recorder) emit(it UploadItem) { r.mu.Lock(); r.events = append(r.events, it); r.mu.Unlock() }

func waitState(t *testing.T, q *uploadQueue, id, state string) UploadItem {
	t.Helper()
	for i := 0; i < 200; i++ {
		for _, it := range q.Items() {
			if it.ID == id && it.State == state {
				return it
			}
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("upload %s never reached %q: %+v", id, state, q.Items())
	return UploadItem{}
}

func TestUploadQueueSendsRetriesAndRemoves(t *testing.T) {
	bc := startRoom(t)
	rec := &recorder{}
	q := newUploadQueue(bc, rec.emit)
	q.tempDir = func() (string, error) { return t.TempDir(), nil }

	src := t.TempDir()
	good := filepath.Join(src, "ok.txt")
	_ = os.WriteFile(good, []byte("fine"), 0o644)
	missing := filepath.Join(src, "missing.txt")

	ids := q.Add([]string{good, missing})
	sent := waitState(t, q, ids[0], upSent)
	if sent.FileID == "" || sent.Percent != 100 {
		t.Fatalf("sent item incomplete: %+v", sent)
	}
	failed := waitState(t, q, ids[1], upFailed)
	if failed.Error == "" {
		t.Fatal("failed item has no error")
	}

	// Retry after the file appears.
	_ = os.WriteFile(missing, []byte("now here"), 0o644)
	if !q.Retry(ids[1]) {
		t.Fatal("retry refused")
	}
	waitState(t, q, ids[1], upSent)

	// Notes and pasted images travel as temporary files that are cleaned up once sent.
	id, err := q.AddData("note-10-30.txt", []byte("a long note"))
	if err != nil {
		t.Fatal(err)
	}
	waitState(t, q, id, upSent)
	if _, err := q.AddData("empty.txt", nil); err == nil {
		t.Fatal("empty data must be refused")
	}

	if q.Remove(ids[0]) != true || len(q.Items()) != 2 {
		t.Fatalf("remove failed: %+v", q.Items())
	}
	if q.Retry(ids[0]) || q.Cancel(ids[0]) {
		t.Fatal("a removed item must not be retried or cancelled")
	}

	snap, _ := bc.RoomSnapshot()
	if len(snap.Files) != 3 {
		t.Fatalf("expected 3 files in the room, got %d", len(snap.Files))
	}
	rec.mu.Lock()
	n := len(rec.events)
	rec.mu.Unlock()
	if n == 0 {
		t.Fatal("no upload-update events were emitted")
	}
}

func TestUploadQueueCancelAndRoomEnd(t *testing.T) {
	bc := startRoom(t)
	q := newUploadQueue(bc, nil)
	src := t.TempDir()
	big := filepath.Join(src, "big.bin")
	f, _ := os.Create(big)
	_ = f.Truncate(64 << 20)
	f.Close()
	small := filepath.Join(src, "small.txt")
	_ = os.WriteFile(small, []byte("x"), 0o644)

	ids := q.Add([]string{big, small, small})
	waitState(t, q, ids[0], upSending)
	if !q.Cancel(ids[1]) {
		t.Fatal("cancelling a queued item failed")
	}
	if !q.Cancel(ids[0]) {
		t.Fatal("cancelling the sending item failed")
	}
	waitState(t, q, ids[2], upSent)
	for _, it := range q.Items() {
		if it.ID == ids[0] || it.ID == ids[1] {
			t.Fatalf("cancelled item still in the tray: %+v", it)
		}
	}
	snap, _ := bc.RoomSnapshot()
	if len(snap.Files) != 1 {
		t.Fatalf("a cancelled upload reached the room: %d files", len(snap.Files))
	}

	// When the room ends, waiting uploads stop instead of failing one by one.
	more := q.Add([]string{big, small})
	waitState(t, q, more[0], upSending)
	q.RoomEnded()
	for _, id := range more {
		waitState(t, q, id, upEnded)
	}
}

func TestDecodeUploadDataAndPastedNames(t *testing.T) {
	data := []byte("\x89PNG pasted")
	got, err := decodeUploadData("pasted-image-2026-11-15T10-30-00.png", base64.StdEncoding.EncodeToString(data), 1024)
	if err != nil || !bytes.Equal(got, data) {
		t.Fatalf("decode: %v %q", err, got)
	}
	if _, err := decodeUploadData("x.png", base64.StdEncoding.EncodeToString(make([]byte, 2048)), 1024); err == nil {
		t.Fatal("oversized data must be refused")
	}
	if _, err := decodeUploadData("x.png", "!!not base64!!", 1024); err == nil {
		t.Fatal("bad base64 must be refused")
	}
	for name, ok := range map[string]bool{
		"pasted-image-2026-11-15T10-30-00.png": true,
		"pasted-image-1731665400000.jpeg":      true,
		"../pasted-image-2026.png":             false,
		"pasted-image-2026-11-15.png/../x":     false,
		"evil.sh":                              false,
	} {
		if pastedNameRe.MatchString(name) != ok {
			t.Errorf("pasted name %q: want %v", name, ok)
		}
	}
	if noteFileName(time.Date(2026, 1, 2, 9, 5, 0, 0, time.UTC)) != "note-09-05.txt" {
		t.Fatal("note file name")
	}
}
