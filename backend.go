package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/i1k3r/HAMAL/pkg/server"
)

// HomeScreenState contains the current state of the home screen for the frontend.
type HomeScreenState struct {
	Status                  string `json:"status"` // "starting", "setup", "ready", "closing", "closed", "stopped", "error"
	ErrorMessage            string `json:"errorMessage,omitempty"`
	RoomID                  string `json:"roomId,omitempty"`
	ParticipantURL          string `json:"participantUrl,omitempty"`
	QRSVG                   string `json:"qrSvg,omitempty"`
	ExpiresAt               string `json:"expiresAt,omitempty"`
	CloseDeadline           string `json:"closeDeadline,omitempty"`
	ClosingRemainingSeconds int    `json:"closingRemainingSeconds,omitempty"`
	PinRequired             bool   `json:"pinRequired"`
	LanURL                  string `json:"lanUrl,omitempty"`
	LocalURL                string `json:"localUrl,omitempty"`
}

// ServerStatus contains low-level diagnostic information.
type ServerStatus struct {
	Status       string `json:"status"` // "stopped", "starting", "running", "error"
	DataDir      string `json:"dataDir"`
	Port         int    `json:"port"`
	LocalURL     string `json:"localUrl"`
	LanURL       string `json:"lanUrl"`
	LanIP        string `json:"lanIp"`
	HealthStatus string `json:"healthStatus"`
	ReadyStatus  string `json:"readyStatus"`
	ErrorMessage string `json:"errorMessage,omitempty"`
}

// ActiveRoom holds internal state for the current active room.
type ActiveRoom struct {
	RoomID           string
	CreatorToken     string
	ParticipantToken string
	CreatorURL       string
	ParticipantURL   string
	ExpiresAt        time.Time
	PinRequired      bool
	QRSVG            string
}

// UploadResult contains the outcome of a single file upload attempt.
type UploadResult struct {
	Success      bool   `json:"success"`
	FileID       string `json:"fileId,omitempty"`
	Filename     string `json:"filename,omitempty"`
	SizeBytes    int64  `json:"sizeBytes,omitempty"`
	ContentType  string `json:"contentType,omitempty"`
	ErrorMessage string `json:"errorMessage,omitempty"`
}

// ReceivedFile contains metadata for a file received from a participant.
type ReceivedFile struct {
	FileID        string `json:"fileId"`
	Filename      string `json:"filename"`
	SizeBytes     int64  `json:"sizeBytes"`
	SizeFormatted string `json:"sizeFormatted"`
}

// BackendController manages the in-process HAMAL server, room lifecycle, and file transfers.
type BackendController struct {
	mu              sync.RWMutex
	uploadMu        sync.Mutex
	status          ServerStatus
	homeState       HomeScreenState
	activeRoom      *ActiveRoom
	outboundFileIDs map[string]struct{} // Files sent by Linux desktop (never emitted as received)
	receivedFileIDs map[string]struct{} // Files received from phone (emitted once)
	server          *server.Server
	httpServer      *http.Server
	listener        net.Listener
	cleanupCancel   context.CancelFunc
	pollCancel      context.CancelFunc
	logger          *slog.Logger
	httpClient      *http.Client
	onFileReceived  func(file ReceivedFile)
}

// NewBackendController creates a new BackendController instance.
func NewBackendController() *BackendController {
	return &BackendController{
		status: ServerStatus{
			Status: "stopped",
		},
		homeState: HomeScreenState{
			Status: "starting",
		},
		outboundFileIDs: make(map[string]struct{}),
		receivedFileIDs: make(map[string]struct{}),
		logger: slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
			Level: slog.LevelInfo,
		})),
		httpClient: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

// resolveDataDir determines the XDG-compliant storage path for HAMAL data on Linux.
func resolveDataDir() string {
	// 1. Follow XDG_DATA_HOME ($XDG_DATA_HOME/HAMAL)
	if xdgData := os.Getenv("XDG_DATA_HOME"); xdgData != "" {
		return filepath.Join(xdgData, "HAMAL")
	}

	// 2. Fallback to ~/.local/share/HAMAL
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		return filepath.Join(home, ".local", "share", "HAMAL")
	}

	// 3. Fallback to UserConfigDir or Temp
	if cfg, err := os.UserConfigDir(); err == nil && cfg != "" {
		return filepath.Join(cfg, "HAMAL")
	}

	return filepath.Join(os.TempDir(), "HAMAL")
}

// SetOnFileReceived registers a callback invoked when a new inbound file is detected from a participant.
func (b *BackendController) SetOnFileReceived(callback func(file ReceivedFile)) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.onFileReceived = callback
}

// Start initializes and starts the in-process HAMAL backend and transitions to setup state.
func (b *BackendController) Start() error {
	b.mu.Lock()
	if b.status.Status == "running" {
		b.mu.Unlock()
		return nil
	}

	b.status.Status = "starting"
	b.status.ErrorMessage = ""
	b.homeState.Status = "starting"
	b.homeState.ErrorMessage = ""
	b.outboundFileIDs = make(map[string]struct{})
	b.receivedFileIDs = make(map[string]struct{})
	b.mu.Unlock()

	// 1. Determine Linux XDG data directory
	dataDir := resolveDataDir()
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		b.setError("Failed to create application data directory", err)
		return err
	}

	// 2. Bind to dynamic TCP port on 0.0.0.0
	listener, err := net.Listen("tcp", "0.0.0.0:0")
	if err != nil {
		b.setError("Failed to bind network port", err)
		return err
	}

	port := listener.Addr().(*net.TCPAddr).Port
	localURL := fmt.Sprintf("http://127.0.0.1:%d", port)
	lanIP := detectLanIPv4()
	lanURL := fmt.Sprintf("http://%s:%d", lanIP, port)

	b.mu.Lock()
	b.listener = listener
	b.status.DataDir = dataDir
	b.status.Port = port
	b.status.LocalURL = localURL
	b.status.LanIP = lanIP
	b.status.LanURL = lanURL
	b.homeState.LocalURL = localURL
	b.homeState.LanURL = lanURL
	b.mu.Unlock()

	// 3. Initialize HAMAL server facade with BaseURL set to LAN URL
	srv, err := server.New(server.Options{
		DataDir:    dataDir,
		ListenAddr: fmt.Sprintf("0.0.0.0:%d", port),
		BaseURL:    lanURL,
		LogLevel:   "info",
		LogFormat:  "text",
	}, b.logger)
	if err != nil {
		_ = listener.Close()
		b.setError("Failed to initialize HAMAL server", err)
		return err
	}

	b.mu.Lock()
	b.server = srv
	b.mu.Unlock()

	// 4. Initial cleanup pass
	cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
	_ = srv.RunCleanupOnce(cleanupCtx)
	cleanupCancel()

	// 5. Start background cleanup worker
	workerCtx, workerCancel := context.WithCancel(context.Background())
	b.mu.Lock()
	b.cleanupCancel = workerCancel
	b.mu.Unlock()
	go srv.StartCleanup(workerCtx)

	// 6. Start HTTP Server
	httpSrv := &http.Server{
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	b.mu.Lock()
	b.httpServer = httpSrv
	b.mu.Unlock()

	go func() {
		if err := httpSrv.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			b.logger.Error("embedded server error", "error", err)
		}
	}()

	// 7. Wait for /readyz and transition to setup screen
	go b.initializeRoomOnStartup()

	return nil
}

// initializeRoomOnStartup waits for the server to be ready and presents the setup screen.
func (b *BackendController) initializeRoomOnStartup() {
	time.Sleep(50 * time.Millisecond)

	b.mu.RLock()
	localURL := b.status.LocalURL
	b.mu.RUnlock()

	ready := false
	for i := 0; i < 50; i++ {
		resp, err := b.httpClient.Get(localURL + "/readyz")
		if err == nil {
			var body map[string]string
			if json.NewDecoder(resp.Body).Decode(&body) == nil && body["status"] == "ready" {
				ready = true
				_ = resp.Body.Close()
				break
			}
			_ = resp.Body.Close()
		}
		time.Sleep(100 * time.Millisecond)
	}

	if !ready {
		b.setError("HAMAL server readiness check timed out", errors.New("readyz timeout"))
		return
	}

	b.mu.Lock()
	b.status.HealthStatus = "ok"
	b.status.ReadyStatus = "ready"
	b.status.Status = "running"
	b.homeState.Status = "setup" // Present the room configuration screen!
	b.homeState.ErrorMessage = ""
	b.mu.Unlock()
}

// CreateRoom calls CreateRoomWithConfig with default 3600 seconds and no PIN.
func (b *BackendController) CreateRoom() error {
	_, err := b.CreateRoomWithConfig(3600, "")
	return err
}

// CreateRoomWithConfig calls the HAMAL HTTP API to create a new room with custom TTL and optional PIN.
func (b *BackendController) CreateRoomWithConfig(ttlSeconds int, pin string) (HomeScreenState, error) {
	// Check the PIN first: the server rejects anything but 4 to 8 digits.
	pin = strings.TrimSpace(pin)
	if pin != "" {
		if !isValidPIN(pin) {
			err := errors.New("PIN must be 4 to 8 digits")
			return b.GetHomeScreenState(), err
		}
	}

	b.mu.RLock()
	localURL := b.status.LocalURL
	isServerRunning := b.status.Status == "running"
	b.mu.RUnlock()

	if !isServerRunning {
		err := errors.New("server is not ready")
		b.setError("Unable to start HAMAL (server not ready)", err)
		return b.GetHomeScreenState(), err
	}

	if ttlSeconds <= 0 {
		ttlSeconds = 3600
	}

	// 1. Call POST /api/v1/rooms with configured TTL and optional PIN
	reqPayload := map[string]interface{}{
		"ttl_seconds": ttlSeconds,
	}
	if pin != "" {
		reqPayload["pin"] = pin
	}
	reqBytes, err := json.Marshal(reqPayload)
	if err != nil {
		b.setError("Unable to serialize room request", err)
		return b.GetHomeScreenState(), err
	}

	resp, err := b.httpClient.Post(localURL+"/api/v1/rooms", "application/json", bytes.NewReader(reqBytes))
	if err != nil {
		b.setError("Unable to create room (API request failed)", err)
		return b.GetHomeScreenState(), err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusCreated {
		bodyBytes, _ := io.ReadAll(resp.Body)
		err := fmt.Errorf("room API returned HTTP %d: %s", resp.StatusCode, string(bodyBytes))
		b.setError("Unable to create room (unexpected response)", err)
		return b.GetHomeScreenState(), err
	}

	var roomData struct {
		RoomID           string `json:"room_id"`
		CreatorToken     string `json:"creator_token"`
		CreatorURL       string `json:"creator_url"`
		ParticipantToken string `json:"participant_token"`
		ParticipantURL   string `json:"participant_url"`
		ExpiresAt        string `json:"expires_at"`
		PinRequired      bool   `json:"pin_required"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&roomData); err != nil {
		b.setError("Unable to parse room response", err)
		return b.GetHomeScreenState(), err
	}

	// 2. Fetch QR SVG via GET /api/v1/rooms/{creator_token}/qr.svg
	qrResp, err := b.httpClient.Get(localURL + "/api/v1/rooms/" + roomData.CreatorToken + "/qr.svg")
	if err != nil {
		b.setError("Unable to retrieve QR code", err)
		return b.GetHomeScreenState(), err
	}
	defer qrResp.Body.Close()

	if qrResp.StatusCode != http.StatusOK {
		err := fmt.Errorf("QR API returned HTTP %d", qrResp.StatusCode)
		b.setError("Unable to retrieve QR code", err)
		return b.GetHomeScreenState(), err
	}

	svgBytes, err := io.ReadAll(qrResp.Body)
	if err != nil {
		b.setError("Unable to read QR code", err)
		return b.GetHomeScreenState(), err
	}

	expiresTime, _ := time.Parse(time.RFC3339, roomData.ExpiresAt)

	active := &ActiveRoom{
		RoomID:           roomData.RoomID,
		CreatorToken:     roomData.CreatorToken,
		ParticipantToken: roomData.ParticipantToken,
		CreatorURL:       roomData.CreatorURL,
		ParticipantURL:   roomData.ParticipantURL,
		ExpiresAt:        expiresTime,
		PinRequired:      roomData.PinRequired,
		QRSVG:            string(svgBytes),
	}

	b.mu.Lock()
	b.activeRoom = active
	b.outboundFileIDs = make(map[string]struct{})
	b.receivedFileIDs = make(map[string]struct{})
	b.homeState = HomeScreenState{
		Status:         "ready",
		RoomID:         roomData.RoomID,
		ParticipantURL: roomData.ParticipantURL,
		QRSVG:          string(svgBytes),
		ExpiresAt:      roomData.ExpiresAt,
		PinRequired:    roomData.PinRequired,
		LanURL:         b.status.LanURL,
		LocalURL:       b.status.LocalURL,
	}
	b.mu.Unlock()

	// Start background polling worker for inbound files
	b.startFilePolling()

	b.logger.Info("room successfully initialized",
		"room_id", roomData.RoomID,
		"participant_url", roomData.ParticipantURL,
		"expires_at", roomData.ExpiresAt,
		"pin_required", roomData.PinRequired,
	)

	return b.GetHomeScreenState(), nil
}

// startFilePolling runs a periodic check against the HAMAL file list endpoint.
func (b *BackendController) startFilePolling() {
	b.mu.Lock()
	if b.pollCancel != nil {
		b.pollCancel()
	}
	ctx, cancel := context.WithCancel(context.Background())
	b.pollCancel = cancel
	b.mu.Unlock()

	// Initial baseline
	b.checkNewFiles()

	go func() {
		ticker := time.NewTicker(1500 * time.Millisecond)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				b.checkNewFiles()
			}
		}
	}()
}

// checkNewFiles queries the HAMAL file listing API using the creator token.
func (b *BackendController) checkNewFiles() {
	b.mu.RLock()
	active := b.activeRoom
	localURL := b.status.LocalURL
	isRunning := b.status.Status == "running"
	b.mu.RUnlock()

	if !isRunning || active == nil || active.CreatorToken == "" {
		return
	}

	listURL := fmt.Sprintf("%s/api/v1/rooms/%s/files", localURL, active.CreatorToken)
	resp, err := b.httpClient.Get(listURL)
	if err != nil {
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusGone || resp.StatusCode == http.StatusNotFound {
		b.mu.Lock()
		if b.homeState.Status == "ready" || b.homeState.Status == "closing" {
			b.homeState.Status = "closed"
			b.activeRoom = nil
		}
		b.mu.Unlock()
		return
	}

	if resp.StatusCode != http.StatusOK {
		return
	}

	var listData struct {
		RoomID                  string `json:"room_id"`
		Status                  string `json:"status"`
		CloseDeadline           string `json:"close_deadline,omitempty"`
		ClosingRemainingSeconds int    `json:"closing_remaining_seconds,omitempty"`
		Files                   []struct {
			FileID      string `json:"file_id"`
			Filename    string `json:"filename"`
			SizeBytes   int64  `json:"size_bytes"`
			ContentType string `json:"content_type"`
			Status      string `json:"status"`
		} `json:"files"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&listData); err != nil {
		return
	}

	b.mu.Lock()
	if listData.Status == "closing" {
		b.homeState.Status = "closing"
		b.homeState.ClosingRemainingSeconds = listData.ClosingRemainingSeconds
		b.homeState.CloseDeadline = listData.CloseDeadline
	} else if listData.Status == "closed" {
		b.homeState.Status = "closed"
		b.activeRoom = nil
	}
	b.mu.Unlock()

	for _, f := range listData.Files {
		if f.Status != "ready" {
			continue
		}

		b.mu.Lock()
		if b.outboundFileIDs == nil {
			b.outboundFileIDs = make(map[string]struct{})
		}
		if b.receivedFileIDs == nil {
			b.receivedFileIDs = make(map[string]struct{})
		}

		// Rule 1: Never treat desktop outbound uploads as received files
		if _, isOutbound := b.outboundFileIDs[f.FileID]; isOutbound {
			b.mu.Unlock()
			continue
		}

		// Rule 2: Never re-emit already received files
		if _, alreadyReceived := b.receivedFileIDs[f.FileID]; alreadyReceived {
			b.mu.Unlock()
			continue
		}

		// Rule 3: Mark as received and notify callback
		b.receivedFileIDs[f.FileID] = struct{}{}
		callback := b.onFileReceived
		b.mu.Unlock()

		if callback != nil {
			rf := ReceivedFile{
				FileID:        f.FileID,
				Filename:      f.Filename,
				SizeBytes:     f.SizeBytes,
				SizeFormatted: formatBytes(f.SizeBytes),
			}
			b.logger.Info("inbound file received from phone participant",
				"file_id", f.FileID,
				"filename", f.Filename,
				"size", rf.SizeFormatted,
			)
			callback(rf)
		}
	}
}

// UploadFile sends a single local file to the active HAMAL room via the HTTP API.
func (b *BackendController) UploadFile(filePath string, progressCallback func(percent int)) UploadResult {
	b.uploadMu.Lock()
	defer b.uploadMu.Unlock()

	b.mu.RLock()
	active := b.activeRoom
	localURL := b.status.LocalURL
	b.mu.RUnlock()

	if active == nil || active.CreatorToken == "" {
		b.logger.Error("UploadFile failed: no active room available")
		return UploadResult{
			Success:      false,
			ErrorMessage: "No active room available. Please wait or retry.",
		}
	}

	// 1. Validate file path
	fi, err := os.Stat(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			b.logger.Error("UploadFile failed: file not found", "path", filePath)
			return UploadResult{
				Success:      false,
				ErrorMessage: "File does not exist: " + filepath.Base(filePath),
			}
		}
		b.logger.Error("UploadFile failed: stat error", "path", filePath, "error", err)
		return UploadResult{
			Success:      false,
			ErrorMessage: fmt.Sprintf("Cannot access file: %v", err),
		}
	}

	// 2. Validate regular file
	if fi.IsDir() {
		b.logger.Error("UploadFile failed: path is directory", "path", filePath)
		return UploadResult{
			Success:      false,
			ErrorMessage: "Directories cannot be sent. Please drop a single file.",
		}
	}
	if !fi.Mode().IsRegular() {
		b.logger.Error("UploadFile failed: not a regular file", "path", filePath)
		return UploadResult{
			Success:      false,
			ErrorMessage: "Special files cannot be sent. Please drop a regular file.",
		}
	}
	if fi.Size() == 0 {
		b.logger.Error("UploadFile failed: empty file", "path", filePath)
		return UploadResult{
			Success:      false,
			ErrorMessage: "Uploaded file is empty (0 bytes).",
		}
	}

	// 3. Open file for reading
	fileHandle, err := os.Open(filePath)
	if err != nil {
		b.logger.Error("UploadFile failed: open error", "path", filePath, "error", err)
		return UploadResult{
			Success:      false,
			ErrorMessage: fmt.Sprintf("Failed to open file: %v", err),
		}
	}
	defer fileHandle.Close()

	// 4. Stream multipart/form-data upload using io.Pipe
	pr, pw := io.Pipe()
	multipartWriter := multipart.NewWriter(pw)

	filename := filepath.Base(filePath)
	totalSize := fi.Size()

	uploadURL := fmt.Sprintf("%s/api/v1/rooms/%s/files", localURL, active.CreatorToken)
	b.logger.Info("Starting file upload", "filename", filename, "size_bytes", totalSize, "upload_url", uploadURL)

	req, err := http.NewRequest(http.MethodPost, uploadURL, pr)
	if err != nil {
		_ = pr.Close()
		_ = pw.Close()
		b.logger.Error("UploadFile failed: create request error", "error", err)
		return UploadResult{
			Success:      false,
			ErrorMessage: fmt.Sprintf("Failed to create upload request: %v", err),
		}
	}
	req.Header.Set("Content-Type", multipartWriter.FormDataContentType())

	go func() {
		part, err := multipartWriter.CreateFormFile("file", filename)
		if err != nil {
			b.logger.Error("UploadFile: CreateFormFile error", "error", err)
			_ = pw.CloseWithError(err)
			return
		}

		var written int64
		buf := make([]byte, 64*1024)
		for {
			n, rErr := fileHandle.Read(buf)
			if n > 0 {
				wn, wErr := part.Write(buf[:n])
				if wErr != nil {
					b.logger.Error("UploadFile: part write error", "error", wErr)
					_ = pw.CloseWithError(wErr)
					return
				}
				written += int64(wn)
				if progressCallback != nil && totalSize > 0 {
					pct := int((written * 100) / totalSize)
					if pct > 100 {
						pct = 100
					}
					progressCallback(pct)
				}
			}
			if rErr != nil {
				if rErr == io.EOF {
					break
				}
				b.logger.Error("UploadFile: read source file error", "error", rErr)
				_ = pw.CloseWithError(rErr)
				return
			}
		}

		err = multipartWriter.Close()
		_ = pw.CloseWithError(err)
	}()

	resp, err := b.httpClient.Do(req)
	if err != nil {
		_ = pr.Close()
		b.logger.Error("UploadFile: HTTP Do error", "error", err)
		return UploadResult{
			Success:      false,
			ErrorMessage: fmt.Sprintf("Upload connection failed: %v", err),
		}
	}
	defer resp.Body.Close()

	b.logger.Info("Upload HTTP response status", "status_code", resp.StatusCode)

	if resp.StatusCode != http.StatusCreated {
		bodyBytes, _ := io.ReadAll(resp.Body)
		b.logger.Error("Upload rejected by server", "status_code", resp.StatusCode, "response_body", string(bodyBytes))
		var errResp struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(bodyBytes, &errResp)
		msg := errResp.Error
		if msg == "" {
			msg = fmt.Sprintf("Server returned status %d", resp.StatusCode)
		}
		return UploadResult{
			Success:      false,
			ErrorMessage: msg,
		}
	}

	var fileResp struct {
		FileID      string `json:"file_id"`
		Filename    string `json:"filename"`
		SizeBytes   int64  `json:"size_bytes"`
		ContentType string `json:"content_type"`
		Status      string `json:"status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&fileResp); err != nil {
		b.logger.Error("UploadFile: JSON decode error", "error", err)
		return UploadResult{
			Success:      false,
			ErrorMessage: "Failed to parse upload response",
		}
	}

	// Register in outboundFileIDs so Linux desktop never classifies this as an inbound/received file
	b.mu.Lock()
	if b.outboundFileIDs == nil {
		b.outboundFileIDs = make(map[string]struct{})
	}
	b.outboundFileIDs[fileResp.FileID] = struct{}{}
	b.mu.Unlock()

	b.logger.Info("file successfully uploaded via desktop drop",
		"file_id", fileResp.FileID,
		"filename", fileResp.Filename,
		"size_bytes", fileResp.SizeBytes,
	)

	return UploadResult{
		Success:     true,
		FileID:      fileResp.FileID,
		Filename:    fileResp.Filename,
		SizeBytes:   fileResp.SizeBytes,
		ContentType: fileResp.ContentType,
	}
}

// UploadFiles uploads multiple local files sequentially to the active HAMAL room.
func (b *BackendController) UploadFiles(filePaths []string, progressCallback func(index int, total int, filename string, percent int)) []UploadResult {
	results := make([]UploadResult, len(filePaths))
	total := len(filePaths)

	for i, fp := range filePaths {
		fname := filepath.Base(fp)
		if progressCallback != nil {
			progressCallback(i+1, total, fname, 0)
		}

		res := b.UploadFile(fp, func(pct int) {
			if progressCallback != nil {
				progressCallback(i+1, total, fname, pct)
			}
		})

		results[i] = res
	}

	return results
}

// DownloadFileToPath downloads a file from the active room directly to the specified destination path.
func (b *BackendController) DownloadFileToPath(fileID, targetPath string) error {
	b.mu.RLock()
	active := b.activeRoom
	localURL := b.status.LocalURL
	b.mu.RUnlock()

	if active == nil || active.CreatorToken == "" {
		return errors.New("no active room available")
	}

	downloadURL := fmt.Sprintf("%s/api/v1/rooms/%s/files/%s", localURL, active.CreatorToken, fileID)
	b.logger.Info("Downloading file from room", "file_id", fileID, "target_path", targetPath, "download_url", downloadURL)

	resp, err := b.httpClient.Get(downloadURL)
	if err != nil {
		b.logger.Error("Download request failed", "file_id", fileID, "error", err)
		return fmt.Errorf("download request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		b.logger.Error("Download server returned non-200", "file_id", fileID, "status_code", resp.StatusCode)
		return fmt.Errorf("download server returned HTTP %d", resp.StatusCode)
	}

	out, err := os.Create(targetPath)
	if err != nil {
		b.logger.Error("Failed to create destination file", "target_path", targetPath, "error", err)
		return fmt.Errorf("failed to create destination file: %w", err)
	}
	defer out.Close()

	_, err = io.Copy(out, resp.Body)
	if err != nil {
		b.logger.Error("Failed to stream downloaded content to disk", "error", err)
		return fmt.Errorf("failed to write file content: %w", err)
	}

	b.logger.Info("File successfully downloaded and saved to disk",
		"file_id", fileID,
		"target_path", targetPath,
	)

	return nil
}

// setError updates internal state to error and logs the cause.
func (b *BackendController) setError(userMessage string, err error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.homeState = HomeScreenState{
		Status:       "error",
		ErrorMessage: userMessage,
	}
	b.status.Status = "error"
	b.status.ErrorMessage = fmt.Sprintf("%s: %v", userMessage, err)
	b.logger.Error(userMessage, "error", err)
}

// GetHomeScreenState returns the current UI state for the home screen.
func (b *BackendController) GetHomeScreenState() HomeScreenState {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.homeState
}

// GetStatus returns the low-level server status.
func (b *BackendController) GetStatus() ServerStatus {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.status
}

// Retry resets the UI to setup state if the server is running, or restarts the server.
func (b *BackendController) Retry() HomeScreenState {
	b.mu.RLock()
	isServerRunning := b.status.Status == "running"
	b.mu.RUnlock()

	if !isServerRunning {
		_ = b.Start()
		return b.GetHomeScreenState()
	}

	b.mu.Lock()
	b.homeState = HomeScreenState{
		Status:   "setup",
		LocalURL: b.status.LocalURL,
		LanURL:   b.status.LanURL,
	}
	b.mu.Unlock()
	return b.GetHomeScreenState()
}

// CloseRoom closes the active room via the backend API and stops participant polling.
func (b *BackendController) CloseRoom() HomeScreenState {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.activeRoom != nil && b.status.LocalURL != "" {
		closeURL := fmt.Sprintf("%s/api/v1/rooms/%s/close", b.status.LocalURL, b.activeRoom.CreatorToken)
		req, err := http.NewRequest("POST", closeURL, nil)
		if err == nil && b.httpClient != nil {
			resp, doErr := b.httpClient.Do(req)
			if doErr == nil && resp != nil {
				_ = resp.Body.Close()
			}
		}
	}

	if b.pollCancel != nil {
		b.pollCancel()
		b.pollCancel = nil
	}

	b.activeRoom = nil
	b.outboundFileIDs = make(map[string]struct{})
	b.receivedFileIDs = make(map[string]struct{})
	b.homeState = HomeScreenState{
		Status:   "closed",
		LocalURL: b.status.LocalURL,
		LanURL:   b.status.LanURL,
	}
	return b.homeState
}

// ResetToSetup cancels any active room polling, clears active room session,
// and sets the home screen state to "setup".
func (b *BackendController) ResetToSetup() HomeScreenState {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.pollCancel != nil {
		b.pollCancel()
		b.pollCancel = nil
	}
	b.activeRoom = nil
	b.outboundFileIDs = make(map[string]struct{})
	b.receivedFileIDs = make(map[string]struct{})

	b.homeState = HomeScreenState{
		Status:   "setup",
		LocalURL: b.status.LocalURL,
		LanURL:   b.status.LanURL,
	}
	return b.homeState
}

// Stop cleanly shuts down the embedded HAMAL server and polling routines.
func (b *BackendController) Stop() error {
	b.mu.Lock()
	defer b.mu.Unlock()

	if b.status.Status == "stopped" {
		return nil
	}

	b.status.Status = "stopped"
	b.homeState.Status = "stopped"

	if b.pollCancel != nil {
		b.pollCancel()
	}

	if b.cleanupCancel != nil {
		b.cleanupCancel()
	}

	if b.httpServer != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_ = b.httpServer.Shutdown(ctx)
	}

	if b.server != nil {
		_ = b.server.Close()
	}

	return nil
}

// formatBytes returns a human-readable string for byte quantities.
func formatBytes(b int64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(b)/float64(div), "KMGTPE"[exp])
}

// detectLanIPv4 detects the preferred local non-loopback IPv4 address.
func detectLanIPv4() string {
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err == nil {
		defer conn.Close()
		if localAddr, ok := conn.LocalAddr().(*net.UDPAddr); ok {
			ip := localAddr.IP.To4()
			if ip != nil && !ip.IsLoopback() && !ip.IsUnspecified() {
				return ip.String()
			}
		}
	}

	interfaces, err := net.Interfaces()
	if err != nil {
		return "127.0.0.1"
	}

	for _, iface := range interfaces {
		if (iface.Flags&net.FlagUp) == 0 || (iface.Flags&net.FlagLoopback) != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			var ip net.IP
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			if ip == nil || ip.IsLoopback() {
				continue
			}
			ip4 := ip.To4()
			if ip4 != nil && !ip4.IsUnspecified() {
				return ip4.String()
			}
		}
	}

	return "127.0.0.1"
}

// isValidPIN reports whether pin is 4 to 8 ASCII digits, the rule the HAMAL
// server enforces (room.ErrInvalidPIN).
func isValidPIN(pin string) bool {
	if len(pin) < 4 || len(pin) > 8 {
		return false
	}
	for i := 0; i < len(pin); i++ {
		if pin[i] < '0' || pin[i] > '9' {
			return false
		}
	}
	return true
}
