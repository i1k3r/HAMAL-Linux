// HAMAL Linux desktop UI (Light Table): app lifecycle, home page, lamp, QR, close, About, theme,
// language and the update notice. The room itself (table, notes, viewer, toolbar, upload tray) is
// in room.js.
//
// The look follows the Light Table design of the main HAMAL repository. Everything that talks to
// Linux goes through Wails bindings and events: native open/save dialogs, native file drop, the
// in-process transfer backend, system theme and locale detection.

let currentStatus = "starting";
let expiresAtTimestamp = null;
let roomLifespanSeconds = 0;
let countdownInterval = null;
let currentRoomPin = "";
let currentPinRequired = false;
let currentParticipantUrl = "";
let closedByMe = false;

const TTL_OPTIONS = [300, 900, 1800, 3600, 21600, 43200, 86400];
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
// Dialogs
// --------------------------------------------------------------------------
function hideAllDialogs() {
    show($("modal-close-confirm"), false);
    show($("modal-about"), false);
    const qr = $("modal-qr");
    if (qr) qr.hidden = true;
}

// True while one of the dialogs above is open (room.js keeps its own dialogs).
window.mainDialogOpen = function () {
    const qr = $("modal-qr");
    const visible = (id) => {
        const el = $(id);
        return Boolean(el) && !el.classList.contains("hidden");
    };
    return Boolean(qr && !qr.hidden) || visible("modal-close-confirm") || visible("modal-about");
};

function announce(msg) {
    const live = $("live-polite");
    if (live) live.textContent = msg;
}

window.openFilePicker = function () {
    if (currentStatus !== "ready") return;
    const app = wailsApp();
    if (app) app.SelectAndUploadFiles();
};

window.closeRoom = function () {
    window.openCloseConfirmModal();
};

window.openCloseConfirmModal = function () {
    hideAllDialogs();
    const err = $("close-error");
    if (err) err.hidden = true;
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

    copyText(input.value).then((ok) => {
        if (!toast) return;
        toast.textContent = ok ? tr("lt.copied") : tr("room.copyAddressFailed");
        toast.classList.toggle("is-fail", !ok);
        if (!ok) input.select();
        toast.classList.add("show");
        setTimeout(() => toast.classList.remove("show"), 2500);
    });
};

// Copies text: the Wails clipboard first (the webview's own clipboard API needs a secure origin),
// then the browser's. Resolves true only when a copy was confirmed.
window.copyText = async function (text) {
    if (window.runtime && typeof window.runtime.ClipboardSetText === "function") {
        try {
            if (await window.runtime.ClipboardSetText(text)) return true;
        } catch (e) { /* fall through */ }
    }
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (e) { /* fall through */ }
    }
    try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand && document.execCommand("copy") === true;
        ta.remove();
        return ok;
    } catch (e) {
        return false;
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
    if (window.HamalRoom) window.HamalRoom.reset();
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
    const app = wailsApp();
    const btn = $("confirm-close-btn");
    const err = $("close-error");
    if (!app) return;
    if (btn) {
        btn.disabled = true;
        btn.textContent = tr("room.closing");
    }
    if (err) err.hidden = true;
    closedByMe = true;
    app.CloseRoom()
        .then((state) => {
            hideAllDialogs();
            renderState(state);
        })
        .catch((e) => {
            closedByMe = false;
            console.error("Failed to close room:", e);
            if (err) {
                err.textContent = tr("room.closeFailed");
                err.hidden = false;
            }
        })
        .finally(() => {
            if (btn) {
                btn.disabled = false;
                btn.textContent = tr("lt.closeRoom");
            }
        });
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

    // PINs are 4 to 8 digits, as in the HAMAL server and web client.
    if (pin.length > 0 && !/^[0-9]{4,8}$/.test(pin)) {
        pinError();
        return;
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

let currentRoomOpen = false;

function renderState(state) {
    const previous = currentStatus;
    currentStatus = state.status;
    currentRoomOpen = previous === "ready" || previous === "closing";

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
        if (window.HamalRoom) window.HamalRoom.enter();
    } else if (state.status === "closed" || state.status === "stopped") {
        const wasOpen = currentRoomOpen;
        stopCountdown();
        hideAllDialogs();
        const hadOpenUploads = window.HamalRoom ? window.HamalRoom.leave() : false;
        showView("view-closed");
        const title = $("inactive-title");
        if (title) {
            title.textContent = tr(closedByMe ? "lt.closedTitle" : "lt.endedTitle");
            if (wasOpen) title.focus();
        }
        const up = $("inactive-uploads");
        if (up) up.hidden = !hadOpenUploads;
        announce(title ? title.textContent : "");
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
    if (window.HamalRoom) window.HamalRoom.refreshTexts();
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

// The room's own snapshot can see the room end before the next state poll does.
window.roomEndedFromSnapshot = function () {
    if (currentStatus === "ready" || currentStatus === "closing") {
        renderState({ status: "closed" });
    }
};

// --------------------------------------------------------------------------
// Wails event subscriptions
// --------------------------------------------------------------------------
function initWailsListeners() {
    initTheme();
    initLanguage();
    initVersionDisplay();

    if (!window.runtime) return;

    if (typeof window.runtime.OnFileDrop === "function") {
        window.runtime.OnFileDrop(() => {}, false);
    }

    window.runtime.EventsOn("system-theme-changed", (theme) => {
        applySystemTheme(theme);
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
