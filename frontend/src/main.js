let currentStatus = "starting";
const roomFilesMap = new Map();
let fileOrderCounter = 0;
let dropResetTimeout = null;
let expiresAtTimestamp = null;
let countdownInterval = null;

const ICONS = {
    fileGeneric: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
    </svg>`,
    upload: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="17 8 12 3 7 8"></polyline>
        <line x1="12" y1="3" x2="12" y2="15"></line>
    </svg>`,
    checkCircle: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
        <polyline points="22 4 12 14.01 9 11.01"></polyline>
    </svg>`,
    alertCircle: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
    </svg>`
};

function getBrowseHintHtml() {
    const browseText = typeof t === "function" ? t("upload.browse") : "click to browse";
    return typeof t === "function" 
        ? t("upload.hint", { browse: `<span class="browse-link">${browseText}</span>` })
        : `or <span class="browse-link">${browseText}</span>`;
}

function resetDropZoneDefault() {
    const defaultTitle = typeof t === "function" ? t("upload.title") : "Drag & drop files here";
    setDropZoneState("", defaultTitle, getBrowseHintHtml());
}

function setDropZoneState(state, title, hint, progress, filename) {
    const zone = document.getElementById("dropzone");
    const iconElem = document.getElementById("dropzone-icon");
    const titleElem = document.getElementById("dropzone-title");
    const hintElem = document.getElementById("dropzone-hint");
    const progContainer = document.getElementById("upload-progress-container");
    const progFilename = document.getElementById("upload-filename");
    const progPercent = document.getElementById("upload-percent");
    const progFill = document.getElementById("progress-bar-fill");
    const progError = document.getElementById("upload-error");

    if (!zone || !titleElem || !hintElem) return;

    if (dropResetTimeout) {
        clearTimeout(dropResetTimeout);
        dropResetTimeout = null;
    }

    zone.className = "dropzone " + state;
    titleElem.innerText = title;
    hintElem.innerHTML = hint;

    if (state === "uploading") {
        const uploadingText = typeof t === "function" ? t("upload.uploading") : "Uploading file…";
        if (progContainer) progContainer.style.display = "block";
        if (progFilename) progFilename.innerText = filename || uploadingText;
        if (progPercent) progPercent.innerText = (progress || 0) + "%";
        if (progFill) progFill.style.width = (progress || 0) + "%";
        if (progError) progError.style.display = "none";
    } else {
        if (progContainer) progContainer.style.display = "none";
        if (progFill) progFill.style.width = "0%";
    }

    if (state === "success") {
        if (iconElem) iconElem.innerHTML = ICONS.checkCircle;
    } else if (state === "error") {
        if (iconElem) iconElem.innerHTML = ICONS.alertCircle;
    } else {
        if (iconElem) iconElem.innerHTML = ICONS.upload;
    }
}

function renderRoomFilesList() {
    const list = document.getElementById("file-list");
    const countBadge = document.getElementById("file-count");
    if (!list) return;

    const count = roomFilesMap.size;
    if (countBadge) countBadge.innerText = String(count);

    if (count === 0) {
        const emptyTitle = typeof t === "function" ? t("files.emptyTitle") : "No files uploaded yet";
        const emptyText = typeof t === "function" ? t("files.emptyText") : "Drop parcels above or browse from your device. Connected participants will receive files in real time.";
        list.innerHTML = `
            <div id="no-files-msg" class="empty-state">
                <svg class="empty-state-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                    <line x1="12" y1="22.08" x2="12" y2="12"></line>
                </svg>
                <p class="empty-state-title">${emptyTitle}</p>
                <p class="empty-state-text">${emptyText}</p>
            </div>
        `;
        return;
    }

    list.innerHTML = "";

    // Sort newest first by order descending
    const files = Array.from(roomFilesMap.values()).sort((a, b) => b.order - a.order);

    files.forEach((file) => {
        const item = document.createElement("div");
        item.className = "file-item";
        item.dataset.fileId = file.fileId;

        const mainDiv = document.createElement("div");
        mainDiv.className = "file-item-main";

        const iconDiv = document.createElement("div");
        iconDiv.className = "file-type-icon";
        iconDiv.innerHTML = ICONS.fileGeneric;

        const infoDiv = document.createElement("div");
        infoDiv.className = "file-info";

        const nameSpan = document.createElement("span");
        nameSpan.className = "file-name";
        nameSpan.title = file.filename;
        nameSpan.innerText = file.filename;

        const metaSpan = document.createElement("span");
        metaSpan.className = "file-meta font-mono";
        metaSpan.innerText = file.sizeFormatted || "";

        infoDiv.appendChild(nameSpan);
        infoDiv.appendChild(metaSpan);
        mainDiv.appendChild(iconDiv);
        mainDiv.appendChild(infoDiv);

        const actionsDiv = document.createElement("div");
        actionsDiv.className = "file-actions";

        if (file.direction === "outbound") {
            // Windows -> Phone file: Show non-downloadable SENT badge
            const sentBadge = document.createElement("span");
            sentBadge.className = "badge-sent font-mono";
            sentBadge.innerText = typeof t === "function" ? t("files.sent") : "SENT";
            actionsDiv.appendChild(sentBadge);
        } else {
            // Phone -> Windows file: Show Download or Saved button
            const btn = document.createElement("button");
            btn.id = `btn-download-${file.fileId}`;

            if (file.saved) {
                btn.className = "btn btn-secondary btn-sm btn-saved";
                btn.innerText = typeof t === "function" ? t("files.saved") : "✓ Saved";
                btn.disabled = true;
            } else {
                const downloadText = typeof t === "function" ? t("files.download") : "Download";
                btn.className = "btn btn-secondary btn-sm btn-download";
                btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg> ${downloadText}`;
                btn.onclick = () => downloadFile(file.fileId, file.filename);
            }
            actionsDiv.appendChild(btn);
        }

        item.appendChild(mainDiv);
        item.appendChild(actionsDiv);
        list.appendChild(item);
    });
}

window.downloadFile = function (fileId, filename) {
    const btn = document.getElementById(`btn-download-${fileId}`);
    const savingText = typeof t === "function" ? t("files.saving") : "Saving...";
    const retryText = typeof t === "function" ? t("files.retry") : "Retry";

    if (btn) {
        btn.className = "btn btn-secondary btn-sm btn-download";
        btn.innerText = savingText;
    }

    if (window.go && window.go.main && window.go.main.App) {
        window.go.main.App.DownloadFile(fileId, filename)
            .then((res) => {
                if (res && res.success) {
                    const file = roomFilesMap.get(fileId);
                    if (file) {
                        file.saved = true;
                    }
                    renderRoomFilesList();
                } else if (res && res.errorMessage) {
                    if (btn) {
                        btn.className = "btn btn-secondary btn-sm btn-download";
                        btn.innerText = "⚠️ " + retryText;
                    }
                    console.error("Save failed:", res.errorMessage);
                } else {
                    // Cancelled dialog - restore saved status
                    renderRoomFilesList();
                }
            })
            .catch((err) => {
                if (btn) {
                    btn.className = "btn btn-secondary btn-sm btn-download";
                    btn.innerText = "⚠️ " + retryText;
                }
                console.error("Download error:", err);
            });
    }
};

window.openFilePicker = function () {
    if (currentStatus !== "ready") return;
    if (window.go && window.go.main && window.go.main.App) {
        window.go.main.App.SelectAndUploadFiles();
    }
};

window.copyParticipantUrl = function () {
    const input = document.getElementById("participant-link-input");
    const toast = document.getElementById("copy-toast");
    if (!input || !input.value) return;

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(input.value).then(() => {
            if (toast) {
                toast.classList.add("show");
                setTimeout(() => toast.classList.remove("show"), 2000);
            }
        }).catch(() => {
            input.select();
            document.execCommand("copy");
            if (toast) {
                toast.classList.add("show");
                setTimeout(() => toast.classList.remove("show"), 2000);
            }
        });
    } else {
        input.select();
        document.execCommand("copy");
        if (toast) {
            toast.classList.add("show");
            setTimeout(() => toast.classList.remove("show"), 2000);
        }
    }
};

window.closeRoom = function () {
    if (window.go && window.go.main && window.go.main.App) {
        window.go.main.App.CloseRoom()
            .then((state) => {
                renderState(state);
            })
            .catch((err) => {
                console.error("Failed to close room:", err);
            });
    }
};

window.retryConnection = function () {
    const viewStarting = document.getElementById("view-starting");
    const viewSetup = document.getElementById("view-setup");
    const viewReady = document.getElementById("view-ready");
    const viewClosed = document.getElementById("view-closed");
    const viewError = document.getElementById("view-error");

    if (viewReady) viewReady.classList.add("hidden");
    if (viewClosed) viewClosed.classList.add("hidden");
    if (viewError) viewError.classList.add("hidden");
    if (viewSetup) viewSetup.classList.add("hidden");
    if (viewStarting) viewStarting.classList.remove("hidden");

    roomFilesMap.clear();
    fileOrderCounter = 0;
    renderRoomFilesList();

    if (window.go && window.go.main && window.go.main.App) {
        window.go.main.App.Retry()
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
    const errorEl = document.getElementById("create-room-error");
    if (errorEl) errorEl.style.display = "none";

    // Invalidate any active countdown timer and room timestamps
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
    expiresAtTimestamp = null;

    // Clear old room files and state
    roomFilesMap.clear();
    fileOrderCounter = 0;
    renderRoomFilesList();

    // Immediately render setup state on frontend
    renderState({ status: "setup" });

    // Notify backend to invalidate old room session and switch home state to setup
    if (window.go && window.go.main && window.go.main.App && typeof window.go.main.App.ResetToSetup === "function") {
        window.go.main.App.ResetToSetup()
            .then((state) => {
                renderState(state);
            })
            .catch((err) => {
                console.error("Failed to reset to setup:", err);
            });
    }
};

window.cancelRoomCreation = function () {
    const errorEl = document.getElementById("create-room-error");
    if (errorEl) errorEl.style.display = "none";
    if (expiresAtTimestamp && expiresAtTimestamp > Date.now()) {
        renderState({ status: "ready" });
    } else {
        renderState({ status: "closed" });
    }
};

window.submitCreateRoomForm = function (e) {
    if (e) e.preventDefault();

    const ttlEl = document.getElementById("room-ttl-select");
    const pinEl = document.getElementById("room-pin-input");
    const errorEl = document.getElementById("create-room-error");
    const submitBtn = document.getElementById("create-submit-btn");

    const ttlSeconds = parseInt(ttlEl ? ttlEl.value : "3600", 10) || 3600;
    const pin = pinEl ? pinEl.value.trim() : "";

    if (pin.length > 0) {
        if (pin.length < 4 || pin.length > 8) {
            if (errorEl) {
                errorEl.innerText = typeof t === "function" ? t("create.pinError") : "PIN must be between 4 and 8 characters";
                errorEl.style.display = "block";
            }
            return;
        }
        for (let i = 0; i < pin.length; i++) {
            const code = pin.charCodeAt(i);
            if (code <= 31 || code > 126) {
                if (errorEl) {
                    errorEl.innerText = typeof t === "function" ? t("create.pinError") : "PIN must be between 4 and 8 characters";
                    errorEl.style.display = "block";
                }
                return;
            }
        }
    }

    if (errorEl) errorEl.style.display = "none";
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span>${typeof t === "function" ? t("create.creatingBtn") : "Creating Room..."}</span>`;
    }

    roomFilesMap.clear();
    fileOrderCounter = 0;
    renderRoomFilesList();

    const resetSubmitBtn = () => {
        if (submitBtn) {
            submitBtn.disabled = false;
            const btnText = typeof t === "function" ? t("create.submitBtn") : "Create Transfer Room";
            submitBtn.innerHTML = `<span data-i18n="create.submitBtn">${btnText}</span> <span class="btn-arrow">→</span>`;
        }
    };

    if (window.go && window.go.main && window.go.main.App && typeof window.go.main.App.CreateRoomWithConfig === "function") {
        window.go.main.App.CreateRoomWithConfig(ttlSeconds, pin)
            .then((state) => {
                resetSubmitBtn();
                renderState(state);
            })
            .catch((err) => {
                resetSubmitBtn();
                if (errorEl) {
                    errorEl.innerText = String(err);
                    errorEl.style.display = "block";
                }
            });
    } else {
        resetSubmitBtn();
    }
};

function updateCountdown() {
    const countdownEl = document.getElementById("countdown");
    if (!countdownEl || !expiresAtTimestamp) return;

    const remainingSec = Math.max(0, Math.floor((expiresAtTimestamp - Date.now()) / 1000));
    const mins = Math.floor(remainingSec / 60);
    const secs = remainingSec % 60;
    countdownEl.innerText = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

    if (remainingSec <= 0 && currentStatus === "ready") {
        expiresAtTimestamp = null;
        if (countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
        }
        renderState({ status: "closed" });
    }
}

function renderState(state) {
    const viewStarting = document.getElementById("view-starting");
    const viewSetup = document.getElementById("view-setup");
    const viewReady = document.getElementById("view-ready");
    const viewClosed = document.getElementById("view-closed");
    const viewError = document.getElementById("view-error");
    const qrBox = document.getElementById("qr-box");
    const urlInput = document.getElementById("participant-link-input");
    const errorMsg = document.getElementById("error-message");

    currentStatus = state.status;

    if (state.status === "setup") {
        if (countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
        }
        expiresAtTimestamp = null;
        if (viewStarting) viewStarting.classList.add("hidden");
        if (viewReady) viewReady.classList.add("hidden");
        if (viewClosed) viewClosed.classList.add("hidden");
        if (viewError) viewError.classList.add("hidden");
        if (viewSetup) viewSetup.classList.remove("hidden");
    } else if (state.status === "ready") {
        if (viewStarting) viewStarting.classList.add("hidden");
        if (viewSetup) viewSetup.classList.add("hidden");
        if (viewClosed) viewClosed.classList.add("hidden");
        if (viewError) viewError.classList.add("hidden");
        if (viewReady) viewReady.classList.remove("hidden");

        if (qrBox && state.qrSvg) {
            qrBox.innerHTML = state.qrSvg;
        }

        if (urlInput && state.participantUrl) {
            urlInput.value = state.participantUrl;
        }

        if (state.expiresAt) {
            expiresAtTimestamp = new Date(state.expiresAt).getTime();
            updateCountdown();
            if (!countdownInterval) {
                countdownInterval = setInterval(updateCountdown, 1000);
            }
        }
    } else if (state.status === "closed" || state.status === "stopped") {
        if (countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
        }
        expiresAtTimestamp = null;
        if (viewStarting) viewStarting.classList.add("hidden");
        if (viewSetup) viewSetup.classList.add("hidden");
        if (viewReady) viewReady.classList.add("hidden");
        if (viewError) viewError.classList.add("hidden");
        if (viewClosed) viewClosed.classList.remove("hidden");
    } else if (state.status === "error") {
        if (countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
        }
        expiresAtTimestamp = null;
        if (viewStarting) viewStarting.classList.add("hidden");
        if (viewSetup) viewSetup.classList.add("hidden");
        if (viewReady) viewReady.classList.add("hidden");
        if (viewClosed) viewClosed.classList.add("hidden");
        if (viewError) viewError.classList.remove("hidden");

        if (errorMsg) {
            errorMsg.innerText = state.errorMessage || (typeof t === "function" ? t("error.desc") : "An unexpected error occurred while starting HAMAL.");
        }
    } else {
        // Starting
        if (viewSetup) viewSetup.classList.add("hidden");
        if (viewReady) viewReady.classList.add("hidden");
        if (viewClosed) viewClosed.classList.add("hidden");
        if (viewError) viewError.classList.add("hidden");
        if (viewStarting) viewStarting.classList.remove("hidden");
    }
}

function fetchHomeScreenState() {
    if (window.go && window.go.main && window.go.main.App) {
        window.go.main.App.GetHomeScreenState()
            .then((state) => {
                // If user is currently on the setup screen, do not let stale closed/stopped states override it
                if (currentStatus === "setup" && state.status !== "ready") {
                    return;
                }
                renderState(state);
            })
            .catch((err) => {
                console.error("Failed to fetch state:", err);
            });
    }
}

// Drag & Drop visual feedback
window.addEventListener("dragover", (e) => {
    if (currentStatus === "ready") {
        const dropTitle = typeof t === "function" ? t("upload.dropToSend") : "DROP TO SEND";
        const dropHint = typeof t === "function" ? t("upload.releaseToSend") : "Release to send files";
        setDropZoneState("dragover", dropTitle, dropHint);
    }
});

window.addEventListener("dragleave", (e) => {
    if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
        resetDropZoneDefault();
    }
});

// Windows System Theme Integration
function applySystemTheme(theme) {
    if (theme === "dark" || theme === "light") {
        document.documentElement.setAttribute("data-theme", theme);
    }
}

function initTheme() {
    // Remove old localStorage theme overrides so Windows system theme is always authoritative
    try {
        localStorage.removeItem("hamal_theme");
    } catch (e) {}

    // Query system theme from Go backend binding
    if (window.go && window.go.main && window.go.main.App && typeof window.go.main.App.GetSystemTheme === "function") {
        window.go.main.App.GetSystemTheme()
            .then(applySystemTheme)
            .catch(() => {
                if (window.matchMedia) {
                    const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
                    applySystemTheme(isDark ? "dark" : "light");
                }
            });
    } else if (window.matchMedia) {
        const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        applySystemTheme(isDark ? "dark" : "light");
    }
}

// Windows System Language Integration (Multilingual + RTL)
function initLanguage() {
    // Remove any previous localStorage overrides so Windows system language is always authoritative
    try {
        localStorage.removeItem("hamal_lang");
        localStorage.removeItem("hamal_language");
    } catch (e) {}

    if (window.go && window.go.main && window.go.main.App && typeof window.go.main.App.GetSystemLanguage === "function") {
        window.go.main.App.GetSystemLanguage()
            .then((lang) => {
                if (typeof setLocale === "function") {
                    setLocale(lang);
                }
                renderRoomFilesList();
                resetDropZoneDefault();
                refreshUpdateTexts();
            })
            .catch(() => {
                const navLang = (navigator.language || "en").split("-")[0];
                if (typeof setLocale === "function") {
                    setLocale(navLang);
                }
                renderRoomFilesList();
                resetDropZoneDefault();
                refreshUpdateTexts();
            });
    } else {
        const navLang = (navigator.language || "en").split("-")[0];
        if (typeof setLocale === "function") {
            setLocale(navLang);
        }
        renderRoomFilesList();
        resetDropZoneDefault();
        refreshUpdateTexts();
    }
}

// Setup Wails Native File Drop and Runtime Events
function initWailsDropListeners() {
    initTheme();
    initLanguage();

    if (window.runtime) {
        if (typeof window.runtime.OnFileDrop === "function") {
            window.runtime.OnFileDrop(() => {}, false);
        }

        // Listen for live Windows system theme change notifications from Go
        window.runtime.EventsOn("system-theme-changed", (theme) => {
            applySystemTheme(theme);
        });

        window.runtime.EventsOn("upload-started", (data) => {
            const title = data.total > 1 
                ? (typeof t === "function" ? t("upload.uploadingCount", { current: data.index, total: data.total }) : `UPLOADING ${data.index} / ${data.total}`)
                : (typeof t === "function" ? t("upload.uploading") : "UPLOADING");
            setDropZoneState("uploading", title, getBrowseHintHtml(), 0, data.filename);
        });

        window.runtime.EventsOn("upload-progress", (data) => {
            const title = data.total > 1 
                ? (typeof t === "function" ? t("upload.uploadingCount", { current: data.index, total: data.total }) : `UPLOADING ${data.index} / ${data.total}`)
                : (typeof t === "function" ? t("upload.uploading") : "UPLOADING");
            setDropZoneState("uploading", title, getBrowseHintHtml(), data.percent || 0, data.filename);
        });

        window.runtime.EventsOn("upload-file-complete", (data) => {
            if (data && data.fileId) {
                fileOrderCounter++;
                roomFilesMap.set(data.fileId, {
                    fileId: data.fileId,
                    filename: data.filename,
                    sizeFormatted: data.sizeFormatted || "",
                    direction: "outbound",
                    saved: false,
                    order: fileOrderCounter,
                    timestamp: Date.now()
                });
                renderRoomFilesList();
            }
        });

        window.runtime.EventsOn("upload-batch-complete", (data) => {
            if (data.total === 1) {
                if (data.successCount === 1) {
                    const sentTitle = typeof t === "function" ? t("upload.fileSent") : "FILE SENT";
                    setDropZoneState("success", sentTitle, data.singleName || "File transferred", null);
                } else {
                    const failedTitle = typeof t === "function" ? t("upload.failed") : "UPLOAD FAILED";
                    setDropZoneState("error", failedTitle, `${data.singleName || "File"}: ${data.lastError || "Upload failed"}`, null);
                }
            } else {
                if (data.failedCount === 0) {
                    const filesSentTitle = typeof t === "function" ? t("upload.filesSent") : "FILES SENT";
                    const allSentMsg = typeof t === "function" ? t("upload.allFilesSent", { total: data.total }) : `All ${data.total} files sent successfully`;
                    setDropZoneState("success", filesSentTitle, allSentMsg, null);
                } else {
                    const finishedTitle = typeof t === "function" ? t("upload.finished") : "UPLOAD FINISHED";
                    const summaryMsg = typeof t === "function" ? t("upload.summary", { success: data.successCount, failed: data.failedCount }) : `${data.successCount} sent, ${data.failedCount} failed`;
                    setDropZoneState("error", finishedTitle, summaryMsg, null);
                }
            }

            dropResetTimeout = setTimeout(() => {
                resetDropZoneDefault();
            }, 4500);
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
                    });
                }
                renderRoomFilesList();
            }
        });

        // Background update check events from Go
        window.runtime.EventsOn("update-available", (info) => {
            if (info && info.available) {
                showUpdateBanner(info);
            }
        });

        window.runtime.EventsOn("update-progress", (data) => {
            if (data) {
                updateProgressUI(data.percent || 0);
            }
        });
    }
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initWailsDropListeners);
} else {
    initWailsDropListeners();
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

// Modal Management (Feedback & About)
window.openFeedbackModal = function () {
    const backdrop = document.getElementById("modal-backdrop");
    const modalFeedback = document.getElementById("modal-feedback");
    const modalAbout = document.getElementById("modal-about");
    const statusMsg = document.getElementById("feedback-status-msg");
    const msgInput = document.getElementById("feedback-message");

    if (modalAbout) modalAbout.classList.add("hidden");
    if (modalFeedback) modalFeedback.classList.remove("hidden");
    if (backdrop) backdrop.classList.remove("hidden");
    if (statusMsg) statusMsg.style.display = "none";
    if (msgInput) {
        setTimeout(() => msgInput.focus(), 50);
    }
};

window.openAboutModal = function () {
    const backdrop = document.getElementById("modal-backdrop");
    const modalFeedback = document.getElementById("modal-feedback");
    const modalAbout = document.getElementById("modal-about");

    if (modalFeedback) modalFeedback.classList.add("hidden");
    if (modalAbout) modalAbout.classList.remove("hidden");
    if (backdrop) backdrop.classList.remove("hidden");
};

window.closeAllModals = function (e) {
    if (e && e.target && e.target.id !== "modal-backdrop" && !e.target.classList.contains("modal-close-btn")) {
        return;
    }
    const backdrop = document.getElementById("modal-backdrop");
    const modalFeedback = document.getElementById("modal-feedback");
    const modalAbout = document.getElementById("modal-about");

    if (backdrop) backdrop.classList.add("hidden");
    if (modalFeedback) modalFeedback.classList.add("hidden");
    if (modalAbout) modalAbout.classList.add("hidden");
};

window.submitFeedbackForm = function (e) {
    if (e) e.preventDefault();

    const typeEl = document.getElementById("feedback-type");
    const msgEl = document.getElementById("feedback-message");
    const emailEl = document.getElementById("feedback-email");
    const submitBtn = document.getElementById("feedback-submit-btn");
    const statusMsg = document.getElementById("feedback-status-msg");

    const type = typeEl ? typeEl.value : "other";
    const message = msgEl ? msgEl.value.trim() : "";
    const email = emailEl ? emailEl.value.trim() : "";

    if (!message) {
        if (statusMsg) {
            statusMsg.className = "feedback-status-msg error";
            statusMsg.innerText = typeof t === "function" ? t("feedback.requiredMsg") : "Please enter a message before submitting.";
            statusMsg.style.display = "block";
        }
        return;
    }

    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = typeof t === "function" ? t("feedback.sending") : "Sending...";
    }

    if (statusMsg) {
        statusMsg.style.display = "none";
    }

    const payload = { type, message, email };

    if (window.go && window.go.main && window.go.main.App && typeof window.go.main.App.SubmitFeedback === "function") {
        window.go.main.App.SubmitFeedback(payload)
            .then((res) => {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerText = typeof t === "function" ? t("feedback.sendBtn") : "Send Feedback";
                }

                if (!statusMsg) return;

                if (res.success) {
                    statusMsg.className = "feedback-status-msg success";
                    statusMsg.innerText = typeof t === "function" ? t("feedback.success") : (res.message || "Thank you for helping us improve HAMAL ❤️");
                    statusMsg.style.display = "block";
                    if (msgEl) msgEl.value = "";
                    if (emailEl) emailEl.value = "";
                    setTimeout(() => {
                        window.closeAllModals();
                    }, 2500);
                } else if (!res.configured) {
                    statusMsg.className = "feedback-status-msg info";
                    statusMsg.innerText = typeof t === "function" ? t("feedback.unconfigured") : (res.message || "Feedback is not available yet. Please try again later.");
                    statusMsg.style.display = "block";
                } else {
                    statusMsg.className = "feedback-status-msg error";
                    statusMsg.innerText = res.message || (typeof t === "function" ? t("error.desc") : "Failed to submit feedback.");
                    statusMsg.style.display = "block";
                }
            })
            .catch((err) => {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.innerText = typeof t === "function" ? t("feedback.sendBtn") : "Send Feedback";
                }
                if (statusMsg) {
                    statusMsg.className = "feedback-status-msg error";
                    statusMsg.innerText = String(err);
                    statusMsg.style.display = "block";
                }
            });
    } else {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerText = typeof t === "function" ? t("feedback.sendBtn") : "Send Feedback";
        }
        if (statusMsg) {
            statusMsg.className = "feedback-status-msg info";
            statusMsg.innerText = typeof t === "function" ? t("feedback.unconfigured") : "Feedback is not available yet. Please try again later.";
            statusMsg.style.display = "block";
        }
    }
};

// Open Feedback mailto action
window.openFeedbackEmail = function (e) {
    if (e && typeof e.preventDefault === "function") {
        e.preventDefault();
    }
    const mailtoUrl = "mailto:hamalapp@outlook.com?subject=HAMAL%20Feedback";
    if (window.go && window.go.main && window.go.main.App && typeof window.go.main.App.OpenFeedbackEmail === "function") {
        window.go.main.App.OpenFeedbackEmail();
    } else if (window.runtime && typeof window.runtime.BrowserOpenURL === "function") {
        window.runtime.BrowserOpenURL(mailtoUrl);
    } else {
        window.location.href = mailtoUrl;
    }
};

// Keyboard listener for Escape key to close modals
window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || e.keyCode === 27) {
        window.closeAllModals();
    }
});

// --------------------------------------------------------------------------
// Update Notification Management
// --------------------------------------------------------------------------
let pendingUpdateInfo = null;

function refreshUpdateTexts() {
    if (!pendingUpdateInfo) return;
    const verText = document.getElementById("update-version-text");
    const curText = document.getElementById("update-current-text");
    if (verText) {
        verText.innerText = typeof t === "function"
            ? t("update.available", { version: pendingUpdateInfo.latestVersion || "" })
            : `Version ${pendingUpdateInfo.latestVersion} is now available.`;
    }
    if (curText) {
        curText.innerText = typeof t === "function"
            ? t("update.current", { version: pendingUpdateInfo.currentVersion || "" })
            : `You are currently using ${pendingUpdateInfo.currentVersion}.`;
    }
}

function showUpdateBanner(info) {
    if (!info) return;
    pendingUpdateInfo = info;

    const banner = document.getElementById("update-banner");
    const verText = document.getElementById("update-version-text");
    const curText = document.getElementById("update-current-text");
    const progressBox = document.getElementById("update-progress-box");
    const actionsBox = document.getElementById("update-actions-box");
    const errorBox = document.getElementById("update-error-box");
    const nowBtn = document.getElementById("update-now-btn");
    const laterBtn = document.getElementById("update-later-btn");

    if (verText) {
        verText.innerText = typeof t === "function"
            ? t("update.available", { version: info.latestVersion || "" })
            : `Version ${info.latestVersion} is now available.`;
    }

    if (curText) {
        curText.innerText = typeof t === "function"
            ? t("update.current", { version: info.currentVersion || "" })
            : `You are currently using ${info.currentVersion}.`;
    }

    if (progressBox) progressBox.classList.add("hidden");
    if (errorBox) errorBox.classList.add("hidden");
    if (actionsBox) actionsBox.classList.remove("hidden");
    if (nowBtn) {
        nowBtn.disabled = false;
        nowBtn.innerText = typeof t === "function" ? t("update.updateNow") : "Update Now";
    }
    if (laterBtn) {
        laterBtn.disabled = false;
    }

    if (banner) banner.classList.remove("hidden");
}

function updateProgressUI(percent) {
    const fill = document.getElementById("update-progress-fill");
    const pctText = document.getElementById("update-progress-percent");

    if (fill) fill.style.width = percent + "%";
    if (pctText) pctText.innerText = percent + "%";
}

window.dismissUpdateBanner = function () {
    const banner = document.getElementById("update-banner");
    if (banner) banner.classList.add("hidden");
};

window.startUpdate = function () {
    if (!pendingUpdateInfo || !pendingUpdateInfo.assetUrl) return;

    const banner = document.getElementById("update-banner");
    const progressBox = document.getElementById("update-progress-box");
    const actionsBox = document.getElementById("update-actions-box");
    const progressStatus = document.getElementById("update-progress-status");
    const errorBox = document.getElementById("update-error-box");
    const nowBtn = document.getElementById("update-now-btn");
    const laterBtn = document.getElementById("update-later-btn");

    if (nowBtn) nowBtn.disabled = true;
    if (laterBtn) laterBtn.disabled = true;
    if (errorBox) errorBox.classList.add("hidden");

    if (progressBox) progressBox.classList.remove("hidden");
    if (actionsBox) actionsBox.classList.add("hidden");

    if (progressStatus) {
        progressStatus.innerText = typeof t === "function"
            ? t("update.downloading", { version: pendingUpdateInfo.latestVersion || "" })
            : `Downloading HAMAL ${pendingUpdateInfo.latestVersion}…`;
    }

    updateProgressUI(0);

    if (window.go && window.go.main && window.go.main.App && typeof window.go.main.App.ApplyUpdate === "function") {
        window.go.main.App.ApplyUpdate(pendingUpdateInfo.assetUrl)
            .then((res) => {
                let success = false;
                let errMsg = "";
                if (Array.isArray(res)) {
                    success = res[0];
                    errMsg = res[1] || "";
                } else if (typeof res === "object" && res !== null) {
                    success = res.success || res.r0 || false;
                    errMsg = res.errorMessage || res.r1 || "";
                } else if (typeof res === "boolean") {
                    success = res;
                }

                if (success) {
                    if (progressStatus) {
                        progressStatus.innerText = typeof t === "function"
                            ? t("update.installing")
                            : "Applying update and restarting…";
                    }
                    updateProgressUI(100);
                } else {
                    if (progressBox) progressBox.classList.add("hidden");
                    if (actionsBox) actionsBox.classList.remove("hidden");
                    if (nowBtn) {
                        nowBtn.disabled = false;
                        nowBtn.innerText = typeof t === "function" ? t("update.retry") : "Retry";
                    }
                    if (laterBtn) laterBtn.disabled = false;

                    if (errorBox) {
                        errorBox.innerText = errMsg || (typeof t === "function" ? t("update.failed") : "Update failed. Please try again.");
                        errorBox.classList.remove("hidden");
                    }
                }
            })
            .catch((err) => {
                if (progressBox) progressBox.classList.add("hidden");
                if (actionsBox) actionsBox.classList.remove("hidden");
                if (nowBtn) {
                    nowBtn.disabled = false;
                    nowBtn.innerText = typeof t === "function" ? t("update.retry") : "Retry";
                }
                if (laterBtn) laterBtn.disabled = false;

                if (errorBox) {
                    errorBox.innerText = String(err) || (typeof t === "function" ? t("update.failed") : "Update failed. Please try again.");
                    errorBox.classList.remove("hidden");
                }
            });
    }
};


