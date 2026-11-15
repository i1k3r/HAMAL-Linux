package main

// Upload queue for files laid down from this computer: the native file picker, files dropped on
// the window, pasted images and notes sent as .txt files. It follows the reference room.js queue:
// one file at a time, every file has a state, and a file can be cancelled while it waits or sends,
// retried when it failed and removed from the tray afterwards.

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// Upload states, as in the reference upload tray.
const (
	upQueued  = "queued"
	upSending = "sending"
	upSent    = "sent"
	upFailed  = "failed"
	upEnded   = "ended"
)

// UploadItem is one file in the upload tray.
type UploadItem struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	SizeBytes int64  `json:"sizeBytes"`
	State     string `json:"state"`
	Percent   int    `json:"percent"`
	Error     string `json:"error,omitempty"`
	FileID    string `json:"fileId,omitempty"`
	// BytesPerSec is the measured speed while sending.
	BytesPerSec float64 `json:"bytesPerSec,omitempty"`

	path      string
	temp      bool // path is a temporary copy (pasted image, note as file) removed when done
	cancel    context.CancelFunc
	startedAt time.Time
}

// uploadQueue sends queued files one at a time.
type uploadQueue struct {
	mu      sync.Mutex
	items   map[string]*UploadItem
	order   []string
	seq     int
	running bool
	backend *BackendController
	emit    func(item UploadItem)
	// tempDir holds pasted images and notes sent as files until they are sent.
	tempDir func() (string, error)
}

func newUploadQueue(b *BackendController, emit func(UploadItem)) *uploadQueue {
	return &uploadQueue{
		items:   map[string]*UploadItem{},
		backend: b,
		emit:    emit,
		tempDir: func() (string, error) {
			dir := filepath.Join(os.TempDir(), "hamal-outgoing")
			return dir, os.MkdirAll(dir, 0o700)
		},
	}
}

func (q *uploadQueue) publish(it *UploadItem) {
	if q.emit != nil {
		q.emit(*it)
	}
}

// Add queues local files under their own names.
func (q *uploadQueue) Add(paths []string) []string {
	ids := make([]string, 0, len(paths))
	for _, p := range paths {
		var size int64
		if fi, err := os.Stat(p); err == nil {
			size = fi.Size()
		}
		ids = append(ids, q.add(p, filepath.Base(p), size, false))
	}
	q.pump()
	return ids
}

func (q *uploadQueue) add(path, name string, size int64, temp bool) string {
	q.mu.Lock()
	q.seq++
	id := fmt.Sprintf("u%d", q.seq)
	it := &UploadItem{ID: id, Name: name, SizeBytes: size, State: upQueued, path: path, temp: temp}
	q.items[id] = it
	q.order = append(q.order, id)
	q.mu.Unlock()
	q.publish(it)
	return id
}

// AddData queues bytes (a pasted image or a note) as a file with the given name.
func (q *uploadQueue) AddData(name string, data []byte) (string, error) {
	if len(data) == 0 {
		return "", errors.New("nothing to send")
	}
	dir, err := q.tempDir()
	if err != nil {
		return "", err
	}
	sub, err := os.MkdirTemp(dir, "item-")
	if err != nil {
		return "", err
	}
	p := filepath.Join(sub, safeName(name))
	if err := os.WriteFile(p, data, 0o600); err != nil {
		_ = os.RemoveAll(sub)
		return "", err
	}
	id := q.add(p, safeName(name), int64(len(data)), true)
	q.pump()
	return id, nil
}

func (q *uploadQueue) pump() {
	q.mu.Lock()
	if q.running {
		q.mu.Unlock()
		return
	}
	q.running = true
	q.mu.Unlock()
	go q.run()
}

func (q *uploadQueue) next() (*UploadItem, context.Context) {
	q.mu.Lock()
	defer q.mu.Unlock()
	for _, id := range q.order {
		if it := q.items[id]; it != nil && it.State == upQueued {
			ctx, cancel := context.WithCancel(context.Background())
			it.cancel = cancel
			it.State = upSending
			it.Percent = 0
			it.BytesPerSec = 0
			it.Error = ""
			it.startedAt = time.Now()
			return it, ctx
		}
	}
	q.running = false
	return nil, nil
}

func (q *uploadQueue) run() {
	for {
		it, ctx := q.next()
		if it == nil {
			return
		}
		q.publish(it)
		q.send(ctx, it)
	}
}

func (q *uploadQueue) send(ctx context.Context, it *UploadItem) {
	q.mu.Lock()
	path, name := it.path, it.Name
	q.mu.Unlock()

	lastEmit := time.Time{}
	res := q.backend.UploadFileContext(ctx, path, name, func(pct int) {
		q.mu.Lock()
		if it.State != upSending {
			q.mu.Unlock()
			return
		}
		it.Percent = pct
		if secs := time.Since(it.startedAt).Seconds(); secs > 0.3 && it.SizeBytes > 0 {
			it.BytesPerSec = float64(it.SizeBytes) * float64(pct) / 100 / secs
		}
		emit := time.Since(lastEmit) > 150*time.Millisecond || pct == 100
		if emit {
			lastEmit = time.Now()
		}
		snapshot := *it
		q.mu.Unlock()
		if emit && q.emit != nil {
			q.emit(snapshot)
		}
	})

	q.mu.Lock()
	if it.cancel != nil {
		it.cancel()
		it.cancel = nil
	}
	if it.State != upSending { // cancelled and removed meanwhile
		q.mu.Unlock()
		return
	}
	switch {
	case res.Success:
		it.State = upSent
		it.Percent = 100
		it.FileID = res.FileID
		if it.temp {
			_ = os.RemoveAll(filepath.Dir(it.path))
		}
	case roomEndedMessage(res.ErrorMessage):
		it.State = upEnded
		it.Error = res.ErrorMessage
	default:
		it.State = upFailed
		it.Error = res.ErrorMessage
	}
	snapshot := *it
	q.mu.Unlock()
	if q.emit != nil {
		q.emit(snapshot)
	}
	if snapshot.State == upEnded {
		q.endQueued(snapshot.Error)
	}
}

var roomEndedRe = regexp.MustCompile(`(?i)\b(room (is )?(closed|closing|expired|not found|has expired)|no active room)`)

func roomEndedMessage(msg string) bool { return roomEndedRe.MatchString(msg) }

// endQueued stops the rest of the queue: no further upload can succeed in this room.
func (q *uploadQueue) endQueued(reason string) {
	q.mu.Lock()
	var changed []UploadItem
	for _, id := range q.order {
		if it := q.items[id]; it != nil && it.State == upQueued {
			it.State = upEnded
			it.Error = reason
			changed = append(changed, *it)
		}
	}
	q.mu.Unlock()
	for _, c := range changed {
		if q.emit != nil {
			q.emit(c)
		}
	}
}

// RoomEnded marks every unfinished upload as stopped because the room ended.
func (q *uploadQueue) RoomEnded() {
	q.mu.Lock()
	var changed []UploadItem
	for _, id := range q.order {
		it := q.items[id]
		if it == nil || (it.State != upQueued && it.State != upSending && it.State != upFailed) {
			continue
		}
		if it.cancel != nil {
			it.cancel()
			it.cancel = nil
		}
		it.State = upEnded
		changed = append(changed, *it)
	}
	q.mu.Unlock()
	for _, c := range changed {
		if q.emit != nil {
			q.emit(c)
		}
	}
}

// Cancel stops a queued or sending upload and removes it from the tray.
func (q *uploadQueue) Cancel(id string) bool {
	q.mu.Lock()
	it := q.items[id]
	if it == nil || (it.State != upQueued && it.State != upSending) {
		q.mu.Unlock()
		return false
	}
	if it.cancel != nil {
		it.cancel()
		it.cancel = nil
	}
	q.removeLocked(id)
	q.mu.Unlock()
	return true
}

// Retry queues a failed upload again.
func (q *uploadQueue) Retry(id string) bool {
	q.mu.Lock()
	it := q.items[id]
	if it == nil || it.State != upFailed {
		q.mu.Unlock()
		return false
	}
	it.State = upQueued
	it.Error = ""
	it.Percent = 0
	snapshot := *it
	q.mu.Unlock()
	if q.emit != nil {
		q.emit(snapshot)
	}
	q.pump()
	return true
}

// Remove takes a finished, failed or stopped upload off the tray.
func (q *uploadQueue) Remove(id string) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	it := q.items[id]
	if it == nil || it.State == upSending || it.State == upQueued {
		return false
	}
	q.removeLocked(id)
	return true
}

// Clear empties the tray of finished uploads (a new room starts with an empty tray).
func (q *uploadQueue) Clear() {
	q.mu.Lock()
	defer q.mu.Unlock()
	for _, id := range append([]string(nil), q.order...) {
		it := q.items[id]
		if it == nil {
			continue
		}
		if it.cancel != nil {
			it.cancel()
			it.cancel = nil
		}
		q.removeLocked(id)
	}
}

func (q *uploadQueue) removeLocked(id string) {
	it := q.items[id]
	if it == nil {
		return
	}
	it.State = "removed"
	if it.temp {
		_ = os.RemoveAll(filepath.Dir(it.path))
	}
	delete(q.items, id)
	for i, x := range q.order {
		if x == id {
			q.order = append(q.order[:i], q.order[i+1:]...)
			break
		}
	}
	if q.emit != nil {
		q.emit(UploadItem{ID: id, Name: it.Name, State: "removed"})
	}
}

// Items lists the tray in order.
func (q *uploadQueue) Items() []UploadItem {
	q.mu.Lock()
	defer q.mu.Unlock()
	out := make([]UploadItem, 0, len(q.order))
	for _, id := range q.order {
		if it := q.items[id]; it != nil {
			out = append(out, *it)
		}
	}
	return out
}

var pastedNameRe = regexp.MustCompile(`^pasted-image-[0-9T-]{10,24}\.[a-z0-9+.-]{1,12}$`)

// decodeUploadData checks a name and base64 payload sent from the webview.
func decodeUploadData(name, b64 string, maxBytes int) ([]byte, error) {
	if strings.TrimSpace(name) == "" {
		return nil, errors.New("missing file name")
	}
	if base64.StdEncoding.DecodedLen(len(b64)) > maxBytes+3 {
		return nil, fmt.Errorf("too large to paste (over %s)", formatBytes(int64(maxBytes)))
	}
	data, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, errors.New("the pasted data could not be read")
	}
	return data, nil
}
