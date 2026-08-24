let currentStatus = "starting";
const roomFilesMap = new Map();
let fileOrderCounter = 0;
let totalTransferredBytes = 0;
let dropResetTimeout = null;
let expiresAtTimestamp = null;
let countdownInterval = null;
let currentRoomPin = "";
const recentActivities = [];
const connectedParticipantsMap = new Map();

// Authentic HAMAL Pixel-Art File Type SVG Icons
const FILE_PIXEL_ICONS = {
    image: `<svg class="pixel-icon pixel-icon-image" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Image"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`,
    video: `<svg class="pixel-icon pixel-icon-video" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Video"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>`,
    audio: `<svg class="pixel-icon pixel-icon-audio" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Audio"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>`,
    pdf: `<svg class="pixel-icon pixel-icon-pdf" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="PDF Document"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M9 15h2a1.5 1.5 0 0 0 0-3H9v6"></path><path d="M15 12h-2v6"></path></svg>`,
    doc: `<svg class="pixel-icon pixel-icon-doc" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Document"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>`,
    sheet: `<svg class="pixel-icon pixel-icon-sheet" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Spreadsheet"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><path d="M8 13h8M8 17h8M12 13v8"></path></svg>`,
    presentation: `<svg class="pixel-icon pixel-icon-pres" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Presentation"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>`,
    archive: `<svg class="pixel-icon pixel-icon-archive" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Archive"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg>`,
    disk: `<svg class="pixel-icon pixel-icon-disk" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Disk Image"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="3"></circle></svg>`,
    code: `<svg class="pixel-icon pixel-icon-code" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Code"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>`,
    lib: `<svg class="pixel-icon pixel-icon-lib" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Library Component"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>`,
    win_exe: `<svg class="pixel-icon pixel-icon-exe" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Windows Application"><rect x="3" y="3" width="18" height="18" rx="3" ry="3"></rect><polygon points="10 8 16 12 10 16 10 8"></polygon></svg>`,
    script: `<svg class="pixel-icon pixel-icon-script" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Script"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>`,
    java: `<svg class="pixel-icon pixel-icon-java" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Java Package"><path d="M18 8h1a4 4 0 0 1 0 8h-1"></path><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path><line x1="6" y1="1" x2="6" y2="4"></line><line x1="10" y1="1" x2="10" y2="4"></line><line x1="14" y1="1" x2="14" y2="4"></line></svg>`,
    android: `<svg class="pixel-icon pixel-icon-android" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Android Package"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>`,
    linux: `<svg class="pixel-icon pixel-icon-linux" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Linux Application"><rect x="4" y="4" width="16" height="16" rx="2"></rect><circle cx="9" cy="9" r="1"></circle><circle cx="15" cy="9" r="1"></circle><path d="M8 15s1.5 2 4 2 4-2 4-2"></path></svg>`,
    generic: `<svg class="pixel-icon pixel-icon-generic" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="File"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`
};

function getFileCategory(filename) {
    if (!filename) return "generic";
    const lower = filename.toLowerCase();

    if (lower.endsWith(".tar.gz") || lower.endsWith(".tar.bz2") || lower.endsWith(".tar.xz")) {
        return "archive";
    }

    const parts = lower.split(".");
    if (parts.length <= 1) return "generic";
    const ext = parts.pop();

    if (["jpg", "jpeg", "png", "webp", "gif", "bmp", "tiff", "tif", "svg", "ico"].includes(ext)) return "image";
    if (["mp4", "mkv", "avi", "mov", "webm", "m4v", "wmv"].includes(ext)) return "video";
    if (["mp3", "wav", "flac", "m4a", "aac", "ogg", "wma"].includes(ext)) return "audio";
    if (ext === "pdf") return "pdf";
    if (["doc", "docx", "odt", "rtf", "txt", "md"].includes(ext)) return "doc";
    if (["xls", "xlsx", "csv", "ods"].includes(ext)) return "sheet";
    if (["ppt", "pptx", "odp"].includes(ext)) return "presentation";
    if (["zip", "rar", "7z", "tar", "gz", "bz2", "xz"].includes(ext)) return "archive";
    if (["iso", "img"].includes(ext)) return "disk";
    if (["exe", "msi", "com", "scr"].includes(ext)) return "win_exe";
    if (["bat", "cmd", "vbs", "ps1", "sh"].includes(ext)) return "script";
    if (ext === "jar") return "java";
    if (["apk", "aab"].includes(ext)) return "android";
    if (["appimage", "deb", "rpm"].includes(ext)) return "linux";
    if (["dll", "so", "dylib"].includes(ext)) return "lib";
    if (["html", "htm", "css", "js", "ts", "json", "xml", "go", "py", "java", "c", "cpp", "h", "hpp", "rs"].includes(ext)) return "code";

    return "generic";
}

function isPotentiallyExecutable(filename) {
    if (!filename) return false;
    const lower = filename.toLowerCase();
    const parts = lower.split(".");
    if (parts.length <= 1) return false;
    const ext = parts.pop();

    return [
        "exe", "msi", "com", "scr", "bat", "cmd",
        "ps1", "vbs", "sh",
        "jar",
        "apk", "aab",
        "appimage", "deb", "rpm"
    ].includes(ext);
}

function getFileIconSVG(filename) {
    const cat = getFileCategory(filename);
    return FILE_PIXEL_ICONS[cat] || FILE_PIXEL_ICONS.generic;
}

function formatBytes(bytes) {
    if (!bytes || bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

// --------------------------------------------------------------------------
// Navigation & Tab Management
// --------------------------------------------------------------------------
window.switchNavTab = function (tab) {
    const btnRoom = document.getElementById("nav-btn-room");
    const btnFiles = document.getElementById("nav-btn-files");

    if (tab === "files") {
        if (btnRoom) btnRoom.classList.remove("active");
        if (btnFiles) btnFiles.classList.add("active");
        const fileListEl = document.getElementById("file-list");
        if (fileListEl) {
            fileListEl.scrollIntoView({ behavior: "smooth" });
        }
    } else {
        if (btnFiles) btnFiles.classList.remove("active");
        if (btnRoom) btnRoom.classList.add("active");
    }
};

// --------------------------------------------------------------------------
// Dropzone State Management
// --------------------------------------------------------------------------
function resetDropZoneDefault() {
    const defaultTitle = typeof t === "function" ? t("upload.title") : "UPLOAD FILES";
    setDropZoneState("", defaultTitle, "Tap or drag files here");
}

function setDropZoneState(state, title, hint, progress, filename) {
    const zone = document.getElementById("dropzone");
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

    zone.className = "dropzone-panel " + state;
    titleElem.innerText = title;
    hintElem.innerHTML = hint;

    if (state === "uploading") {
        const uploadingText = typeof t === "function" ? t("upload.uploading") : "Uploading file…";
        if (progContainer) progContainer.style.display = "flex";
        if (progFilename) progFilename.innerText = filename || uploadingText;
        if (progPercent) progPercent.innerText = (progress || 0) + "%";
        if (progFill) progFill.style.width = (progress || 0) + "%";
        if (progError) progError.style.display = "none";
    } else {
        if (progContainer) progContainer.style.display = "none";
        if (progFill) progFill.style.width = "0%";
    }
}

// --------------------------------------------------------------------------
// Activity Stream & Participants
// --------------------------------------------------------------------------
function addRecentActivity(type, filename, subtext) {
    recentActivities.unshift({
        type, // "upload" or "download"
        filename,
        subtext,
        time: "Just now",
        timestamp: Date.now()
    });

    if (recentActivities.length > 8) {
        recentActivities.pop();
    }
    renderActivityList();
}

function renderActivityList() {
    const activityList = document.getElementById("activity-list");
    if (!activityList) return;

    if (recentActivities.length === 0) {
        const emptyText = typeof t === "function" ? t("activity.empty") : "No transfer activity yet";
        activityList.innerHTML = `
            <div style="padding: 12px; font-size: 11px; font-family: var(--font-mono); color: var(--text-muted); text-align: center;">
                ${emptyText}
            </div>
        `;
        return;
    }

    activityList.innerHTML = "";
    recentActivities.forEach((act) => {
        const row = document.createElement("div");
        row.className = "activity-row";

        const mainDiv = document.createElement("div");
        mainDiv.className = "activity-main";

        const iconDiv = document.createElement("div");
        iconDiv.className = `activity-direction-icon ${act.type}`;
        if (act.type === "download") {
            iconDiv.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>`;
        } else {
            iconDiv.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>`;
        }

        const metaDiv = document.createElement("div");
        metaDiv.className = "activity-meta";

        const nameSpan = document.createElement("span");
        nameSpan.className = "activity-filename";
        nameSpan.innerText = act.filename;

        const subSpan = document.createElement("span");
        subSpan.className = "activity-subtext";
        subSpan.innerText = act.subtext;

        metaDiv.appendChild(nameSpan);
        metaDiv.appendChild(subSpan);
        mainDiv.appendChild(iconDiv);
        mainDiv.appendChild(metaDiv);

        const timeSpan = document.createElement("span");
        timeSpan.className = "activity-time";
        timeSpan.innerText = act.time;

        row.appendChild(mainDiv);
        row.appendChild(timeSpan);
        activityList.appendChild(row);
    });
}

function registerParticipant(name, ip) {
    if (!name) name = "Mobile Device";
    connectedParticipantsMap.set(ip || name, {
        name,
        ip: ip || "LAN Peer",
        status: "Active",
        lastSeen: Date.now()
    });
    renderParticipantList();
}

function renderParticipantList() {
    const list = document.getElementById("participant-list");
    const countBadge = document.getElementById("participant-count");
    const metricCount = document.getElementById("metric-connected-count");
    if (!list) return;

    const count = connectedParticipantsMap.size;
    if (countBadge) countBadge.innerText = String(count);
    if (metricCount) metricCount.innerText = String(count);

    if (count === 0) {
        list.innerHTML = `
            <div style="padding: 12px; font-size: 11px; font-family: var(--font-mono); color: var(--text-muted); text-align: center;">
                Waiting for devices to scan and connect…
            </div>
        `;
        return;
    }

    list.innerHTML = "";
    connectedParticipantsMap.forEach((p) => {
        const row = document.createElement("div");
        row.className = "participant-row";

        const infoDiv = document.createElement("div");
        infoDiv.className = "participant-info";

        const iconDiv = document.createElement("div");
        iconDiv.className = "participant-icon";
        iconDiv.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>`;

        const detailsDiv = document.createElement("div");
        detailsDiv.className = "participant-details";

        const nameSpan = document.createElement("span");
        nameSpan.className = "participant-name";
        nameSpan.innerText = p.name;

        const ipSpan = document.createElement("span");
        ipSpan.className = "participant-ip";
        ipSpan.innerText = p.ip;

        detailsDiv.appendChild(nameSpan);
        detailsDiv.appendChild(ipSpan);
        infoDiv.appendChild(iconDiv);
        infoDiv.appendChild(detailsDiv);

        const statusSpan = document.createElement("span");
        statusSpan.className = "participant-status";
        statusSpan.innerHTML = `<span class="status-dot"></span> Active`;

        row.appendChild(infoDiv);
        row.appendChild(statusSpan);
        list.appendChild(row);
    });
}

// --------------------------------------------------------------------------
// File List Rendering (with Dieter Rams Pixel-Art Icons & Empty State)
// --------------------------------------------------------------------------
function renderRoomFilesList() {
    const list = document.getElementById("file-list");
    const countBadge = document.getElementById("file-count");
    const navFileCount = document.getElementById("nav-file-count");
    if (!list) return;

    const count = roomFilesMap.size;
    if (countBadge) countBadge.innerText = String(count);
    if (navFileCount) navFileCount.innerText = String(count);

    if (count === 0) {
        const emptyTitle = typeof t === "function" ? t("files.emptyTitle") : "No files uploaded yet";
        const emptyText = typeof t === "function" ? t("files.emptyText") : "Drop parcels above or browse from your device. Connected participants will receive files in real time.";
        list.innerHTML = `
            <div id="no-files-msg" class="empty-state-box">
                <div class="file-icon-box" style="color: var(--text-muted);">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
                </div>
                <p class="empty-state-title">${emptyTitle}</p>
                <p class="empty-state-lead">${emptyText}</p>
            </div>
        `;
        return;
    }

    list.innerHTML = "";
    const files = Array.from(roomFilesMap.values()).sort((a, b) => b.order - a.order);

    files.forEach((file) => {
        const row = document.createElement("div");
        row.className = "file-row";
        row.dataset.fileId = file.fileId;

        const mainDiv = document.createElement("div");
        mainDiv.className = "file-main";

        const iconDiv = document.createElement("div");
        iconDiv.className = "file-icon-box";
        iconDiv.innerHTML = getFileIconSVG(file.filename);

        const textCol = document.createElement("div");
        textCol.className = "file-text-col";

        const titleSpan = document.createElement("span");
        titleSpan.className = "file-title";
        titleSpan.title = file.filename;
        titleSpan.innerText = file.filename;

        const specsSpan = document.createElement("span");
        specsSpan.className = "file-specs font-mono";
        specsSpan.innerText = file.sizeFormatted || "";

        textCol.appendChild(titleSpan);
        textCol.appendChild(specsSpan);
        mainDiv.appendChild(iconDiv);
        mainDiv.appendChild(textCol);

        const actionsDiv = document.createElement("div");
        actionsDiv.className = "file-actions";

        if (file.direction === "outbound") {
            const sentBadge = document.createElement("span");
            sentBadge.className = "badge-sent font-mono";
            sentBadge.innerText = typeof t === "function" ? t("files.sent") : "SENT";
            actionsDiv.appendChild(sentBadge);
        } else {
            if (isPotentiallyExecutable(file.filename)) {
                const warnSpan = document.createElement("span");
                warnSpan.className = "badge-exec-warning";
                warnSpan.tabIndex = 0;
                warnSpan.setAttribute("role", "tooltip");
                const warnText = typeof t === "function" ? t("files.executableWarning") : "Potentially executable file. Only open or install files you trust.";
                warnSpan.setAttribute("aria-label", warnText);
                warnSpan.title = warnText;
                warnSpan.innerHTML = `
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                        <line x1="12" y1="9" x2="12" y2="13"></line>
                        <line x1="12" y1="17" x2="12.01" y2="17"></line>
                    </svg>
                    <span class="warning-tooltip">${warnText}</span>
                `;
                actionsDiv.appendChild(warnSpan);
            }

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

        row.appendChild(mainDiv);
        row.appendChild(actionsDiv);
        list.appendChild(row);
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
    window.openCloseConfirmModal();
};

window.openCloseConfirmModal = function () {
    const backdrop = document.getElementById("modal-backdrop");
    const modalCloseConfirm = document.getElementById("modal-close-confirm");
    const modalAbout = document.getElementById("modal-about");
    const modalQR = document.getElementById("modal-qr");

    if (modalAbout) modalAbout.classList.add("hidden");
    if (modalQR) modalQR.classList.add("hidden");
    if (modalCloseConfirm) modalCloseConfirm.classList.remove("hidden");
    if (backdrop) backdrop.classList.remove("hidden");
};

window.openAboutModal = function () {
    const backdrop = document.getElementById("modal-backdrop");
    const modalAbout = document.getElementById("modal-about");
    const modalCloseConfirm = document.getElementById("modal-close-confirm");
    const modalQR = document.getElementById("modal-qr");

    if (modalCloseConfirm) modalCloseConfirm.classList.add("hidden");
    if (modalQR) modalQR.classList.add("hidden");
    if (modalAbout) modalAbout.classList.remove("hidden");
    if (backdrop) backdrop.classList.remove("hidden");
};

window.openQRLightbox = function () {
    const qrBox = document.getElementById("qr-box");
    const lightboxBox = document.getElementById("qr-lightbox-box");
    const backdrop = document.getElementById("modal-backdrop");
    const modalQR = document.getElementById("modal-qr");
    const modalAbout = document.getElementById("modal-about");
    const modalCloseConfirm = document.getElementById("modal-close-confirm");

    if (qrBox && lightboxBox) {
        lightboxBox.innerHTML = qrBox.innerHTML;
    }
    if (modalCloseConfirm) modalCloseConfirm.classList.add("hidden");
    if (modalAbout) modalAbout.classList.add("hidden");
    if (modalQR) modalQR.classList.remove("hidden");
    if (backdrop) backdrop.classList.remove("hidden");
};

window.closeAllModals = function (e) {
    if (e && e.target && e.target.id !== "modal-backdrop" && !e.target.classList.contains("modal-close-btn") && !e.target.closest(".modal-close-btn")) {
        return;
    }
    const backdrop = document.getElementById("modal-backdrop");
    const modalCloseConfirm = document.getElementById("modal-close-confirm");
    const modalAbout = document.getElementById("modal-about");
    const modalQR = document.getElementById("modal-qr");

    if (backdrop) backdrop.classList.add("hidden");
    if (modalCloseConfirm) modalCloseConfirm.classList.add("hidden");
    if (modalAbout) modalAbout.classList.add("hidden");
    if (modalQR) modalQR.classList.add("hidden");
};

window.openFeedbackEmail = function (e) {
    if (e) e.preventDefault();
    if (window.go && window.go.main && window.go.main.App && typeof window.go.main.App.OpenFeedbackEmail === "function") {
        window.go.main.App.OpenFeedbackEmail();
    } else {
        window.location.href = "mailto:hamalapp@outlook.com?subject=HAMAL%20Feedback";
    }
};

window.confirmCloseRoom = function () {
    window.closeAllModals();
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
    recentActivities.length = 0;
    connectedParticipantsMap.clear();
    renderRoomFilesList();
    renderActivityList();
    renderParticipantList();

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

    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
    expiresAtTimestamp = null;

    roomFilesMap.clear();
    fileOrderCounter = 0;
    recentActivities.length = 0;
    connectedParticipantsMap.clear();
    renderRoomFilesList();
    renderActivityList();
    renderParticipantList();

    renderState({ status: "setup" });

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

    currentRoomPin = pin;

    if (errorEl) errorEl.style.display = "none";
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span>${typeof t === "function" ? t("create.creatingBtn") : "Creating Room..."}</span>`;
    }

    roomFilesMap.clear();
    fileOrderCounter = 0;
    recentActivities.length = 0;
    connectedParticipantsMap.clear();
    renderRoomFilesList();
    renderActivityList();
    renderParticipantList();

    const resetSubmitBtn = () => {
        if (submitBtn) {
            submitBtn.disabled = false;
            const btnText = typeof t === "function" ? t("create.submitBtn") : "Create Transfer Room";
            submitBtn.innerHTML = `<span data-i18n="create.submitBtn">${btnText}</span> <span>→</span>`;
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

// --------------------------------------------------------------------------
// Core State Rendering
// --------------------------------------------------------------------------
function renderState(state) {
    const viewStarting = document.getElementById("view-starting");
    const viewSetup = document.getElementById("view-setup");
    const viewReady = document.getElementById("view-ready");
    const viewClosed = document.getElementById("view-closed");
    const viewError = document.getElementById("view-error");
    const qrBox = document.getElementById("qr-box");
    const urlInput = document.getElementById("participant-link-input");
    const errorMsg = document.getElementById("error-message");
    const pinBox = document.getElementById("pin-display-box");
    const pinDisplay = document.getElementById("room-pin-display");

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
    } else if (state.status === "ready" || state.status === "closing") {
        if (viewStarting) viewStarting.classList.add("hidden");
        if (viewSetup) viewSetup.classList.add("hidden");
        if (viewClosed) viewClosed.classList.add("hidden");
        if (viewError) viewError.classList.add("hidden");
        if (viewReady) viewReady.classList.remove("hidden");

        const statusBadge = document.getElementById("status-badge");
        if (state.status === "closing") {
            if (statusBadge) {
                const rem = state.closingRemainingSeconds || 10;
                statusBadge.innerHTML = `<span class="status-dot" style="background: var(--accent-amber); box-shadow: 0 0 6px var(--accent-amber);"></span><span style="color: var(--accent-amber);">${typeof t === "function" ? t("room.closing", { sec: rem }) : "ROOM CLOSING"} (${rem}s)</span>`;
            }
        } else {
            if (statusBadge) {
                statusBadge.innerHTML = `<span class="status-dot"></span><span data-i18n="room.active">${typeof t === "function" ? t("room.active") : "ROOM ACTIVE"}</span>`;
            }
        }

        if (qrBox && state.qrSvg) {
            qrBox.innerHTML = state.qrSvg;
        }

        if (urlInput && state.participantUrl) {
            urlInput.value = state.participantUrl;
        }

        if (pinBox && pinDisplay) {
            if (currentRoomPin || state.pinRequired) {
                pinDisplay.innerText = currentRoomPin || "PIN SET";
                pinBox.style.display = "flex";
            } else {
                pinBox.style.display = "none";
            }
        }

        if (state.expiresAt && !expiresAtTimestamp) {
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
// Theme Controls
// --------------------------------------------------------------------------
window.setUserTheme = function (theme) {
    applySystemTheme(theme);
};

function applySystemTheme(theme) {
    if (theme === "dark" || theme === "light") {
        document.documentElement.setAttribute("data-theme", theme);
        const btnLight = document.getElementById("theme-btn-light");
        const btnDark = document.getElementById("theme-btn-dark");
        if (btnLight && btnDark) {
            if (theme === "light") {
                btnLight.classList.add("active");
                btnDark.classList.remove("active");
            } else {
                btnDark.classList.add("active");
                btnLight.classList.remove("active");
            }
        }
    }
}

function initTheme() {
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

// --------------------------------------------------------------------------
// Language Initialization
// --------------------------------------------------------------------------
function initLanguage() {
    if (window.go && window.go.main && window.go.main.App && typeof window.go.main.App.GetSystemLanguage === "function") {
        window.go.main.App.GetSystemLanguage()
            .then((lang) => {
                if (typeof setLocale === "function") {
                    setLocale(lang);
                }
                renderRoomFilesList();
                renderActivityList();
                renderParticipantList();
                resetDropZoneDefault();
                refreshUpdateTexts();
            })
            .catch(() => {
                const navLang = (navigator.language || "en").split("-")[0];
                if (typeof setLocale === "function") {
                    setLocale(navLang);
                }
                renderRoomFilesList();
                renderActivityList();
                renderParticipantList();
                resetDropZoneDefault();
                refreshUpdateTexts();
            });
    } else {
        const navLang = (navigator.language || "en").split("-")[0];
        if (typeof setLocale === "function") {
            setLocale(navLang);
        }
        renderRoomFilesList();
        renderActivityList();
        renderParticipantList();
        resetDropZoneDefault();
        refreshUpdateTexts();
    }
}

function initVersionDisplay() {
    if (window.go && window.go.main && window.go.main.App && typeof window.go.main.App.GetAppVersion === "function") {
        window.go.main.App.GetAppVersion().then((ver) => {
            if (ver) {
                const aboutVer = document.getElementById("about-app-version");
                const sideVer = document.getElementById("sidebar-version");
                if (aboutVer) aboutVer.innerText = ver;
                if (sideVer) sideVer.innerText = ver;
            }
        }).catch(() => {});
    }
}

// --------------------------------------------------------------------------
// Drag & Drop Listeners
// --------------------------------------------------------------------------
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

// Keyboard listener for Escape key to close modals
window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || e.keyCode === 27) {
        window.closeAllModals();
    }
});

// --------------------------------------------------------------------------
// Wails Event Subscriptions
// --------------------------------------------------------------------------
function initWailsListeners() {
    initTheme();
    initLanguage();
    initVersionDisplay();

    if (window.runtime) {
        if (typeof window.runtime.OnFileDrop === "function") {
            window.runtime.OnFileDrop(() => {}, false);
        }

        window.runtime.EventsOn("system-theme-changed", (theme) => {
            applySystemTheme(theme);
        });

        window.runtime.EventsOn("upload-started", (data) => {
            const title = data.total > 1 
                ? (typeof t === "function" ? t("upload.uploadingCount", { current: data.index, total: data.total }) : `UPLOADING ${data.index} / ${data.total}`)
                : (typeof t === "function" ? t("upload.uploading") : "UPLOADING");
            setDropZoneState("uploading", title, "Sending parcel…", 0, data.filename);
        });

        window.runtime.EventsOn("upload-progress", (data) => {
            const title = data.total > 1 
                ? (typeof t === "function" ? t("upload.uploadingCount", { current: data.index, total: data.total }) : `UPLOADING ${data.index} / ${data.total}`)
                : (typeof t === "function" ? t("upload.uploading") : "UPLOADING");
            setDropZoneState("uploading", title, "Sending parcel…", data.percent || 0, data.filename);
        });

        window.runtime.EventsOn("upload-file-complete", (data) => {
            if (data && data.fileId) {
                fileOrderCounter++;
                if (data.sizeBytes) {
                    totalTransferredBytes += data.sizeBytes;
                    const transferredEl = document.getElementById("metric-transferred-size");
                    if (transferredEl) transferredEl.innerText = formatBytes(totalTransferredBytes);
                }
                roomFilesMap.set(data.fileId, {
                    fileId: data.fileId,
                    filename: data.filename,
                    sizeFormatted: data.sizeFormatted || "",
                    sizeBytes: data.sizeBytes || 0,
                    direction: "outbound",
                    saved: false,
                    order: fileOrderCounter,
                    timestamp: Date.now()
                });
                addRecentActivity("upload", data.filename, `Uploaded from Linux (${data.sizeFormatted || ""})`);
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
                if (data.sizeBytes) {
                    totalTransferredBytes += data.sizeBytes;
                    const transferredEl = document.getElementById("metric-transferred-size");
                    if (transferredEl) transferredEl.innerText = formatBytes(totalTransferredBytes);
                }
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
                registerParticipant("Mobile Participant", "LAN Peer");
                addRecentActivity("download", data.filename, `Received from peer (${data.sizeFormatted || ""})`);
                renderRoomFilesList();
            }
        });

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
// Update Banner Management
// --------------------------------------------------------------------------
let pendingUpdateInfo = null;

function refreshUpdateTexts() {
    if (!pendingUpdateInfo) return;
    const verText = document.getElementById("update-version-text");
    if (verText) {
        verText.innerText = typeof t === "function"
            ? t("update.available", { version: pendingUpdateInfo.latestVersion || "" })
            : `Version ${pendingUpdateInfo.latestVersion} is now available.`;
    }
}

function showUpdateBanner(info) {
    if (!info) return;
    pendingUpdateInfo = info;

    const banner = document.getElementById("update-banner");
    const verText = document.getElementById("update-version-text");
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

    if (progressBox) progressBox.classList.add("hidden");
    if (errorBox) errorBox.style.display = "none";
    if (actionsBox) actionsBox.classList.remove("hidden");
    if (nowBtn) {
        nowBtn.disabled = false;
        nowBtn.innerText = typeof t === "function" ? t("update.updateNow") : "Update Now";
    }
    if (laterBtn) laterBtn.disabled = false;
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

    if (window.go && window.go.main && window.go.main.App && typeof window.go.main.App.ApplyUpdate === "function") {
        window.go.main.App.ApplyUpdate(pendingUpdateInfo.assetUrl)
            .then(() => {
                window.dismissUpdateBanner();
            })
            .catch(() => {
                window.dismissUpdateBanner();
            });
    }
};
