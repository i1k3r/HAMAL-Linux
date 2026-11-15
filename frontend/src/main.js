// HAMAL Linux desktop UI (Light Table).
//
// The look follows the Light Table design of the main HAMAL repository. Everything that talks to
// Linux goes through the same Wails bindings and events as before: native open/save dialogs,
// native file drop, the in-process transfer backend, system theme and locale detection.

let currentStatus = "starting";
const roomFilesMap = new Map();
let fileOrderCounter = 0;
let expiresAtTimestamp = null;
let roomLifespanSeconds = 0;
let countdownInterval = null;
let currentRoomPin = "";
let currentPinRequired = false;
let currentParticipantUrl = "";
let closedByMe = false;
const recentActivities = [];
const connectedParticipantsMap = new Map();

const TTL_OPTIONS = [300, 900, 1800, 3600, 21600, 43200, 86400];
const EXECUTABLE_EXTENSIONS = [
    "exe", "msi", "com", "scr", "bat", "cmd",
    "ps1", "vbs", "sh",
    "jar",
    "apk", "aab",
    "appimage", "deb", "rpm"
];
const VIDEO_EXTENSIONS = ["mp4", "mkv", "avi", "mov", "webm", "m4v", "wmv"];
const ICON_WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
const ICON_PLAY = '<svg width="44" height="44" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="7 4 20 12 7 20 7 4"></polygon></svg>';

function tr(key, params) {
    return typeof t === "function" ? t(key, params) : key;
}

function $(id) {
    return document.getElementById(id);
}

function wailsApp() {
    return window.go && window.go.main && window.go.main.App ? window.go.main.App : null;
}

function show(el, visible) {
    if (el) el.classList.toggle("hidden", !visible);
}

// --------------------------------------------------------------------------
// Files: extension, kind, size
// --------------------------------------------------------------------------
function extOf(filename) {
    const lower = (filename || "").toLowerCase();
    for (const multi of ["tar.gz", "tar.bz2", "tar.xz", "tar.zst"]) {
        if (lower.endsWith("." + multi)) return multi;
    }
    const i = lower.lastIndexOf(".");
    return i > 0 && i < lower.length - 1 ? lower.slice(i + 1) : "";
}

function isPotentiallyExecutable(filename) {
    return EXECUTABLE_EXTENSIONS.includes(extOf(filename));
}

function formatBytes(bytes) {
    if (!bytes || bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function clock(ts) {
    try {
        return new Date(ts).toLocaleTimeString(document.documentElement.lang || undefined, { hour: "2-digit", minute: "2-digit" });
    } catch (e) {
        return "";
    }
}

function announce(msg) {
    const live = $("live-polite");
    if (live) live.textContent = msg;
}

// --------------------------------------------------------------------------
// Room log and seats
// --------------------------------------------------------------------------
function addRecentActivity(text) {
    recentActivities.unshift({ text, timestamp: Date.now() });
    if (recentActivities.length > 8) {
        recentActivities.pop();
    }
    renderActivityList();
}

function renderActivityList() {
    const list = $("activity-list");
    if (!list) return;
    list.innerHTML = "";
    if (recentActivities.length === 0) {
        const li = document.createElement("li");
        li.textContent = tr("lt.logEmpty");
        list.appendChild(li);
    } else {
        recentActivities.forEach((act) => {
            const li = document.createElement("li");
            li.textContent = `${act.text}, ${clock(act.timestamp)}`;
            list.appendChild(li);
        });
    }
    const clearBtn = $("btn-clear-activity");
    if (clearBtn) clearBtn.hidden = recentActivities.length === 0;
}

window.clearActivity = function () {
    recentActivities.length = 0;
    renderActivityList();
};

// The backend reports files from other devices, not who sent them, so a device takes a seat at
// the table once it lays a file down.
function registerParticipant(name, ip) {
    if (!name) name = "Mobile Device";
    connectedParticipantsMap.set(ip || name, {
        name,
        ip: ip || "LAN Peer",
        lastSeen: Date.now()
    });
    renderParticipantList();
}

function renderParticipantList() {
    const list = $("participant-list");
    if (!list) return;
    list.innerHTML = "";
    let n = 0;
    connectedParticipantsMap.forEach(() => {
        n++;
        const li = document.createElement("li");
        li.className = "lt-seat";
        li.textContent = n > 1 ? `${tr("lt.device")} ${n}` : tr("lt.device");
        list.appendChild(li);
    });
}

// --------------------------------------------------------------------------
// The table: files as slips (and video tiles), newest first
// --------------------------------------------------------------------------
function buildFileItem(file) {
    const li = document.createElement("li");
    li.className = "lt-item file-row" + (file.isNew ? " is-new" : "");
    li.dataset.fileId = file.fileId;
    file.isNew = false;

    const ext = extOf(file.filename);
    const isVideo = VIDEO_EXTENSIONS.includes(ext);

    const article = document.createElement("article");
    if (isVideo) {
        article.className = "lt-print";
        const tile = document.createElement("div");
        tile.className = "lt-print-media is-video";
        tile.setAttribute("aria-hidden", "true");
        tile.innerHTML = ICON_PLAY;
        article.appendChild(tile);
    } else {
        article.className = "lt-slip";
        const hole = document.createElement("span");
        hole.className = "lt-slip-hole";
        hole.setAttribute("aria-hidden", "true");
        const extEl = document.createElement("span");
        extEl.className = "lt-slip-ext";
        extEl.setAttribute("aria-hidden", "true");
        extEl.textContent = ext ? ext.toUpperCase() : "FILE";
        article.appendChild(hole);
        article.appendChild(extEl);
    }

    const foot = document.createElement("div");
    foot.className = "lt-item-foot";

    const names = document.createElement("div");
    names.className = "lt-item-names";
    const nameEl = document.createElement("h3");
    nameEl.className = "lt-item-name";
    nameEl.title = file.filename;
    nameEl.dir = "auto";
    nameEl.textContent = file.filename;
    const meta = document.createElement("span");
    meta.className = "lt-item-meta";
    meta.textContent = [file.sizeFormatted || formatBytes(file.sizeBytes), clock(file.timestamp)].filter(Boolean).join(" · ");
    names.appendChild(nameEl);
    names.appendChild(meta);
    foot.appendChild(names);

    const actions = document.createElement("div");
    actions.className = "lt-actions";

    if (file.direction === "outbound") {
        const sent = document.createElement("span");
        sent.className = "lt-sent";
        sent.textContent = tr("lt.sent");
        actions.appendChild(sent);
    } else {
        if (isPotentiallyExecutable(file.filename)) {
            const warnText = tr("files.executableWarning");
            const warn = document.createElement("span");
            warn.className = "lt-warn-mark badge-exec-warning";
            warn.tabIndex = 0;
            warn.setAttribute("role", "note");
            warn.setAttribute("aria-label", warnText);
            warn.title = warnText;
            warn.innerHTML = ICON_WARN;
            actions.appendChild(warn);
        }

        const btn = document.createElement("button");
        btn.type = "button";
        btn.id = `btn-download-${file.fileId}`;
        if (file.saving) {
            btn.className = "lt-ink-btn btn-download";
            btn.textContent = tr("lt.saving");
            btn.disabled = true;
        } else if (file.saved) {
            btn.className = "lt-ink-btn is-done btn-saved";
            btn.textContent = tr("lt.saved");
            btn.title = file.savedPath || "";
            btn.onclick = () => downloadFile(file.fileId, file.filename);
        } else {
            btn.className = "lt-ink-btn btn-download";
            btn.textContent = file.saveError ? tr("lt.retrySave") : tr("lt.save");
            btn.setAttribute("aria-label", `${tr("lt.save")}: ${file.filename}`);
            btn.onclick = () => downloadFile(file.fileId, file.filename);
        }
        actions.appendChild(btn);

        if (file.saveError) {
            const err = document.createElement("span");
            err.className = "lt-save-error";
            err.setAttribute("role", "alert");
            err.textContent = file.saveError;
            foot.appendChild(actions);
            foot.appendChild(err);
            article.appendChild(foot);
            li.appendChild(article);
            return li;
        }
    }

    foot.appendChild(actions);
    article.appendChild(foot);
    li.appendChild(article);
    return li;
}

function renderRoomFilesList() {
    const list = $("file-list");
    const empty = $("table-empty");
    if (!list) return;

    const files = Array.from(roomFilesMap.values()).sort((a, b) => b.order - a.order);
    list.innerHTML = "";
    files.forEach((file) => list.appendChild(buildFileItem(file)));
    list.hidden = files.length === 0;
    if (empty) empty.hidden = files.length !== 0;
}

window.downloadFile = function (fileId, filename) {
    const app = wailsApp();
    const file = roomFilesMap.get(fileId);
    if (!app || !file) return;

    file.saving = true;
    file.saveError = "";
    renderRoomFilesList();

    app.DownloadFile(fileId, filename)
        .then((res) => {
            file.saving = false;
            if (res && res.success) {
                file.saved = true;
                file.savedPath = res.savedPath || "";
                addRecentActivity(tr("lt.logSaved", { name: filename }));
            } else if (res && res.errorMessage) {
                file.saveError = res.errorMessage;
                console.error("Save failed:", res.errorMessage);
            }
            renderRoomFilesList();
        })
        .catch((err) => {
            file.saving = false;
            file.saveError = String(err);
            console.error("Download error:", err);
            renderRoomFilesList();
        });
};

window.openFilePicker = function () {
    if (currentStatus !== "ready") return;
    const app = wailsApp();
    if (app) app.SelectAndUploadFiles();
};

// --------------------------------------------------------------------------
// Upload tray (events from the native upload pipeline)
// --------------------------------------------------------------------------
const trayRows = new Map();
let trayHideTimeout = null;

// Rows are keyed by the file's position in the batch; a new batch starts at index 1.
function trayRow(data) {
    const key = String(data.index);
    let row = trayRows.get(key);
    if (!row) {
        const li = document.createElement("li");
        li.className = "lt-up is-sending";
        const name = document.createElement("span");
        name.className = "lt-up-name";
        name.textContent = data.filename;
        const status = document.createElement("span");
        status.className = "lt-up-status";
        const bar = document.createElement("span");
        bar.className = "lt-up-bar";
        li.appendChild(name);
        li.appendChild(status);
        li.appendChild(bar);
        $("tray-list").appendChild(li);
        row = { li, status, bar };
        trayRows.set(key, row);
    }
    return row;
}

function openTray() {
    if (trayHideTimeout) {
        clearTimeout(trayHideTimeout);
        trayHideTimeout = null;
    }
    const tray = $("upload-tray");
    if (tray && tray.hidden) {
        trayRows.clear();
        $("tray-list").innerHTML = "";
        tray.hidden = false;
    }
}

function setTraySummary(text) {
    const summary = $("tray-summary");
    if (summary) summary.textContent = text;
}

function closeTraySoon(delay) {
    if (trayHideTimeout) clearTimeout(trayHideTimeout);
    trayHideTimeout = setTimeout(() => {
        const tray = $("upload-tray");
        if (tray) tray.hidden = true;
        trayRows.clear();
        trayHideTimeout = null;
    }, delay);
}

function onUploadProgress(data, percent) {
    openTray();
    if (data.index === 1 && percent === 0) {
        trayRows.clear();
        $("tray-list").innerHTML = "";
    }
    const row = trayRow(data);
    row.li.className = "lt-up is-sending";
    row.status.textContent = tr("lt.upSending", { percent: percent || 0 });
    row.bar.style.width = (percent || 0) + "%";
    setTraySummary(tr("lt.traySending", { current: data.index, total: data.total }));
}

// --------------------------------------------------------------------------
// Dialogs
// --------------------------------------------------------------------------
function hideAllDialogs() {
    show($("modal-close-confirm"), false);
    show($("modal-about"), false);
    const qr = $("modal-qr");
    if (qr) qr.hidden = true;
}

window.closeRoom = function () {
    window.openCloseConfirmModal();
};

window.openCloseConfirmModal = function () {
    hideAllDialogs();
    show($("modal-close-confirm"), true);
    const btn = $("confirm-close-btn");
    if (btn) btn.focus();
};

window.openAboutModal = function () {
    hideAllDialogs();
    show($("modal-about"), true);
};

window.openQRLightbox = function () {
    if (currentStatus !== "ready" && currentStatus !== "closing") return;
    hideAllDialogs();
    const qr = $("modal-qr");
    if (qr) qr.hidden = false;
};

window.closeAllModals = function (e) {
    // A click on a dialog's backdrop closes it; clicks inside the sheet are stopped earlier.
    if (e && e.target && e.currentTarget && e.target !== e.currentTarget) return;
    hideAllDialogs();
};

window.openFeedbackEmail = function (e) {
    if (e) e.preventDefault();
    const app = wailsApp();
    if (app && typeof app.OpenFeedbackEmail === "function") {
        app.OpenFeedbackEmail();
    } else {
        window.location.href = "mailto:hamalapp@outlook.com?subject=HAMAL%20Feedback";
    }
};

window.copyParticipantUrl = function () {
    const input = $("participant-link-input");
    const toast = $("copy-toast");
    if (!input || !input.value) return;

    const done = () => {
        if (toast) {
            toast.classList.add("show");
            setTimeout(() => toast.classList.remove("show"), 2000);
        }
    };
    const fallback = () => {
        input.select();
        document.execCommand("copy");
        done();
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(input.value).then(done).catch(fallback);
    } else {
        fallback();
    }
};

window.togglePinVisibility = function () {
    const input = $("room-pin-input");
    const btn = $("pin-toggle-btn");
    if (!input) return;
    const reveal = input.type === "password";
    input.type = reveal ? "text" : "password";
    if (btn) btn.setAttribute("aria-pressed", reveal ? "true" : "false");
};

// --------------------------------------------------------------------------
// Room lifecycle
// --------------------------------------------------------------------------
function resetRoomUI() {
    roomFilesMap.clear();
    fileOrderCounter = 0;
    recentActivities.length = 0;
    connectedParticipantsMap.clear();
    renderRoomFilesList();
    renderActivityList();
    renderParticipantList();
    const banner = $("expiry-banner");
    if (banner) banner.hidden = true;
}

function stopCountdown() {
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
    expiresAtTimestamp = null;
}

window.confirmCloseRoom = function () {
    hideAllDialogs();
    closedByMe = true;
    const app = wailsApp();
    if (app) {
        app.CloseRoom()
            .then((state) => {
                renderState(state);
            })
            .catch((err) => {
                console.error("Failed to close room:", err);
            });
    }
};

window.retryConnection = function () {
    renderState({ status: "starting" });
    resetRoomUI();

    const app = wailsApp();
    if (app) {
        app.Retry()
            .then((state) => {
                renderState(state);
            })
            .catch((err) => {
                renderState({
                    status: "error",
                    errorMessage: String(err),
                });
            });
    }
};

window.showRoomCreationScreen = function () {
    const errorEl = $("create-room-error");
    if (errorEl) errorEl.style.display = "none";

    stopCountdown();
    resetRoomUI();
    closedByMe = false;
    renderState({ status: "setup" });

    const app = wailsApp();
    if (app && typeof app.ResetToSetup === "function") {
        app.ResetToSetup()
            .then((state) => {
                renderState(state);
            })
            .catch((err) => {
                console.error("Failed to reset to setup:", err);
            });
    }
};

window.submitCreateRoomForm = function (e) {
    if (e) e.preventDefault();

    const ttlEl = $("room-ttl-select");
    const pinEl = $("room-pin-input");
    const errorEl = $("create-room-error");
    const submitBtn = $("create-submit-btn");

    const ttlSeconds = parseInt(ttlEl ? ttlEl.value : "3600", 10) || 3600;
    const pin = pinEl ? pinEl.value.trim() : "";

    const pinError = () => {
        if (errorEl) {
            errorEl.innerText = tr("create.pinError");
            errorEl.style.display = "flex";
        }
    };

    if (pin.length > 0) {
        if (pin.length < 4 || pin.length > 8) {
            pinError();
            return;
        }
        for (let i = 0; i < pin.length; i++) {
            const code = pin.charCodeAt(i);
            if (code <= 31 || code > 126) {
                pinError();
                return;
            }
        }
    }

    currentRoomPin = pin;

    if (errorEl) errorEl.style.display = "none";
    const setBusy = (busy) => {
        if (!submitBtn) return;
        submitBtn.disabled = busy;
        submitBtn.setAttribute("aria-busy", busy ? "true" : "false");
        const label = submitBtn.querySelector("span");
        if (label) label.innerText = tr(busy ? "lt.opening" : "lt.openRoom");
    };
    setBusy(true);

    stopCountdown();
    resetRoomUI();
    roomLifespanSeconds = ttlSeconds;

    const app = wailsApp();
    if (app && typeof app.CreateRoomWithConfig === "function") {
        app.CreateRoomWithConfig(ttlSeconds, pin)
            .then((state) => {
                setBusy(false);
                if (pinEl) pinEl.value = "";
                addRecentActivity(tr("lt.logOpened"));
                renderState(state);
            })
            .catch((err) => {
                setBusy(false);
                if (errorEl) {
                    errorEl.innerText = String(err);
                    errorEl.style.display = "flex";
                }
            });
    } else {
        setBusy(false);
    }
};

// --------------------------------------------------------------------------
// The lamp: time left in the room
// --------------------------------------------------------------------------
function lampWords(sec) {
    if (sec >= 3600) {
        return tr("lt.hoursMinutes", { h: Math.floor(sec / 3600), m: Math.floor((sec % 3600) / 60) });
    }
    if (sec >= 300) {
        return tr("lt.minutes", { m: Math.floor(sec / 60) });
    }
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function updateCountdown() {
    if (!expiresAtTimestamp) return;

    const remainingSec = Math.max(0, Math.floor((expiresAtTimestamp - Date.now()) / 1000));
    // The lamp's full length is the room's lifespan. A room that was already open when the window
    // loaded has no known lifespan, so it is the remaining time rounded up to a lifespan the home
    // page offers.
    if (!roomLifespanSeconds || roomLifespanSeconds < remainingSec) {
        roomLifespanSeconds = TTL_OPTIONS.find((o) => o >= remainingSec - 2) || remainingSec;
    }

    const words = lampWords(remainingSec);
    const late = remainingSec <= 120;
    const text = late ? tr("lt.lampOff", { time: words }) : tr("lt.lampOn", { time: words });

    const countdownEl = $("countdown");
    if (countdownEl) countdownEl.textContent = text;
    const qrLamp = $("qr-lamp");
    if (qrLamp) qrLamp.textContent = tr("lt.lampOn", { time: words });

    const meter = $("lamp-meter");
    if (meter) {
        meter.setAttribute("aria-valuemax", String(roomLifespanSeconds || remainingSec));
        meter.setAttribute("aria-valuenow", String(remainingSec));
        meter.setAttribute("aria-valuetext", text);
    }
    const fill = $("lamp-fill");
    if (fill) {
        const pct = roomLifespanSeconds ? Math.max(0, Math.min(100, (remainingSec / roomLifespanSeconds) * 100)) : 100;
        fill.style.width = pct + "%";
    }
    const lamp = $("lamp");
    if (lamp) lamp.classList.toggle("is-late", remainingSec <= 300);
    const frame = $("view-ready");
    if (frame) frame.classList.toggle("is-dusk", late);

    if (currentStatus === "ready") {
        const banner = $("expiry-banner");
        if (banner) {
            banner.hidden = !late;
            if (late) $("expiry-text").textContent = tr("lt.closesIn", { time: lampWords(remainingSec) });
        }
    }

    if (remainingSec <= 0 && currentStatus === "ready") {
        stopCountdown();
        renderState({ status: "closed" });
    }
}

// --------------------------------------------------------------------------
// Core state rendering
// --------------------------------------------------------------------------
function showView(id) {
    ["view-starting", "view-setup", "view-ready", "view-closed", "view-error"].forEach((v) => {
        show($(v), v === id);
    });
}

function renderPin() {
    const pinNote = $("pin-display-box");
    const qrPin = $("qr-pin");
    const qrLeadPin = $("qr-lead-pin");
    const hasPin = Boolean(currentRoomPin) || currentPinRequired;

    if (pinNote) {
        pinNote.hidden = !hasPin;
        pinNote.innerHTML = "";
        if (currentRoomPin) {
            const parts = tr("lt.pinToJoin", { pin: "\u0000" }).split("\u0000");
            pinNote.appendChild(document.createTextNode(parts[0] || ""));
            const b = document.createElement("b");
            b.textContent = currentRoomPin;
            pinNote.appendChild(b);
            pinNote.appendChild(document.createTextNode(parts[1] || ""));
        } else if (hasPin) {
            pinNote.textContent = tr("lt.pinRequired");
        }
    }
    if (qrPin) {
        qrPin.hidden = !currentRoomPin;
        qrPin.innerHTML = pinNote ? pinNote.innerHTML : "";
    }
    if (qrLeadPin) qrLeadPin.hidden = !hasPin;
}

function renderState(state) {
    currentStatus = state.status;

    if (state.status === "setup") {
        stopCountdown();
        showView("view-setup");
    } else if (state.status === "ready" || state.status === "closing") {
        showView("view-ready");

        const banner = $("expiry-banner");
        if (state.status === "closing") {
            const rem = state.closingRemainingSeconds || 10;
            if (banner) {
                banner.hidden = false;
                $("expiry-text").textContent = tr("lt.closingIn", { sec: rem });
            }
        }

        if (state.qrSvg) {
            const qrBox = $("qr-box");
            if (qrBox) qrBox.innerHTML = state.qrSvg;
        }

        if (state.participantUrl && state.participantUrl !== currentParticipantUrl) {
            currentParticipantUrl = state.participantUrl;
            const urlInput = $("participant-link-input");
            if (urlInput) urlInput.value = state.participantUrl;
            const addr = $("qr-address");
            if (addr) addr.textContent = state.participantUrl;
        }

        currentPinRequired = Boolean(state.pinRequired);
        renderPin();

        if (state.expiresAt && !expiresAtTimestamp) {
            expiresAtTimestamp = new Date(state.expiresAt).getTime();
            updateCountdown();
            if (!countdownInterval) {
                countdownInterval = setInterval(updateCountdown, 1000);
            }
        }
        if (roomFilesMap.size === 0) renderRoomFilesList();
    } else if (state.status === "closed" || state.status === "stopped") {
        stopCountdown();
        hideAllDialogs();
        showView("view-closed");
        const title = $("inactive-title");
        if (title) title.textContent = tr(closedByMe ? "lt.closedTitle" : "lt.endedTitle");
    } else if (state.status === "error") {
        stopCountdown();
        hideAllDialogs();
        showView("view-error");
        const errorMsg = $("error-message");
        if (errorMsg) {
            errorMsg.innerText = state.errorMessage || tr("error.desc");
        }
    } else {
        showView("view-starting");
    }
}

function fetchHomeScreenState() {
    const app = wailsApp();
    if (app) {
        app.GetHomeScreenState()
            .then((state) => {
                if (currentStatus === "setup" && state.status !== "ready" && state.status !== "closing") {
                    return;
                }
                renderState(state);
            })
            .catch((err) => {
                console.error("Failed to fetch state:", err);
            });
    }
}

// --------------------------------------------------------------------------
// Theme
// --------------------------------------------------------------------------
window.setUserTheme = function (theme) {
    applySystemTheme(theme);
};

function applySystemTheme(theme) {
    if (theme !== "dark" && theme !== "light") return;
    document.documentElement.setAttribute("data-theme", theme);
    document.querySelectorAll(".theme-btn-light").forEach((b) => b.classList.toggle("active", theme === "light"));
    document.querySelectorAll(".theme-btn-dark").forEach((b) => b.classList.toggle("active", theme === "dark"));
}

function initTheme() {
    const fromMedia = () => {
        if (window.matchMedia) {
            const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
            applySystemTheme(isDark ? "dark" : "light");
        }
    };
    const app = wailsApp();
    if (app && typeof app.GetSystemTheme === "function") {
        app.GetSystemTheme().then(applySystemTheme).catch(fromMedia);
    } else {
        fromMedia();
    }
}

// --------------------------------------------------------------------------
// Language
// --------------------------------------------------------------------------
function refreshDynamicTexts() {
    renderRoomFilesList();
    renderActivityList();
    renderParticipantList();
    renderPin();
    updateCountdown();
    refreshUpdateTexts();
}

function initLanguage() {
    const fromNavigator = () => {
        const navLang = (navigator.language || "en").split("-")[0];
        if (typeof setLocale === "function") setLocale(navLang);
        refreshDynamicTexts();
    };
    const app = wailsApp();
    if (app && typeof app.GetSystemLanguage === "function") {
        app.GetSystemLanguage()
            .then((lang) => {
                if (typeof setLocale === "function") setLocale(lang);
                refreshDynamicTexts();
            })
            .catch(fromNavigator);
    } else {
        fromNavigator();
    }
}

// --------------------------------------------------------------------------
// Version and update channel
// --------------------------------------------------------------------------
function initVersionDisplay() {
    const app = wailsApp();
    if (!app) return;
    if (typeof app.GetAppVersion === "function") {
        app.GetAppVersion().then((ver) => {
            const aboutVer = $("about-app-version");
            if (ver && aboutVer) aboutVer.textContent = `HAMAL ${ver}`;
        }).catch(() => {});
    }
    if (typeof app.IsSnapPackage === "function") {
        app.IsSnapPackage().then((isSnap) => {
            const note = $("about-updates");
            if (note) note.hidden = !isSnap;
        }).catch(() => {});
    }
}

// --------------------------------------------------------------------------
// Drag and drop. The drop itself is handled natively (runtime.OnFileDrop in app.go); this only
// lights the table up while files are dragged over the window.
// --------------------------------------------------------------------------
function setDragOver(on) {
    const table = $("dropzone");
    if (table) table.classList.toggle("is-dragover", on && currentStatus === "ready");
}

window.addEventListener("dragover", () => setDragOver(true));
window.addEventListener("dragleave", (e) => {
    if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
        setDragOver(false);
    }
});
window.addEventListener("drop", () => setDragOver(false));

window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || e.keyCode === 27) {
        hideAllDialogs();
    }
});

// --------------------------------------------------------------------------
// Wails event subscriptions
// --------------------------------------------------------------------------
function initWailsListeners() {
    initTheme();
    initLanguage();
    initVersionDisplay();
    renderRoomFilesList();
    renderActivityList();

    if (!window.runtime) return;

    if (typeof window.runtime.OnFileDrop === "function") {
        window.runtime.OnFileDrop(() => {}, false);
    }

    window.runtime.EventsOn("system-theme-changed", (theme) => {
        applySystemTheme(theme);
    });

    window.runtime.EventsOn("upload-started", (data) => {
        setDragOver(false);
        onUploadProgress(data, 0);
    });

    window.runtime.EventsOn("upload-progress", (data) => {
        onUploadProgress(data, data.percent || 0);
    });

    window.runtime.EventsOn("upload-file-complete", (data) => {
        if (data && data.fileId) {
            const row = trayRow({ index: data.index, filename: data.filename });
            row.li.className = "lt-up is-sent";
            row.status.textContent = tr("lt.upSent");
            row.bar.style.width = "100%";

            fileOrderCounter++;
            roomFilesMap.set(data.fileId, {
                fileId: data.fileId,
                filename: data.filename,
                sizeFormatted: data.sizeFormatted || "",
                sizeBytes: data.sizeBytes || 0,
                direction: "outbound",
                saved: false,
                order: fileOrderCounter,
                timestamp: Date.now(),
                isNew: true
            });
            addRecentActivity(tr("lt.logLaid", { name: data.filename }));
            renderRoomFilesList();
        }
    });

    window.runtime.EventsOn("upload-file-error", (data) => {
        if (!data) return;
        const row = trayRow(data);
        row.li.className = "lt-up is-failed";
        row.status.textContent = tr("lt.upFailed", { error: data.error || "" });
    });

    window.runtime.EventsOn("upload-batch-complete", (data) => {
        if (data.failedCount === 0) {
            setTraySummary(data.total === 1 ? tr("lt.upSent") : tr("upload.allFilesSent", { total: data.total }));
            closeTraySoon(4500);
        } else {
            setTraySummary(tr("upload.summary", { success: data.successCount, failed: data.failedCount }));
            closeTraySoon(12000);
        }
        announce($("tray-summary").textContent);
    });

    window.runtime.EventsOn("file-received", (data) => {
        if (data && data.fileId) {
            const existing = roomFilesMap.get(data.fileId);
            if (existing) {
                roomFilesMap.set(data.fileId, {
                    ...existing,
                    ...data,
                    direction: "inbound",
                    saved: existing.saved || false,
                    order: existing.order,
                });
            } else {
                fileOrderCounter++;
                roomFilesMap.set(data.fileId, {
                    ...data,
                    direction: "inbound",
                    saved: false,
                    order: fileOrderCounter,
                    timestamp: Date.now(),
                    isNew: true
                });
            }
            registerParticipant("Mobile Participant", "LAN Peer");
            addRecentActivity(tr("lt.logArrived", { name: data.filename }));
            renderRoomFilesList();
            announce(tr("lt.logArrived", { name: data.filename }));
        }
    });

    window.runtime.EventsOn("update-available", (info) => {
        if (info && info.available) {
            showUpdateBanner(info);
        }
    });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initWailsListeners);
} else {
    initWailsListeners();
}

// Initial polling
fetchHomeScreenState();
const pollTimer = setInterval(() => {
    fetchHomeScreenState();
    if (currentStatus === "ready" || currentStatus === "setup") {
        clearInterval(pollTimer);
        setInterval(fetchHomeScreenState, 5000);
    }
}, 300);

// --------------------------------------------------------------------------
// Update notice (plain binary installs only; the backend never emits it for Snap installs)
// --------------------------------------------------------------------------
let pendingUpdateInfo = null;

function refreshUpdateTexts() {
    if (!pendingUpdateInfo) return;
    const title = $("update-title");
    const text = $("update-version-text");
    if (title) title.textContent = tr("lt.updateTitle", { version: pendingUpdateInfo.latestVersion || "" });
    if (text) text.textContent = tr("lt.updateText", { current: pendingUpdateInfo.currentVersion || "" });
}

function showUpdateBanner(info) {
    if (!info) return;
    pendingUpdateInfo = info;
    refreshUpdateTexts();
    const banner = $("update-banner");
    if (banner) banner.hidden = false;
}

window.dismissUpdateBanner = function () {
    const banner = $("update-banner");
    if (banner) banner.hidden = true;
};

window.startUpdate = function () {
    if (!pendingUpdateInfo) return;
    const target = pendingUpdateInfo.releaseUrl || pendingUpdateInfo.assetUrl;
    if (!target) return;

    const app = wailsApp();
    if (app && typeof app.ApplyUpdate === "function") {
        app.ApplyUpdate(target)
            .then(() => window.dismissUpdateBanner())
            .catch(() => window.dismissUpdateBanner());
    }
};
