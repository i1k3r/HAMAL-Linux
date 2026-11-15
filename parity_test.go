package main

// Parity check: the HAMAL server embedded in HAMAL Linux against the
// published HAMAL Docker image (the reference).
//
// It runs only when HAMAL_REFERENCE_URL points at a running reference server,
// for example:
//
//	docker run -d -p 7700:7700 ghcr.io/i1k3r/hamal@sha256:623bb9a6...
//	HAMAL_REFERENCE_URL=http://127.0.0.1:7700 go test -run TestParity -v
//
// It starts the embedded server exactly as the app does (BackendController),
// sends the same requests to both servers and compares:
//   - every file under /static/ (found by walking the directory listings) and
//     /favicon.ico, byte for byte (SHA-256), with their Content-Type;
//   - the rendered pages (home, creator, participant, PIN gate, ended room,
//     unknown room) after replacing room tokens, origins and timestamps;
//   - the security headers;
//   - the JSON API: status codes, the full key structure of every response and
//     the values that carry server policy (limits, statuses, sender types);
//   - uploaded file downloads (bytes and headers) and error responses.
//
// When HAMAL_PARITY_REPORT is set, a Markdown report with every hash is
// written to that path.

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"
)

type parityServer struct {
	name string
	base string
	// origins that this server writes into pages (its own URL, its LAN URL).
	origins []string
}

type parityReport struct {
	lines []string
}

func (r *parityReport) add(format string, args ...any) {
	r.lines = append(r.lines, fmt.Sprintf(format, args...))
}

var parityClient = &http.Client{
	Timeout: 30 * time.Second,
	CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

type parityResp struct {
	status int
	header http.Header
	body   []byte
}

func parityDo(t *testing.T, method, url string, body io.Reader, headers map[string]string) parityResp {
	t.Helper()
	req, err := http.NewRequest(method, url, body)
	if err != nil {
		t.Fatalf("%s %s: %v", method, url, err)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := parityClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, url, err)
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("%s %s: read body: %v", method, url, err)
	}
	return parityResp{status: resp.StatusCode, header: resp.Header, body: b}
}

func sha(b []byte) string {
	s := sha256.Sum256(b)
	return hex.EncodeToString(s[:])
}

var listingHref = regexp.MustCompile(`<a href="([^"]+)">`)

// walkStatic lists every file under /static/ using http.FileServer's
// directory listings.
func walkStatic(t *testing.T, base, dir string, out map[string]bool) {
	t.Helper()
	r := parityDo(t, "GET", base+"/static/"+dir, nil, nil)
	if r.status != http.StatusOK {
		t.Fatalf("GET /static/%s on %s: HTTP %d", dir, base, r.status)
	}
	for _, m := range listingHref.FindAllSubmatch(r.body, -1) {
		name := string(m[1])
		if strings.HasSuffix(name, "/") {
			walkStatic(t, base, dir+name, out)
			continue
		}
		out[dir+name] = true
	}
}

type parityRoom struct {
	creatorToken     string
	participantToken string
	roomID           string
	raw              map[string]any
	status           int
}

func createParityRoom(t *testing.T, s parityServer, payload string) parityRoom {
	t.Helper()
	r := parityDo(t, "POST", s.base+"/api/v1/rooms", strings.NewReader(payload), map[string]string{"Content-Type": "application/json"})
	room := parityRoom{status: r.status}
	if r.status != http.StatusCreated && r.status != http.StatusOK {
		return room
	}
	if err := json.Unmarshal(r.body, &room.raw); err != nil {
		t.Fatalf("%s: create room: %v: %s", s.name, err, r.body)
	}
	room.creatorToken, _ = room.raw["creator_token"].(string)
	room.participantToken, _ = room.raw["participant_token"].(string)
	room.roomID, _ = room.raw["room_id"].(string)
	if room.creatorToken == "" || room.participantToken == "" {
		t.Fatalf("%s: create room returned no tokens: %s", s.name, r.body)
	}
	return room
}

var (
	rfc3339Re = regexp.MustCompile(`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})`)
	hexIDRe   = regexp.MustCompile(`[0-9a-f]{32}`)
)

// normalizePage replaces the values that are different on every run.
func normalizePage(s parityServer, body []byte, rooms ...parityRoom) string {
	out := string(body)
	for i, rm := range rooms {
		if rm.creatorToken != "" {
			out = strings.ReplaceAll(out, rm.creatorToken, fmt.Sprintf("<CREATOR_TOKEN_%d>", i))
		}
		if rm.participantToken != "" {
			out = strings.ReplaceAll(out, rm.participantToken, fmt.Sprintf("<PARTICIPANT_TOKEN_%d>", i))
		}
		if rm.roomID != "" {
			out = strings.ReplaceAll(out, rm.roomID, fmt.Sprintf("<ROOM_ID_%d>", i))
		}
	}
	for _, o := range s.origins {
		out = strings.ReplaceAll(out, o, "<ORIGIN>")
	}
	out = rfc3339Re.ReplaceAllString(out, "<TIME>")
	out = hexIDRe.ReplaceAllString(out, "<ID>")
	// Seconds left on a room depend on when each page was rendered.
	out = regexp.MustCompile(`data-closing-seconds="\d+"`).ReplaceAllString(out, `data-closing-seconds="<N>"`)
	return out
}

// shape describes the JSON structure: keys and value kinds, recursively.
func shape(v any) any {
	switch x := v.(type) {
	case map[string]any:
		m := map[string]any{}
		for k, vv := range x {
			m[k] = shape(vv)
		}
		return m
	case []any:
		if len(x) == 0 {
			return "[]"
		}
		items := make([]string, 0, len(x))
		for _, it := range x {
			b, _ := json.Marshal(shape(it))
			items = append(items, string(b))
		}
		sort.Strings(items)
		return items
	case string:
		return "string"
	case float64:
		return "number"
	case bool:
		return "bool"
	case nil:
		return "null"
	}
	return fmt.Sprintf("%T", v)
}

func jsonShape(t *testing.T, name string, b []byte) string {
	t.Helper()
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatalf("%s: not JSON: %v: %s", name, err, b)
	}
	out, _ := json.Marshal(shape(v))
	return string(out)
}

// policy pulls out values that must be identical (limits, statuses, types).
func policy(b []byte, keys ...string) map[string]any {
	var v map[string]any
	_ = json.Unmarshal(b, &v)
	out := map[string]any{}
	for _, k := range keys {
		out[k] = v[k]
	}
	return out
}

var securityHeaders = []string{
	"Content-Security-Policy", "X-Content-Type-Options", "X-Frame-Options",
	"Referrer-Policy", "Permissions-Policy", "Cross-Origin-Opener-Policy",
	"Cross-Origin-Resource-Policy", "Cache-Control", "Content-Type",
}

func multipartFile(t *testing.T, name, contentType string, data []byte) (io.Reader, string) {
	t.Helper()
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	h := make(map[string][]string)
	h["Content-Disposition"] = []string{fmt.Sprintf(`form-data; name="file"; filename="%s"`, name)}
	h["Content-Type"] = []string{contentType}
	part, err := w.CreatePart(h)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write(data)
	_ = w.Close()
	return &buf, w.FormDataContentType()
}

func TestParityWithReferenceServer(t *testing.T) {
	refURL := strings.TrimRight(os.Getenv("HAMAL_REFERENCE_URL"), "/")
	if refURL == "" {
		t.Skip("HAMAL_REFERENCE_URL is not set; start the reference Docker image to run the parity check")
	}

	bc := NewBackendController()
	if err := bc.Start(); err != nil {
		t.Fatalf("start embedded server: %v", err)
	}
	defer bc.Stop()
	var st ServerStatus
	for i := 0; i < 100; i++ {
		st = bc.GetStatus()
		if st.Status == "running" && st.LocalURL != "" {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if st.LocalURL == "" {
		t.Fatalf("embedded server did not start: %+v", st)
	}
	linux := parityServer{name: "linux", base: strings.TrimRight(st.LocalURL, "/"), origins: []string{strings.TrimRight(st.LocalURL, "/")}}
	if st.LanURL != "" {
		linux.origins = append([]string{strings.TrimRight(st.LanURL, "/")}, linux.origins...)
	}
	ref := parityServer{name: "reference", base: refURL, origins: []string{refURL}}

	report := &parityReport{}
	report.add("# HAMAL Linux parity report")
	report.add("")
	report.add("Reference: `%s`. Linux: embedded server started by `BackendController` at `%s`.", refURL, linux.base)
	report.add("Generated %s.", time.Now().UTC().Format(time.RFC3339))
	failures := 0
	fail := func(format string, args ...any) {
		failures++
		t.Errorf(format, args...)
		report.add("- **MISMATCH** "+format, args...)
	}

	// 1. Static files, byte for byte.
	refFiles, linFiles := map[string]bool{}, map[string]bool{}
	walkStatic(t, ref.base, "", refFiles)
	walkStatic(t, linux.base, "", linFiles)
	names := make([]string, 0, len(refFiles))
	for n := range refFiles {
		names = append(names, n)
	}
	for n := range linFiles {
		if !refFiles[n] {
			fail("static file only on Linux: %s", n)
		}
	}
	sort.Strings(names)
	report.add("")
	report.add("## Static files and phone client (%d files)", len(names)+1)
	report.add("")
	report.add("| File | SHA-256 (reference) | Linux |")
	report.add("| --- | --- | --- |")
	for _, n := range append(names, "favicon.ico") {
		path := "/static/" + n
		if n == "favicon.ico" {
			path = "/favicon.ico"
		}
		a := parityDo(t, "GET", ref.base+path, nil, nil)
		b := parityDo(t, "GET", linux.base+path, nil, nil)
		same := "same"
		if a.status != b.status || !bytes.Equal(a.body, b.body) {
			same = "DIFFERENT"
			fail("%s: reference HTTP %d sha %s, Linux HTTP %d sha %s", path, a.status, sha(a.body), b.status, sha(b.body))
		}
		for _, h := range []string{"Content-Type", "Cache-Control"} {
			if a.header.Get(h) != b.header.Get(h) {
				fail("%s header %s: reference %q, Linux %q", path, h, a.header.Get(h), b.header.Get(h))
			}
		}
		report.add("| `%s` | `%s` | %s |", path, sha(a.body), same)
	}

	// 2. Rooms with identical requests on both servers.
	type pair struct{ ref, lin parityRoom }
	mk := func(payload string) pair {
		return pair{createParityRoom(t, ref, payload), createParityRoom(t, linux, payload)}
	}
	open := mk(`{"ttl_seconds":600}`)
	pinned := mk(`{"ttl_seconds":300,"pin":"4821"}`)
	report.add("")
	report.add("## API")
	report.add("")

	checkAPI := func(label string, a, b parityResp, policyKeys ...string) {
		t.Helper()
		if a.status != b.status {
			fail("%s: reference HTTP %d, Linux HTTP %d", label, a.status, b.status)
			return
		}
		ct := a.header.Get("Content-Type")
		if ct != b.header.Get("Content-Type") {
			fail("%s: Content-Type reference %q, Linux %q", label, ct, b.header.Get("Content-Type"))
		}
		if strings.HasPrefix(ct, "application/json") {
			sa, sb := jsonShape(t, label, a.body), jsonShape(t, label, b.body)
			if sa != sb {
				fail("%s: JSON structure differs\nreference: %s\nlinux:     %s", label, sa, sb)
				return
			}
			if len(policyKeys) > 0 {
				pa, _ := json.Marshal(policy(a.body, policyKeys...))
				pb, _ := json.Marshal(policy(b.body, policyKeys...))
				if !bytes.Equal(pa, pb) {
					fail("%s: values differ\nreference: %s\nlinux:     %s", label, pa, pb)
					return
				}
			}
			report.add("- %s: HTTP %d, same JSON structure `%s`", label, a.status, sa)
			return
		}
		report.add("- %s: HTTP %d, %s", label, a.status, ct)
	}

	both := func(method, path string, body func() (io.Reader, map[string]string), r pair) (parityResp, parityResp) {
		t.Helper()
		run := func(s parityServer, rm parityRoom) parityResp {
			p := strings.NewReplacer("{c}", rm.creatorToken, "{p}", rm.participantToken).Replace(path)
			var rd io.Reader
			var hd map[string]string
			if body != nil {
				rd, hd = body()
			}
			return parityDo(t, method, s.base+p, rd, hd)
		}
		return run(ref, r.ref), run(linux, r.lin)
	}
	jsonBody := func(s string) func() (io.Reader, map[string]string) {
		return func() (io.Reader, map[string]string) {
			return strings.NewReader(s), map[string]string{"Content-Type": "application/json", "X-Client-Session-ID": "parity-session"}
		}
	}

	if open.ref.status != open.lin.status {
		fail("create room: reference HTTP %d, Linux HTTP %d", open.ref.status, open.lin.status)
	} else {
		ra, _ := json.Marshal(shape(open.ref.raw))
		rb, _ := json.Marshal(shape(open.lin.raw))
		if !bytes.Equal(ra, rb) {
			fail("create room: JSON structure differs\nreference: %s\nlinux:     %s", ra, rb)
		} else {
			report.add("- POST /api/v1/rooms: HTTP %d, same JSON structure `%s`", open.ref.status, ra)
		}
		pa, _ := json.Marshal(policy(mustJSON(open.ref.raw), "pin_required", "max_room_size", "max_file_size", "max_files", "status"))
		pb, _ := json.Marshal(policy(mustJSON(open.lin.raw), "pin_required", "max_room_size", "max_file_size", "max_files", "status"))
		if !bytes.Equal(pa, pb) {
			fail("create room values differ\nreference: %s\nlinux:     %s", pa, pb)
		}
	}

	for _, bad := range []string{`{"ttl_seconds":300,"pin":"abcd"}`, `{"ttl_seconds":300,"pin":"12"}`, `{"ttl_seconds":5}`, `{"ttl_seconds":999999}`, `not json`} {
		a := parityDo(t, "POST", ref.base+"/api/v1/rooms", strings.NewReader(bad), map[string]string{"Content-Type": "application/json"})
		b := parityDo(t, "POST", linux.base+"/api/v1/rooms", strings.NewReader(bad), map[string]string{"Content-Type": "application/json"})
		if a.status != b.status || !bytes.Equal(a.body, b.body) {
			fail("POST /api/v1/rooms %s: reference %d %q, Linux %d %q", bad, a.status, a.body, b.status, b.body)
		} else {
			report.add("- POST /api/v1/rooms `%s`: both HTTP %d `%s`", bad, a.status, strings.TrimSpace(string(a.body)))
		}
	}

	a, b := both("GET", "/api/v1/rooms/{c}", nil, open)
	checkAPI("GET room (creator)", a, b, "status", "is_creator", "pin_required", "participant_count")
	a, b = both("GET", "/api/v1/rooms/{p}", nil, open)
	checkAPI("GET room (participant)", a, b, "status", "is_creator", "pin_required")
	a, b = both("GET", "/api/v1/rooms/{p}", nil, pinned)
	checkAPI("GET room (participant, PIN not entered)", a, b)
	a, b = both("POST", "/api/v1/rooms/{p}/auth/pin", jsonBody(`{"pin":"0000"}`), pinned)
	checkAPI("POST auth/pin (wrong PIN)", a, b)

	fileData := []byte("HAMAL parity check file\n")
	upload := func() (io.Reader, map[string]string) {
		rd, ct := multipartFile(t, "parity check.txt", "text/plain", fileData)
		return rd, map[string]string{"Content-Type": ct, "X-Client-Session-ID": "parity-session"}
	}
	a, b = both("POST", "/api/v1/rooms/{c}/files", upload, open)
	checkAPI("POST files (creator upload)", a, b, "filename", "size_bytes", "status", "content_type")
	fileIDs := [2]string{}
	for i, r := range []parityResp{a, b} {
		var v map[string]any
		_ = json.Unmarshal(r.body, &v)
		if id, ok := v["file_id"].(string); ok {
			fileIDs[i] = id
		} else if f, ok := v["files"].([]any); ok && len(f) > 0 {
			fileIDs[i], _ = f[0].(map[string]any)["file_id"].(string)
		}
	}
	a, b = both("GET", "/api/v1/rooms/{p}/files", nil, open)
	checkAPI("GET files (participant)", a, b, "status", "file_count", "total_size_bytes", "max_room_size", "max_files")

	if fileIDs[0] != "" && fileIDs[1] != "" {
		for _, method := range []string{"GET", "HEAD"} {
			da := parityDo(t, method, ref.base+"/api/v1/rooms/"+open.ref.participantToken+"/files/"+fileIDs[0], nil, nil)
			db := parityDo(t, method, linux.base+"/api/v1/rooms/"+open.lin.participantToken+"/files/"+fileIDs[1], nil, nil)
			if da.status != db.status || !bytes.Equal(da.body, db.body) {
				fail("%s download: reference %d sha %s, Linux %d sha %s", method, da.status, sha(da.body), db.status, sha(db.body))
			}
			for _, h := range []string{"Content-Type", "Content-Disposition", "Content-Length", "Cache-Control", "X-Content-Type-Options"} {
				if da.header.Get(h) != db.header.Get(h) {
					fail("%s download header %s: reference %q, Linux %q", method, h, da.header.Get(h), db.header.Get(h))
				}
			}
			report.add("- %s file download: HTTP %d, same bytes and headers (`%s`)", method, da.status, da.header.Get("Content-Disposition"))
		}
		a := parityDo(t, "POST", ref.base+"/api/v1/rooms/"+open.ref.creatorToken+"/files/"+fileIDs[0]+"/share", strings.NewReader(`{"ttl_seconds":900}`), map[string]string{"Content-Type": "application/json"})
		b := parityDo(t, "POST", linux.base+"/api/v1/rooms/"+open.lin.creatorToken+"/files/"+fileIDs[1]+"/share", strings.NewReader(`{"ttl_seconds":900}`), map[string]string{"Content-Type": "application/json"})
		if a.status != b.status {
			fail("POST share: reference HTTP %d, Linux HTTP %d", a.status, b.status)
		} else {
			report.add("- POST files/{id}/share: both HTTP %d (share links follow the same server setting)", a.status)
		}
	} else {
		fail("upload did not return a file id: reference %q, Linux %q", fileIDs[0], fileIDs[1])
	}

	a, b = both("POST", "/api/v1/rooms/{p}/texts", jsonBody(`{"content":"hello from the parity check","client_session_id":"parity-session"}`), open)
	checkAPI("POST texts (participant note)", a, b, "sender_type", "content", "size_bytes", "is_self")
	a, b = both("POST", "/api/v1/rooms/{c}/texts", jsonBody(`{"content":"note from the creator","client_session_id":"parity-creator"}`), open)
	checkAPI("POST texts (creator note)", a, b, "sender_type", "content", "size_bytes")
	big := `{"content":"` + strings.Repeat("x", 70*1024) + `"}`
	a, b = both("POST", "/api/v1/rooms/{c}/texts", jsonBody(big), open)
	checkAPI("POST texts (over 64 KiB)", a, b)
	a, b = both("GET", "/api/v1/rooms/{c}/texts", nil, open)
	checkAPI("GET texts", a, b, "status", "text_count", "total", "max_text_size")
	textContents := func(r parityResp) string {
		var v struct {
			Texts []struct {
				SenderType string `json:"sender_type"`
				Content    string `json:"content"`
			} `json:"texts"`
		}
		_ = json.Unmarshal(r.body, &v)
		parts := []string{}
		for _, x := range v.Texts {
			parts = append(parts, x.SenderType+": "+x.Content)
		}
		return strings.Join(parts, " | ")
	}
	if ta, tb := textContents(a), textContents(b); ta != tb {
		fail("room texts differ\nreference: %s\nlinux:     %s", ta, tb)
	} else {
		report.add("- Room texts in order: `%s`", ta)
	}

	// 3. Pages.
	report.add("")
	report.add("## Pages (after replacing tokens, origins and times)")
	report.add("")
	page := func(label, path string, pr pair, extra ...pair) {
		t.Helper()
		pa := strings.NewReplacer("{c}", pr.ref.creatorToken, "{p}", pr.ref.participantToken).Replace(path)
		pb := strings.NewReplacer("{c}", pr.lin.creatorToken, "{p}", pr.lin.participantToken).Replace(path)
		ra := parityDo(t, "GET", ref.base+pa, nil, nil)
		rb := parityDo(t, "GET", linux.base+pb, nil, nil)
		roomsA := []parityRoom{pr.ref}
		roomsB := []parityRoom{pr.lin}
		for _, e := range extra {
			roomsA = append(roomsA, e.ref)
			roomsB = append(roomsB, e.lin)
		}
		na, nb := normalizePage(ref, ra.body, roomsA...), normalizePage(linux, rb.body, roomsB...)
		if ra.status != rb.status {
			fail("page %s: reference HTTP %d, Linux HTTP %d", label, ra.status, rb.status)
			return
		}
		if na != nb {
			fail("page %s differs: %s", label, firstDiff(na, nb))
			return
		}
		for _, h := range securityHeaders {
			if ra.header.Get(h) != rb.header.Get(h) {
				fail("page %s header %s: reference %q, Linux %q", label, h, ra.header.Get(h), rb.header.Get(h))
			}
		}
		report.add("- %s: HTTP %d, identical (%d bytes, normalized SHA-256 `%s`)", label, ra.status, len(na), sha([]byte(na)))
	}
	page("Home `/`", "/", open)
	page("Creator `/c/{token}`", "/c/{c}", open)
	page("Participant `/r/{token}`", "/r/{p}", open)
	page("Participant PIN gate `/r/{token}`", "/r/{p}", pinned)
	page("Unknown room `/r/nope`", "/r/p_doesnotexist", open)

	// 4. Close and the ended room.
	a, b = both("POST", "/api/v1/rooms/{c}/close", nil, open)
	checkAPI("POST close (creator)", a, b, "status")
	a, b = both("GET", "/api/v1/rooms/{p}", nil, open)
	checkAPI("GET room after close", a, b, "status")
	if fileIDs[0] != "" && fileIDs[1] != "" {
		da := parityDo(t, "GET", ref.base+"/api/v1/rooms/"+open.ref.participantToken+"/files/"+fileIDs[0], nil, nil)
		db := parityDo(t, "GET", linux.base+"/api/v1/rooms/"+open.lin.participantToken+"/files/"+fileIDs[1], nil, nil)
		if da.status != db.status {
			fail("download after close: reference HTTP %d, Linux HTTP %d", da.status, db.status)
		} else {
			report.add("- Download after close: both HTTP %d", da.status)
		}
	}
	page("Participant page after close", "/r/{p}", open)
	page("Creator page after close", "/c/{c}", open)

	if p := os.Getenv("HAMAL_PARITY_REPORT"); p != "" {
		report.add("")
		if failures == 0 {
			report.add("Result: **no differences**.")
		} else {
			report.add("Result: **%d differences**.", failures)
		}
		if err := os.WriteFile(p, []byte(strings.Join(report.lines, "\n")+"\n"), 0o644); err != nil {
			t.Errorf("write report: %v", err)
		}
	}
}

func mustJSON(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}

func firstDiff(a, b string) string {
	i := 0
	for i < len(a) && i < len(b) && a[i] == b[i] {
		i++
	}
	from := i - 120
	if from < 0 {
		from = 0
	}
	cut := func(s string) string {
		end := i + 200
		if end > len(s) {
			end = len(s)
		}
		if from > len(s) {
			return ""
		}
		return s[from:end]
	}
	return fmt.Sprintf("at byte %d\nreference: …%s…\nlinux:     …%s…", i, cut(a), cut(b))
}
