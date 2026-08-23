package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestBackendControllerHomeScreenFlow(t *testing.T) {
	bc := NewBackendController()

	if err := bc.Start(); err != nil {
		t.Fatalf("failed to start backend controller: %v", err)
	}
	defer bc.Stop()

	// Wait up to 5 seconds for backend to reach "setup" state
	var homeState HomeScreenState
	for i := 0; i < 50; i++ {
		time.Sleep(100 * time.Millisecond)
		homeState = bc.GetHomeScreenState()
		if homeState.Status == "setup" {
			break
		}
	}

	if homeState.Status != "setup" {
		t.Fatalf("expected home screen state 'setup', got '%s' (error: %s)", homeState.Status, homeState.ErrorMessage)
	}

	// 1. Create Room with custom TTL and optional PIN
	readyHomeState, err := bc.CreateRoomWithConfig(3600, "1234")
	if err != nil {
		t.Fatalf("failed to create room with config: %v", err)
	}
	if readyHomeState.Status != "ready" {
		t.Fatalf("expected status 'ready', got '%s'", readyHomeState.Status)
	}
	if !readyHomeState.PinRequired {
		t.Fatal("expected PinRequired to be true when PIN was specified")
	}
	if readyHomeState.RoomID == "" {
		t.Fatal("expected non-empty RoomID in home state")
	}
	if readyHomeState.ParticipantURL == "" {
		t.Fatal("expected non-empty ParticipantURL in home state")
	}

	// Check QR SVG content
	if !strings.Contains(readyHomeState.QRSVG, "<svg") || !strings.Contains(readyHomeState.QRSVG, "</svg>") {
		t.Fatalf("expected valid SVG string in QRSVG, got: %s", readyHomeState.QRSVG)
	}

	// Test GET request on local server to check participant page HTTP response
	status := bc.GetStatus()
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(status.LocalURL + "/r/" + strings.TrimPrefix(readyHomeState.ParticipantURL, readyHomeState.LanURL+"/r/"))
	if err != nil {
		t.Fatalf("failed to GET participant page locally: %v", err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK from participant page, got %d", resp.StatusCode)
	}

	// Verify embedded site.js served over HTTP contains the reverse ordering code
	jsResp, err := client.Get(status.LocalURL + "/static/site.js")
	if err != nil {
		t.Fatalf("failed to GET /static/site.js: %v", err)
	}
	jsBytes, err := io.ReadAll(jsResp.Body)
	_ = jsResp.Body.Close()
	if jsResp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 OK from /static/site.js, got %d", jsResp.StatusCode)
	}
	if !strings.Contains(string(jsBytes), "const orderedFiles = [...files].reverse();") {
		t.Fatalf("embedded site.js does not contain reverse ordering code")
	}

	// Test Retry -> transitions back to setup
	recreatedState := bc.Retry()
	if recreatedState.Status != "setup" {
		t.Fatalf("expected status 'setup' after Retry, got '%s'", recreatedState.Status)
	}

	// Test Clean Stop
	if err := bc.Stop(); err != nil {
		t.Fatalf("failed to stop backend: %v", err)
	}

	if bc.GetHomeScreenState().Status != "stopped" {
		t.Fatalf("expected status 'stopped' after Stop, got '%s'", bc.GetHomeScreenState().Status)
	}
}

func TestSingleAndMultiFileUploadNoDuplicates(t *testing.T) {
	bc := NewBackendController()
	if err := bc.Start(); err != nil {
		t.Fatalf("failed to start backend: %v", err)
	}
	defer bc.Stop()

	// Wait for setup
	for i := 0; i < 50; i++ {
		time.Sleep(100 * time.Millisecond)
		if bc.GetHomeScreenState().Status == "setup" {
			break
		}
	}

	// Create room
	if err := bc.CreateRoom(); err != nil {
		t.Fatalf("failed to create room: %v", err)
	}

	tempDir := t.TempDir()

	// 1. Single file upload creates exactly 1 file record
	singleFilePath := filepath.Join(tempDir, "single_doc.txt")
	_ = os.WriteFile(singleFilePath, []byte("Single document content for Linux test"), 0644)

	res := bc.UploadFile(singleFilePath, nil)
	if !res.Success {
		t.Fatalf("expected upload success, got error: %s", res.ErrorMessage)
	}
	if res.FileID == "" {
		t.Fatal("expected non-empty FileID")
	}

	status := bc.GetStatus()
	client := &http.Client{Timeout: 5 * time.Second}
	active := bc.activeRoom

	listResp, err := client.Get(fmt.Sprintf("%s/api/v1/rooms/%s/files", status.LocalURL, active.ParticipantToken))
	if err != nil {
		t.Fatalf("failed to list files for participant: %v", err)
	}
	defer listResp.Body.Close()

	var listData struct {
		Files []struct {
			FileID   string `json:"file_id"`
			Filename string `json:"filename"`
		} `json:"files"`
	}
	if err := json.NewDecoder(listResp.Body).Decode(&listData); err != nil {
		t.Fatalf("failed to decode list: %v", err)
	}

	if len(listData.Files) != 1 {
		t.Fatalf("expected exactly 1 file in room after single upload, got %d", len(listData.Files))
	}
	if listData.Files[0].FileID != res.FileID {
		t.Fatalf("file ID mismatch: expected %s, got %s", res.FileID, listData.Files[0].FileID)
	}

	// 2. Batch of 3 files creates exactly 3 additional files (total 4)
	f1 := filepath.Join(tempDir, "batch1.txt")
	f2 := filepath.Join(tempDir, "batch2.txt")
	f3 := filepath.Join(tempDir, "batch3.txt")
	_ = os.WriteFile(f1, []byte("b1"), 0644)
	_ = os.WriteFile(f2, []byte("b2"), 0644)
	_ = os.WriteFile(f3, []byte("b3"), 0644)

	batchResults := bc.UploadFiles([]string{f1, f2, f3}, nil)
	if len(batchResults) != 3 {
		t.Fatalf("expected 3 batch results, got %d", len(batchResults))
	}
	for i, r := range batchResults {
		if !r.Success {
			t.Fatalf("batch item %d failed: %s", i, r.ErrorMessage)
		}
	}

	listResp2, err := client.Get(fmt.Sprintf("%s/api/v1/rooms/%s/files", status.LocalURL, active.ParticipantToken))
	if err != nil {
		t.Fatalf("failed to list files for participant: %v", err)
	}
	defer listResp2.Body.Close()

	var listData2 struct {
		Files []struct {
			FileID string `json:"file_id"`
		} `json:"files"`
	}
	_ = json.NewDecoder(listResp2.Body).Decode(&listData2)

	if len(listData2.Files) != 4 {
		t.Fatalf("expected exactly 4 files in room (1 + 3), got %d", len(listData2.Files))
	}
}

func TestDirectionalFilteringLinuxSentNeverAppearsInReceived(t *testing.T) {
	bc := NewBackendController()

	var receivedMu sync.Mutex
	var receivedFiles []ReceivedFile

	bc.SetOnFileReceived(func(file ReceivedFile) {
		receivedMu.Lock()
		defer receivedMu.Unlock()
		receivedFiles = append(receivedFiles, file)
	})

	if err := bc.Start(); err != nil {
		t.Fatalf("failed to start backend controller: %v", err)
	}
	defer bc.Stop()

	// Wait for setup
	for i := 0; i < 50; i++ {
		time.Sleep(100 * time.Millisecond)
		if bc.GetHomeScreenState().Status == "setup" {
			break
		}
	}

	if err := bc.CreateRoom(); err != nil {
		t.Fatalf("failed to create room: %v", err)
	}

	status := bc.GetStatus()
	active := bc.activeRoom
	tempDir := t.TempDir()
	client := &http.Client{Timeout: 5 * time.Second}

	// 1. Linux uploads A.jpg, B.jpg, C.pdf (Outbound)
	pathA := filepath.Join(tempDir, "A.jpg")
	pathB := filepath.Join(tempDir, "B.jpg")
	pathC := filepath.Join(tempDir, "C.pdf")
	_ = os.WriteFile(pathA, []byte("Content A"), 0644)
	_ = os.WriteFile(pathB, []byte("Content B"), 0644)
	_ = os.WriteFile(pathC, []byte("Content C"), 0644)

	resA := bc.UploadFile(pathA, nil)
	resB := bc.UploadFile(pathB, nil)
	resC := bc.UploadFile(pathC, nil)

	if !resA.Success || !resB.Success || !resC.Success {
		t.Fatalf("failed to upload Linux desktop files: %v, %v, %v", resA, resB, resC)
	}

	// Wait 2 polling cycles (3 seconds) to verify Linux sent files NEVER trigger onFileReceived
	time.Sleep(3 * time.Second)
	receivedMu.Lock()
	if len(receivedFiles) != 0 {
		receivedMu.Unlock()
		t.Fatalf("expected 0 received files for Linux outbound uploads, got %d", len(receivedFiles))
	}
	receivedMu.Unlock()

	// 2. Phone uploads D.jpg (Inbound)
	var bodyD bytes.Buffer
	writerD := multipart.NewWriter(&bodyD)
	partD, _ := writerD.CreateFormFile("file", "D.jpg")
	_, _ = partD.Write([]byte("Content D from Phone"))
	_ = writerD.Close()

	uploadURL := fmt.Sprintf("%s/api/v1/rooms/%s/files", status.LocalURL, active.ParticipantToken)
	reqD, _ := http.NewRequest(http.MethodPost, uploadURL, &bodyD)
	reqD.Header.Set("Content-Type", writerD.FormDataContentType())

	respD, err := client.Do(reqD)
	if err != nil {
		t.Fatalf("phone upload D failed: %v", err)
	}
	_ = respD.Body.Close()
	if respD.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201 Created for D, got %d", respD.StatusCode)
	}

	// Wait for polling loop to detect D.jpg
	for i := 0; i < 40; i++ {
		time.Sleep(100 * time.Millisecond)
		receivedMu.Lock()
		count := len(receivedFiles)
		receivedMu.Unlock()
		if count >= 1 {
			break
		}
	}

	// Verify ONLY D.jpg was received, NOT A, B, or C!
	receivedMu.Lock()
	if len(receivedFiles) != 1 {
		t.Fatalf("expected exactly 1 received file (D.jpg), got %d: %+v", len(receivedFiles), receivedFiles)
	}
	if receivedFiles[0].Filename != "D.jpg" {
		t.Fatalf("expected received file 'D.jpg', got '%s'", receivedFiles[0].Filename)
	}
	receivedMu.Unlock()

	// 3. Linux uploads E.pdf (Outbound)
	pathE := filepath.Join(tempDir, "E.pdf")
	_ = os.WriteFile(pathE, []byte("Content E from Linux"), 0644)
	resE := bc.UploadFile(pathE, nil)
	if !resE.Success {
		t.Fatalf("upload E failed: %s", resE.ErrorMessage)
	}

	// 4. Phone uploads F.jpg (Inbound)
	var bodyF bytes.Buffer
	writerF := multipart.NewWriter(&bodyF)
	partF, _ := writerF.CreateFormFile("file", "F.jpg")
	_, _ = partF.Write([]byte("Content F from Phone"))
	_ = writerF.Close()

	reqF, _ := http.NewRequest(http.MethodPost, uploadURL, &bodyF)
	reqF.Header.Set("Content-Type", writerF.FormDataContentType())

	respF, err := client.Do(reqF)
	if err != nil {
		t.Fatalf("phone upload F failed: %v", err)
	}
	_ = respF.Body.Close()

	// Wait for polling loop to detect F.jpg
	for i := 0; i < 40; i++ {
		time.Sleep(100 * time.Millisecond)
		receivedMu.Lock()
		count := len(receivedFiles)
		receivedMu.Unlock()
		if count >= 2 {
			break
		}
	}

	// Verify received list contains ONLY [D.jpg, F.jpg] and NEVER [A, B, C, E]!
	receivedMu.Lock()
	defer receivedMu.Unlock()

	if len(receivedFiles) != 2 {
		t.Fatalf("expected exactly 2 received files (D.jpg, F.jpg), got %d: %+v", len(receivedFiles), receivedFiles)
	}
	if receivedFiles[0].Filename != "D.jpg" || receivedFiles[1].Filename != "F.jpg" {
		t.Fatalf("unexpected received list: %+v", receivedFiles)
	}
}

func TestReceivedFilesStatePreservationAndOrdering(t *testing.T) {
	type UIFileState struct {
		FileID   string
		Filename string
		Saved    bool
		Order    int
	}

	stateMap := make(map[string]*UIFileState)
	orderCounter := 0

	addOrUpdate := func(fileID, filename string) {
		if existing, ok := stateMap[fileID]; ok {
			existing.Filename = filename
		} else {
			orderCounter++
			stateMap[fileID] = &UIFileState{
				FileID:   fileID,
				Filename: filename,
				Saved:    false,
				Order:    orderCounter,
			}
		}
	}

	markSaved := func(fileID string) {
		if file, ok := stateMap[fileID]; ok {
			file.Saved = true
		}
	}

	getSortedList := func() []*UIFileState {
		list := make([]*UIFileState, 0, len(stateMap))
		for _, f := range stateMap {
			list = append(list, f)
		}
		// Sort descending by Order (newest first)
		for i := 0; i < len(list)-1; i++ {
			for j := i + 1; j < len(list); j++ {
				if list[i].Order < list[j].Order {
					list[i], list[j] = list[j], list[i]
				}
			}
		}
		return list
	}

	// 1. Phone sends A, B, C
	addOrUpdate("f_a", "A.jpg")
	addOrUpdate("f_b", "B.jpg")
	addOrUpdate("f_c", "C.jpg")

	list1 := getSortedList()
	if len(list1) != 3 {
		t.Fatalf("expected 3 files, got %d", len(list1))
	}
	if list1[0].Filename != "C.jpg" || list1[1].Filename != "B.jpg" || list1[2].Filename != "A.jpg" {
		t.Fatalf("expected order [C, B, A], got [%s, %s, %s]", list1[0].Filename, list1[1].Filename, list1[2].Filename)
	}

	// 2. User downloads B.jpg
	markSaved("f_b")
	if !stateMap["f_b"].Saved {
		t.Fatal("expected B to be marked as saved")
	}

	// 3. Phone sends D.jpg
	addOrUpdate("f_d", "D.jpg")

	list2 := getSortedList()
	if len(list2) != 4 {
		t.Fatalf("expected 4 files, got %d", len(list2))
	}
	if list2[0].Filename != "D.jpg" || list2[1].Filename != "C.jpg" || list2[2].Filename != "B.jpg" || list2[3].Filename != "A.jpg" {
		t.Fatalf("expected order [D, C, B, A], got [%s, %s, %s, %s]", list2[0].Filename, list2[1].Filename, list2[2].Filename, list2[3].Filename)
	}

	// Verify B's saved state persisted after D arrived and list was re-sorted
	if !list2[2].Saved {
		t.Fatal("expected B.jpg to still be saved after D.jpg arrived")
	}
	if list2[0].Saved || list2[1].Saved || list2[3].Saved {
		t.Fatal("expected A, C, D to not be saved")
	}

	// 4. Repeated re-render / polling cycles with no new files
	for poll := 0; poll < 5; poll++ {
		listPoll := getSortedList()
		if listPoll[0].Filename != "D.jpg" || listPoll[1].Filename != "C.jpg" || listPoll[2].Filename != "B.jpg" || listPoll[3].Filename != "A.jpg" {
			t.Fatalf("order changed during poll %d", poll)
		}
		if !listPoll[2].Saved {
			t.Fatalf("saved state lost during poll %d", poll)
		}
	}

	// 5. User downloads D.jpg
	markSaved("f_d")

	// 6. Phone sends E.jpg
	addOrUpdate("f_e", "E.jpg")

	list3 := getSortedList()
	if len(list3) != 5 {
		t.Fatalf("expected 5 files, got %d", len(list3))
	}
	if list3[0].Filename != "E.jpg" || list3[1].Filename != "D.jpg" || list3[2].Filename != "C.jpg" || list3[3].Filename != "B.jpg" || list3[4].Filename != "A.jpg" {
		t.Fatalf("expected order [E, D, C, B, A], got [%s, %s, %s, %s, %s]", list3[0].Filename, list3[1].Filename, list3[2].Filename, list3[3].Filename, list3[4].Filename)
	}

	// Verify B and D remain saved, and E, C, A are unsaved
	if !list3[1].Saved {
		t.Fatal("expected D.jpg to remain saved")
	}
	if !list3[3].Saved {
		t.Fatal("expected B.jpg to remain saved")
	}
	if list3[0].Saved || list3[2].Saved || list3[4].Saved {
		t.Fatal("expected E, C, A to not be saved")
	}
}

func TestSubmitFeedback(t *testing.T) {
	app := NewApp()

	// 1. Test unconfigured endpoint behavior
	os.Unsetenv("HAMAL_FEEDBACK_URL")
	res := app.SubmitFeedback(FeedbackPayload{
		Type:    "bug",
		Message: "Test bug message",
		Email:   "test@example.com",
	})
	if res.Configured {
		t.Fatal("expected feedback to be unconfigured by default")
	}
	if res.Success {
		t.Fatal("expected success to be false when unconfigured")
	}
	if res.Message != "Feedback is not available yet. Please try again later." {
		t.Fatalf("unexpected message: %q", res.Message)
	}

	// 2. Test configured mock HTTP endpoint
	mockServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var payload map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		if payload["message"] != "Awesome feedback from Linux" {
			http.Error(w, "invalid message", http.StatusBadRequest)
			return
		}
		if payload["os"] != "linux" {
			http.Error(w, "invalid os", http.StatusBadRequest)
			return
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	}))
	defer mockServer.Close()

	os.Setenv("HAMAL_FEEDBACK_URL", mockServer.URL)
	defer os.Unsetenv("HAMAL_FEEDBACK_URL")

	resSuccess := app.SubmitFeedback(FeedbackPayload{
		Type:    "suggestion",
		Message: "Awesome feedback from Linux",
		Email:   "user@example.com",
	})
	if !resSuccess.Configured {
		t.Fatal("expected feedback to be configured with mock server URL")
	}
	if !resSuccess.Success {
		t.Fatalf("expected success with mock server, got: %s", resSuccess.Message)
	}
	if resSuccess.Message != "Thank you for helping us improve HAMAL ❤️" {
		t.Fatalf("unexpected success message: %q", resSuccess.Message)
	}
}

func TestRoomCreationLifespanAndPINConfig(t *testing.T) {
	bc := NewBackendController()
	if err := bc.Start(); err != nil {
		t.Fatalf("failed to start backend: %v", err)
	}
	defer bc.Stop()

	// Wait for setup
	for i := 0; i < 50; i++ {
		time.Sleep(100 * time.Millisecond)
		if bc.GetHomeScreenState().Status == "setup" {
			break
		}
	}

	// 1. Test invalid short PIN
	_, err := bc.CreateRoomWithConfig(3600, "12")
	if err == nil {
		t.Fatal("expected error for short PIN (2 chars)")
	}

	// 2. Test invalid long PIN
	_, err = bc.CreateRoomWithConfig(3600, "123456789")
	if err == nil {
		t.Fatal("expected error for long PIN (9 chars)")
	}

	// 3. Test room creation without PIN (default TTL 3600)
	stateNoPIN, err := bc.CreateRoomWithConfig(3600, "")
	if err != nil {
		t.Fatalf("failed to create room without PIN: %v", err)
	}
	if stateNoPIN.Status != "ready" {
		t.Fatalf("expected status 'ready', got '%s'", stateNoPIN.Status)
	}
	if stateNoPIN.PinRequired {
		t.Fatal("expected PinRequired=false for empty PIN")
	}

	// 4. Test room creation with PIN (5 mins TTL = 300s)
	stateWithPIN, err := bc.CreateRoomWithConfig(300, "8844")
	if err != nil {
		t.Fatalf("failed to create room with PIN: %v", err)
	}
	if stateWithPIN.Status != "ready" {
		t.Fatalf("expected status 'ready', got '%s'", stateWithPIN.Status)
	}
	if !stateWithPIN.PinRequired {
		t.Fatal("expected PinRequired=true for PIN '8844'")
	}

	// 5. Test room creation with max TTL (24 Hours = 86400s)
	stateMaxTTL, err := bc.CreateRoomWithConfig(86400, "abcd")
	if err != nil {
		t.Fatalf("failed to create room with 24h TTL: %v", err)
	}
	if stateMaxTTL.Status != "ready" {
		t.Fatalf("expected status 'ready', got '%s'", stateMaxTTL.Status)
	}
	if !stateMaxTTL.PinRequired {
		t.Fatal("expected PinRequired=true for PIN 'abcd'")
	}
}

func TestSetupScreenPersistenceAndOldRoomLifecycleInvalidation(t *testing.T) {
	bc := NewBackendController()
	if err := bc.Start(); err != nil {
		t.Fatalf("failed to start backend: %v", err)
	}
	defer bc.Stop()

	// Wait for initial setup
	for i := 0; i < 50; i++ {
		time.Sleep(100 * time.Millisecond)
		if bc.GetHomeScreenState().Status == "setup" {
			break
		}
	}

	// 1. Create room A
	stateA, err := bc.CreateRoomWithConfig(3600, "")
	if err != nil {
		t.Fatalf("failed to create room A: %v", err)
	}
	if stateA.Status != "ready" {
		t.Fatalf("expected room A status 'ready', got '%s'", stateA.Status)
	}

	// 2. Close room A
	closedStateA := bc.CloseRoom()
	if closedStateA.Status != "closed" {
		t.Fatalf("expected status 'closed', got '%s'", closedStateA.Status)
	}
	if bc.GetHomeScreenState().Status != "closed" {
		t.Fatalf("expected GetHomeScreenState to return 'closed', got '%s'", bc.GetHomeScreenState().Status)
	}

	// 3. User clicks "Create New Room" -> transitions to setup
	setupState := bc.ResetToSetup()
	if setupState.Status != "setup" {
		t.Fatalf("expected status 'setup' after ResetToSetup, got '%s'", setupState.Status)
	}

	// 4. Wait longer than the old room polling interval (1500ms)
	time.Sleep(2500 * time.Millisecond)

	// 5. Verify the application STILL remains in setup mode indefinitely
	persistedState := bc.GetHomeScreenState()
	if persistedState.Status != "setup" {
		t.Fatalf("expected state to persist as 'setup', but old room lifecycle reverted it to '%s'", persistedState.Status)
	}

	// 6. User now creates room B
	stateB, err := bc.CreateRoomWithConfig(1800, "5678")
	if err != nil {
		t.Fatalf("failed to create room B: %v", err)
	}
	if stateB.Status != "ready" {
		t.Fatalf("expected room B status 'ready', got '%s'", stateB.Status)
	}
	if !stateB.PinRequired {
		t.Fatal("expected room B PinRequired=true")
	}

	// 7. Close room B and repeat the lifecycle transition
	closedStateB := bc.CloseRoom()
	if closedStateB.Status != "closed" {
		t.Fatalf("expected status 'closed for room B', got '%s'", closedStateB.Status)
	}

	setupState2 := bc.ResetToSetup()
	if setupState2.Status != "setup" {
		t.Fatalf("expected status 'setup' after second ResetToSetup, got '%s'", setupState2.Status)
	}

	time.Sleep(2000 * time.Millisecond)
	if bc.GetHomeScreenState().Status != "setup" {
		t.Fatalf("expected state to persist as 'setup' on second iteration, got '%s'", bc.GetHomeScreenState().Status)
	}
}

func TestLinuxDataDirectoryResolution(t *testing.T) {
	// 1. With XDG_DATA_HOME set
	testDir := t.TempDir()
	os.Setenv("XDG_DATA_HOME", testDir)
	defer os.Unsetenv("XDG_DATA_HOME")

	resolved := resolveDataDir()
	expected := filepath.Join(testDir, "HAMAL")
	if resolved != expected {
		t.Fatalf("expected %q, got %q", expected, resolved)
	}

	// 2. Unset XDG_DATA_HOME
	os.Unsetenv("XDG_DATA_HOME")
	resolvedFallback := resolveDataDir()
	if !strings.Contains(resolvedFallback, "HAMAL") {
		t.Fatalf("expected path containing HAMAL, got %q", resolvedFallback)
	}
}
