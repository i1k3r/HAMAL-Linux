// HAMAL Linux: the room (the light table) on the desktop.
//
// A port of the HAMAL creator page script (internal/app/static/room.js at 6fad72e, the Docker
// reference) to the desktop app. Behaviour and markup follow the reference: files and notes in one
// timeline, newest first; search, kind filter and sort; Table and List views (List from 25 items);
// select files and save them together; image, video and audio previews and notes in a viewer with
// Previous, Next and Save; a note composer with an over-limit "send as .txt file"; pasted images;
// the upload tray with cancel, retry and remove; devices at the table, capacity and the room log;
// the room menu, keyboard shortcuts and share links when the server enables them.
//
// What differs, because this is a desktop app and not a web page:
//   - JSON comes from Go bindings (window.go.main.App), which call the embedded server's API.
//   - Saving uses the native save dialog (one file) or a folder picker (several files).
//   - Uploads go through the native upload queue (file picker, file drop, paste), reported by
//     "upload-update" events.
//   - All text is translated into the app's 20 languages (i18n-room.js).

(() => {
  const $ = (id) => document.getElementById(id);
  const app = () => (window.go && window.go.main && window.go.main.App ? window.go.main.App : null);
  const tr = (key, params) => (typeof t === "function" ? t(key, params) : key);
  const LOCALE = () => document.documentElement.lang || "en";

  // ---------------------------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------------------------
  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v === undefined || v === null || v === false) continue;
        if (k === "class") n.className = v;
        else if (k === "text") n.textContent = v;
        else if (k === "dataset") Object.assign(n.dataset, v);
        else n.setAttribute(k, v === true ? "" : String(v));
      }
    }
    if (children) for (const c of children) if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    return n;
  }
  function svg(markup) {
    const s = document.createElement("span");
    s.setAttribute("aria-hidden", "true");
    s.style.display = "inline-flex";
    s.innerHTML = markup; // static icon markup only, never user content
    return s;
  }
  const ICON_PLAY = '<svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"></path></svg>';
  const ICON_WARN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';

  function formatBytes(bytes) {
    if (!bytes) return "0 B";
    const k = 1024, sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
    const v = bytes / Math.pow(k, i);
    return (i === 0 ? String(bytes) : (v >= 100 ? v.toFixed(0) : parseFloat(v.toFixed(1)).toString())) + " " + sizes[i];
  }
  function clock(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return "";
    try {
      const hm = d.toLocaleTimeString(LOCALE(), { hour: "2-digit", minute: "2-digit" });
      if (d.toDateString() === new Date().toDateString()) return hm;
      return d.toLocaleDateString(LOCALE(), { month: "short", day: "numeric" }) + " " + hm;
    } catch (e) {
      return "";
    }
  }
  function announce(msg, assertive) {
    const r = $(assertive ? "live-assertive" : "live-polite");
    if (!r) return;
    r.textContent = "";
    setTimeout(() => { r.textContent = msg; }, 30);
  }
  const store = {
    get(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } },
    set(key, val) { try { window.localStorage.setItem(key, val); } catch (e) { /* ignore */ } },
  };
  const copyText = (text) => (typeof window.copyText === "function" ? window.copyText(text) : Promise.resolve(false));
  const errText = (e) => String((e && e.message) || e || "").replace(/^Error:\s*/, "");

  // ---------------------------------------------------------------------------------------------
  // Kinds (the reference lists)
  // ---------------------------------------------------------------------------------------------
  const EXT = {
    image: ["jpg", "jpeg", "png", "webp", "gif", "bmp", "tiff", "tif", "svg", "ico", "heic", "avif"],
    video: ["mp4", "mkv", "avi", "mov", "webm", "m4v", "wmv"],
    audio: ["mp3", "wav", "flac", "m4a", "aac", "ogg", "wma", "opus"],
    document: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf", "txt", "md", "csv", "json", "log", "xml", "yaml", "yml", "conf", "ini", "html", "htm"],
    archive: ["zip", "7z", "rar", "tar", "gz", "tgz", "bz2", "xz", "zst", "iso", "img", "dmg"],
  };
  const PREVIEW = {
    image: ["jpg", "jpeg", "png", "webp", "gif", "bmp", "tiff", "tif", "svg", "ico"],
    video: ["mp4", "mkv", "avi", "mov", "webm", "m4v", "wmv"],
    audio: ["mp3", "wav", "flac", "m4a", "aac", "ogg", "wma"],
  };
  const EXEC = ["exe", "msi", "com", "scr", "bat", "cmd", "ps1", "vbs", "sh", "jar", "apk", "aab", "appimage", "deb", "rpm"];
  const KIND_KEY = { image: "room.labelImage", video: "room.labelVideo", audio: "room.labelAudio", document: "room.labelDocument", archive: "room.labelArchive", other: "room.labelFile", note: "room.labelNote" };
  const kindLabel = (k) => tr(KIND_KEY[k] || "room.labelFile");
  const BIG_IMAGE = 25 * 1024 * 1024;

  function extOf(name) {
    const lower = (name || "").toLowerCase();
    for (const multi of ["tar.gz", "tar.bz2", "tar.xz", "tar.zst"]) if (lower.endsWith("." + multi)) return multi;
    const i = lower.lastIndexOf(".");
    return i > 0 && i < lower.length - 1 ? lower.slice(i + 1) : "";
  }
  function kindOf(name) {
    const last = extOf(name).split(".").pop();
    for (const k of ["image", "video", "audio", "document", "archive"]) if (EXT[k].includes(last)) return k;
    return "other";
  }
  function previewKind(name) {
    const ext = extOf(name);
    for (const k of ["image", "video", "audio"]) if (PREVIEW[k].includes(ext)) return k;
    return "";
  }
  const isExec = (name) => EXEC.includes(extOf(name));

  // ---------------------------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------------------------
  const state = {
    active: false,
    files: [],
    texts: [],
    participants: [],
    participantCount: 0,
    capacity: null,
    maxTextSize: 65536,
    mediaBase: "",
    shareEnabled: false,
    kind: "all",
    query: "",
    sort: "newest",
    view: "table",
    selected: new Set(),
    saved: new Map(), // fileId -> saved path
    saving: new Set(),
    saveErrors: new Map(),
    lastSnapshot: "",
    seenSeats: new Set(),
    seatsInitialised: false,
  };
  const mediaURL = (id) => state.mediaBase + encodeURIComponent(id);

  // ---------------------------------------------------------------------------------------------
  // Dialogs: viewer, shortcuts, share (QR, close confirm and About are in main.js)
  // ---------------------------------------------------------------------------------------------
  const modalStack = [];
  function openModal(node, opener, focusEl) {
    if (!node) return;
    if (node.classList.contains("lt-viewer")) node.classList.remove("hidden");
    node.hidden = false;
    modalStack.push({ node, opener: opener || document.activeElement });
    setTimeout(() => { (focusEl || node.querySelector("button, [href], input, select, textarea"))?.focus(); }, 0);
  }
  function closeModal(node, restoreTo) {
    const idx = modalStack.findIndex((m) => m.node === node);
    if (idx === -1) return;
    const [entry] = modalStack.splice(idx, 1);
    if (node.classList.contains("lt-viewer")) node.classList.add("hidden");
    else node.hidden = true;
    const target = restoreTo || entry.opener;
    if (target && document.contains(target) && typeof target.focus === "function") target.focus();
  }
  function closeAllModals() {
    while (modalStack.length) {
      const top = modalStack[modalStack.length - 1].node;
      if (top === viewer) closeViewer(); else closeModal(top, null);
    }
  }
  const anyDialogOpen = () => modalStack.length > 0 || (typeof window.mainDialogOpen === "function" && window.mainDialogOpen());

  // Escape and Tab for this file's dialogs run before main.js's window listener (capture phase).
  document.addEventListener("keydown", (e) => {
    if (!modalStack.length) return;
    const top = modalStack[modalStack.length - 1].node;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (top === viewer) closeViewer(); else closeModal(top);
      return;
    }
    if (e.key === "Tab") {
      const f = Array.from(top.querySelectorAll('button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select, textarea, video, audio, [tabindex]:not([tabindex="-1"])'))
        .filter((n) => n.offsetParent !== null || n === document.activeElement);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (!top.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    }
  }, true);

  // ---------------------------------------------------------------------------------------------
  // Timeline: files and notes together, newest first
  // ---------------------------------------------------------------------------------------------
  function timeline() {
    const items = [];
    state.files.forEach((f, i) => {
      items.push({
        ord: i, key: "f:" + f.fileId, type: "file", id: f.fileId, name: f.filename,
        size: f.sizeBytes || 0, at: f.createdAt, kind: kindOf(f.filename), preview: previewKind(f.filename), raw: f,
      });
    });
    state.texts.forEach((x, i) => {
      if (x.senderType === "server") return; // system messages go to the room log
      items.push({
        ord: i, key: "t:" + x.id, type: "note", id: x.id, name: (x.content || "").split("\n")[0].slice(0, 80),
        size: x.sizeBytes || 0, at: x.createdAt, kind: "note", raw: x,
      });
    });
    return items;
  }
  function norm(s) {
    try { return (s || "").normalize("NFC").toLocaleLowerCase(LOCALE()); } catch (e) { return (s || "").toLowerCase(); }
  }
  function visibleItems() {
    const q = norm(state.query.trim());
    const items = timeline().filter((it) => {
      if (state.kind !== "all" && it.kind !== state.kind) return false;
      if (!q) return true;
      return norm(it.type === "note" ? it.raw.content : it.name).includes(q);
    });
    // Timestamps have one-second resolution; within a second the server's own order decides.
    const byTime = (a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0) || (a.key[0] === b.key[0] ? b.ord - a.ord : (a.key < b.key ? 1 : -1));
    if (state.sort === "name") items.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }) || byTime(a, b));
    else if (state.sort === "size") items.sort((a, b) => b.size - a.size || byTime(a, b));
    else items.sort(byTime);
    return items;
  }

  // ---------------------------------------------------------------------------------------------
  // Item builders (Table view: prints, slips, index cards; List view: rows)
  // ---------------------------------------------------------------------------------------------
  function metaLine(it) {
    if (it.type === "note") return "";
    const parts = [`${kindLabel(it.kind)}, ${formatBytes(it.size)}`];
    const c = clock(it.at);
    if (c) parts.push(c);
    return parts.join(" · ");
  }

  function fileActions(it, compact) {
    const wrap = el("div", { class: "lt-actions" });
    if (isExec(it.name)) {
      const warnText = tr("files.executableWarning");
      const w = el("span", { class: "lt-warn-mark badge-exec-warning", tabindex: "0", role: "note", title: warnText, "aria-label": warnText });
      w.appendChild(svg(ICON_WARN));
      w.appendChild(document.createTextNode(compact ? "" : tr("room.check")));
      wrap.appendChild(w);
    }
    if (it.preview) {
      wrap.appendChild(el("button", { type: "button", class: "lt-ink-btn is-soft", dataset: { action: "view" }, "aria-label": tr("room.viewName", { name: it.name }), text: it.preview === "image" ? tr("room.view") : tr("room.play") }));
    }
    if (state.shareEnabled) {
      wrap.appendChild(el("button", { type: "button", class: "lt-ink-btn is-line btn-share-link", dataset: { action: "share" }, "aria-label": tr("room.shareFor", { name: it.name }), text: tr("room.shareLink") }));
    }
    if (it.raw.outbound) {
      wrap.appendChild(el("span", { class: "lt-sent", title: tr("lt.sent"), text: compact ? tr("lt.upSent") : tr("lt.sent") }));
      return wrap;
    }
    const saving = state.saving.has(it.id);
    const saved = state.saved.has(it.id);
    const failed = state.saveErrors.get(it.id);
    wrap.appendChild(el("button", {
      type: "button",
      class: "lt-ink-btn btn-download" + (saved ? " is-done" : ""),
      id: `btn-download-${it.id}`,
      dataset: { action: "save" },
      disabled: saving,
      "aria-label": tr("room.saveName", { name: it.name }),
      title: saved ? state.saved.get(it.id) : (failed || null),
      text: saving ? tr("lt.saving") : (failed ? tr("lt.retrySave") : (saved ? tr("room.saveAgain") : tr("lt.save"))),
    }));
    return wrap;
  }

  function nameBlock(it) {
    const kids = [
      el("h3", { class: "lt-item-name", title: it.name, dir: "auto", text: it.name }),
      el("span", { class: "lt-item-meta", text: metaLine(it) }),
    ];
    const failed = it.type === "file" && state.saveErrors.get(it.id);
    if (failed) kids.push(el("span", { class: "lt-save-error", role: "alert", text: failed }));
    return el("div", { class: "lt-item-names" }, kids);
  }

  function buildFileCard(it) {
    const li = el("li", { class: "lt-item file-row", dataset: { key: it.key, fileId: it.id, kind: it.kind } });
    const big = it.kind === "image" && it.size > BIG_IMAGE;
    if (it.kind === "image" && it.preview === "image" && !big) {
      const img = el("img", { src: mediaURL(it.id), alt: it.name, loading: "lazy", decoding: "async" });
      const media = el("button", { type: "button", class: "lt-print-media", dataset: { action: "view" }, "aria-hidden": "true", tabindex: "-1" }, [img]);
      // If the picture can't be loaded, show what it is instead of a broken-image icon.
      img.addEventListener("error", () => {
        media.classList.add("is-missing");
        media.replaceChildren(el("span", { class: "lt-slip-ext", text: extOf(it.name).toUpperCase() || "IMAGE" }), el("span", { class: "lt-missing-note", text: tr("room.previewUnavailable") }));
      }, { once: true });
      li.appendChild(el("article", { class: "lt-print" }, [media, el("div", { class: "lt-item-foot" }, [nameBlock(it), fileActions(it)])]));
    } else if (it.kind === "video") {
      const tile = el("button", { type: "button", class: "lt-print-media is-video", dataset: { action: it.preview ? "view" : "save" }, "aria-hidden": "true", tabindex: "-1" }, [svg(ICON_PLAY)]);
      li.appendChild(el("article", { class: "lt-print" }, [tile, el("div", { class: "lt-item-foot" }, [nameBlock(it), fileActions(it)])]));
    } else {
      const ext = extOf(it.name).toUpperCase() || kindLabel(it.kind);
      li.appendChild(el("article", { class: "lt-slip" + (it.kind === "audio" ? " is-audio" : "") }, [
        el("span", { class: "lt-slip-hole", "aria-hidden": "true" }),
        el("span", { class: "lt-slip-ext", "aria-hidden": "true", text: ext }),
        el("div", { class: "lt-item-foot" }, [nameBlock(it), fileActions(it)]),
      ]));
    }
    return li;
  }

  function noteContentNode(content) {
    const trimmed = content.trim();
    if (/^https?:\/\/\S+$/i.test(trimmed) && !/\s/.test(trimmed)) {
      const a = el("a", { href: trimmed, rel: "noopener noreferrer", text: trimmed });
      // Links open in the system browser, never inside the app window.
      a.addEventListener("click", (e) => {
        e.preventDefault();
        if (window.runtime && typeof window.runtime.BrowserOpenURL === "function") window.runtime.BrowserOpenURL(trimmed);
      });
      return a;
    }
    return document.createTextNode(content);
  }

  function noteWho(x) {
    if (x.senderType === "server") return "HAMAL";
    return x.isSelf ? tr("room.you") : tr("room.labelNote");
  }

  function buildNoteCard(it) {
    const x = it.raw;
    const isServer = x.senderType === "server";
    const content = x.content || "";
    const lines = content.split("\n").length;
    const strip = lines === 1 && content.length < 120;
    const li = el("li", {
      class: `lt-item text-item-card sender-${isServer ? "server" : "client"} ${isServer ? "sender-server" : (x.isSelf ? "client-self" : "client-peer")}`,
      dataset: { key: it.key, textId: x.id, kind: "note" },
    });
    const who = el("span", { class: "lt-card-who", title: formatBytes(it.size) }, [el("b", { text: noteWho(x) }), `, ${clock(x.createdAt)}`]);
    const head = el("div", { class: "lt-card-head" }, [who]);
    if (!isServer) {
      head.appendChild(el("button", { type: "button", class: "lt-ink-btn is-line btn-copy-text", dataset: { action: "copy" }, "aria-label": tr("room.copyNote", { time: clock(x.createdAt) }) }, [
        el("span", { class: "copy-label", text: tr("room.copy") }),
      ]));
      head.appendChild(el("div", { class: "lt-more-menu" }, [
        el("button", { type: "button", class: "lt-ink-btn is-soft", dataset: { action: "more" }, "aria-label": tr("room.moreNote", { time: clock(x.createdAt) }), "aria-expanded": "false", text: "⋯" }),
      ]));
    }
    const pre = el("pre", { class: "lt-card-body text-item-content", dir: "auto" }, [noteContentNode(content)]);
    const card = el("article", { class: "lt-card" + (strip ? " is-strip" : "") + (isServer ? " is-system" : "") }, [head, pre]);
    if (lines > 8 || content.length > 900) {
      card.appendChild(el("button", { type: "button", class: "lt-card-more", dataset: { action: "expand" }, text: tr("room.showAllLines", { count: lines.toLocaleString(LOCALE()) }) }));
    }
    li.appendChild(card);
    return li;
  }

  function buildRow(it) {
    const isNote = it.type === "note";
    const li = el("li", {
      class: "lt-item " + (isNote ? `text-item-card ${it.raw.senderType === "server" ? "sender-server" : (it.raw.isSelf ? "client-self" : "client-peer")}` : "file-row"),
      dataset: isNote ? { key: it.key, textId: it.id, kind: "note" } : { key: it.key, fileId: it.id, kind: it.kind },
    });
    const row = el("div", { class: "lt-row" });
    const sel = el("span", { class: "lt-row-sel" });
    if (!isNote) {
      const cb = el("input", { type: "checkbox", "aria-label": tr("room.selectName", { name: it.name }), dataset: { action: "select" } });
      cb.checked = state.selected.has(it.id);
      sel.appendChild(cb);
    }
    row.appendChild(sel);
    let thumb;
    if (it.kind === "image" && it.preview === "image" && it.size <= BIG_IMAGE) {
      thumb = el("img", { class: "lt-row-thumb", src: mediaURL(it.id), alt: "", loading: "lazy", decoding: "async" });
      const tag = el("span", { class: "lt-row-tag", "aria-hidden": "true", text: extOf(it.name).toUpperCase().slice(0, 6) });
      thumb.addEventListener("error", () => thumb.replaceWith(tag), { once: true });
    } else {
      thumb = el("span", { class: "lt-row-tag" + (isNote ? " is-note" : "") + (it.kind === "video" ? " is-video" : ""), "aria-hidden": "true", text: isNote ? "" : (extOf(it.name).toUpperCase().slice(0, 6) || "—") });
    }
    const nameCell = el("span", { class: "lt-row-name" }, [thumb]);
    if (isNote) nameCell.appendChild(el("span", { class: "lt-row-note text-item-content", dir: "auto", title: it.raw.content, text: it.raw.content }));
    else nameCell.appendChild(el("h3", { class: "lt-item-name", dir: "auto", text: it.name }));
    row.appendChild(nameCell);
    row.appendChild(el("span", { class: "lt-row-meta" }, [
      el("span", { class: "lt-row-cell", text: isNote ? noteWho(it.raw) : kindLabel(it.kind) }),
      el("span", { class: "lt-row-cell", text: formatBytes(it.size) }),
      el("span", { class: "lt-row-cell", text: clock(it.at) }),
    ]));
    if (isNote) {
      const acts = el("div", { class: "lt-actions" });
      if (it.raw.senderType !== "server") {
        acts.appendChild(el("button", { type: "button", class: "lt-ink-btn is-line btn-copy-text", dataset: { action: "copy" }, "aria-label": tr("room.copyNote", { time: clock(it.at) }) }, [el("span", { class: "copy-label", text: tr("room.copy") })]));
      }
      acts.appendChild(el("button", { type: "button", class: "lt-ink-btn is-soft", dataset: { action: "expand" }, "aria-label": tr("room.readNote", { time: clock(it.at) }), text: tr("room.read") }));
      row.appendChild(acts);
    } else {
      row.appendChild(fileActions(it, true));
    }
    li.appendChild(row);
    return li;
  }

  // ---------------------------------------------------------------------------------------------
  // Keyed rendering. A poll never rebuilds the list: unchanged items keep their DOM nodes (so focus,
  // images and scroll position survive), new items are inserted, gone items are removed.
  // ---------------------------------------------------------------------------------------------
  const list = $("file-list");
  const records = new Map(); // key -> { el, sig }
  let lastOrderSig = "";
  let textsVersion = 0; // bumps when the language changes, so every item is rebuilt

  function signature(it) {
    const base = [textsVersion, state.view, it.type, it.name, it.size, it.at, state.shareEnabled ? 1 : 0];
    if (it.type === "file") {
      base.push(it.raw.outbound ? 1 : 0, state.saved.has(it.id) ? 1 : 0, state.saving.has(it.id) ? 1 : 0, state.saveErrors.get(it.id) || "");
      base.push(state.view === "list" ? (state.selected.has(it.id) ? 1 : 0) : 0);
    } else {
      base.push(it.raw.content, it.raw.isSelf ? 1 : 0, it.raw.senderType);
    }
    return base.join("\u0001");
  }

  function cleanup(node) {
    node.querySelectorAll("video, audio").forEach((m) => { try { m.pause(); m.removeAttribute("src"); m.load(); } catch (e) { /* ignore */ } });
  }

  function render(opts) {
    if (!list) return;
    const userReorder = opts && opts.reorder;
    const items = visibleItems();
    const wantKeys = items.map((i) => i.key);
    const orderSig = wantKeys.join("|");
    const active = document.activeElement;
    const activeItem = active && list.contains(active) ? active.closest("[data-key]") : null;
    const activeKey = activeItem ? activeItem.dataset.key : null;
    const activeAction = active && active.dataset ? active.dataset.action : null;

    // Scroll anchor: keep what the reader looks at in place when new items land above it.
    const scroller = $("table-scroll");
    const atTop = !scroller || scroller.scrollTop <= 2;
    let anchor = null;
    if (!atTop && !userReorder) {
      const viewTop = scroller.getBoundingClientRect().top;
      for (const [key, rec] of records) {
        const r = rec.el.getBoundingClientRect();
        if (r.height > 0 && r.bottom > viewTop + 1 && (!anchor || r.top < anchor.top)) anchor = { key, top: r.top };
      }
    }

    const want = new Set(wantKeys);
    for (const [key, rec] of records) {
      if (!want.has(key)) {
        if (activeKey === key) {
          const next = rec.el.nextElementSibling || rec.el.previousElementSibling;
          (next ? (next.querySelector("button, a") || next) : $("table-heading"))?.focus();
        }
        cleanup(rec.el);
        rec.el.remove();
        records.delete(key);
      }
    }

    const isFirst = !list.dataset.rendered;
    for (const it of items) {
      const sig = signature(it);
      const rec = records.get(it.key);
      if (rec && rec.sig === sig) continue;
      const node = state.view === "list" ? buildRow(it) : (it.type === "note" ? buildNoteCard(it) : buildFileCard(it));
      if (!isFirst && !rec && !userReorder) node.classList.add("is-new");
      if (rec) {
        const hadFocus = rec.el.contains(document.activeElement);
        cleanup(rec.el);
        rec.el.replaceWith(node);
        if (hadFocus) (node.querySelector(`[data-action="${activeAction}"]`) || node.querySelector("button, a"))?.focus();
      }
      records.set(it.key, { el: node, sig });
    }

    if (userReorder || orderSig !== lastOrderSig) {
      let nextSibling = null;
      for (let i = items.length - 1; i >= 0; i--) {
        const node = records.get(items[i].key).el;
        const inPlace = node.parentNode === list && node.nextSibling === nextSibling;
        if (!inPlace && (userReorder || node.parentNode !== list)) list.insertBefore(node, nextSibling);
        nextSibling = node;
      }
      lastOrderSig = orderSig;
    }
    if (userReorder && activeKey && records.has(activeKey)) {
      const n = records.get(activeKey).el;
      (n.querySelector(`[data-action="${activeAction}"]`) || n.querySelector("button, a"))?.focus();
    }
    list.dataset.rendered = "1";
    if (anchor && records.has(anchor.key)) {
      const d = records.get(anchor.key).el.getBoundingClientRect().top - anchor.top;
      if (Math.abs(d) > 0.5) scroller.scrollTop += d;
    }

    const all = timeline();
    const total = all.length;
    $("table-empty") && ($("table-empty").hidden = total !== 0);
    $("no-match") && ($("no-match").hidden = !(total > 0 && items.length === 0));
    list.hidden = total === 0;
    const counts = { all: total, image: 0, video: 0, audio: 0, document: 0, archive: 0, note: 0, other: 0 };
    for (const it of all) counts[it.kind] = (counts[it.kind] || 0) + 1;
    for (const k of Object.keys(counts)) {
      const c = k === "note" ? $("text-count") : $("count-" + k);
      if (c) c.textContent = String(counts[k]);
    }
    const heading = $("table-heading");
    if (heading) heading.textContent = tr("room.tableHeading", { files: state.files.length, notes: all.length - state.files.length });
    updateListChrome();
    if (viewerKey) refreshViewerAfterPoll();
  }

  // ---------------------------------------------------------------------------------------------
  // Views: Table (default up to 24 items) and List
  // ---------------------------------------------------------------------------------------------
  let autoSwitchAnnounced = false;
  function storedView() {
    const v = store.get("hamal_view");
    return v === "table" || v === "list" ? v : null;
  }
  function autoView() {
    if (window.innerWidth < 640) return "list";
    return timeline().length > 24 ? "list" : "table";
  }
  function applyView(view, why) {
    if (view === state.view && list && list.dataset.view === view) return;
    state.view = view;
    if (list) {
      list.dataset.view = view;
      list.classList.toggle("is-list", view === "list");
      list.setAttribute("aria-label", view === "list" ? tr("room.listLabel") : tr("room.tableLabel"));
    }
    $("view-table")?.setAttribute("aria-pressed", String(view === "table"));
    $("view-list")?.setAttribute("aria-pressed", String(view === "list"));
    if (why === "auto-count" && !autoSwitchAnnounced) {
      autoSwitchAnnounced = true;
      announce(tr("room.autoList"));
    }
    render({ reorder: true });
  }
  function evaluateView(reason) {
    const s = storedView();
    const v = s || autoView();
    if (v !== state.view) applyView(v, !s && reason === "poll" ? "auto-count" : reason);
  }
  $("view-table")?.addEventListener("click", () => { store.set("hamal_view", "table"); applyView("table", "user"); });
  $("view-list")?.addEventListener("click", () => { store.set("hamal_view", "list"); applyView("list", "user"); });
  let lastNarrow = window.innerWidth < 640;
  window.addEventListener("resize", () => {
    const narrow = window.innerWidth < 640;
    if (narrow !== lastNarrow) { lastNarrow = narrow; if (!storedView()) evaluateView("resize"); }
  });

  function selectableFiles() {
    return visibleItems().filter((i) => i.type === "file" && !i.raw.outbound);
  }
  function updateListChrome() {
    const isList = state.view === "list" && timeline().length > 0;
    $("list-bar") && ($("list-bar").hidden = !isList);
    $("list-head") && ($("list-head").hidden = !isList || window.innerWidth < 760);
    const ids = new Set(state.files.map((f) => f.fileId));
    for (const id of Array.from(state.selected)) if (!ids.has(id)) state.selected.delete(id);
    const btn = $("save-selected-btn");
    if (btn && !btn.dataset.busy) {
      btn.textContent = tr("room.saveSelected", { count: state.selected.size });
      btn.disabled = state.selected.size === 0;
    }
    const all = $("select-all");
    if (all) {
      const vis = visibleItems().filter((i) => i.type === "file");
      const n = vis.filter((i) => state.selected.has(i.id)).length;
      all.checked = vis.length > 0 && n === vis.length;
      all.indeterminate = n > 0 && n < vis.length;
    }
  }
  $("select-all")?.addEventListener("change", (e) => {
    const vis = visibleItems().filter((i) => i.type === "file");
    if (e.target.checked) vis.forEach((i) => state.selected.add(i.id)); else vis.forEach((i) => state.selected.delete(i.id));
    render();
  });
  // Save selected: one folder for all of them (native folder picker), nothing overwritten.
  $("save-selected-btn")?.addEventListener("click", async () => {
    const a = app();
    const btn = $("save-selected-btn");
    const note = $("bulk-note");
    const ids = state.files.filter((f) => state.selected.has(f.fileId)).map((f) => f.fileId);
    if (!a || !ids.length) return;
    btn.dataset.busy = "1";
    btn.disabled = true;
    btn.textContent = tr("lt.saving");
    note.hidden = true;
    try {
      const res = await a.SaveSelectedFiles(ids);
      if (res.cancelled) return;
      if (res.error) {
        note.textContent = res.error;
        note.hidden = false;
        return;
      }
      const ok = (res.files || []).filter((f) => !f.error);
      const bad = (res.files || []).filter((f) => f.error);
      ok.forEach((f) => { state.saved.set(f.fileId, f.path); state.saveErrors.delete(f.fileId); });
      bad.forEach((f) => state.saveErrors.set(f.fileId, f.error));
      let msg = tr("room.savedToFolder", { count: ok.length, folder: res.folder || "" });
      if (bad.length) msg += " " + tr("room.notSavedCount", { count: bad.length });
      note.textContent = msg;
      note.hidden = false;
      if (ok.length) logActivity(tr("room.logSavedMany", { count: ok.length }));
      announce(msg, bad.length > 0);
    } catch (e) {
      note.textContent = errText(e);
      note.hidden = false;
    } finally {
      delete btn.dataset.busy;
      render();
    }
  });

  // Toolbar: search, kind chips (and their select on narrow windows), sort
  let searchTimer = null;
  $("search-input")?.addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.query = e.target.value; render({ reorder: true }); }, 120);
  });
  function setKind(kind) {
    state.kind = kind;
    document.querySelectorAll("#kind-chips .lt-chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.kind === kind)));
    if ($("kind-select")) $("kind-select").value = kind;
    render({ reorder: true });
  }
  $("kind-chips")?.addEventListener("click", (e) => { const c = e.target.closest(".lt-chip"); if (c) setKind(c.dataset.kind); });
  $("kind-select")?.addEventListener("change", (e) => setKind(e.target.value));
  $("sort-select")?.addEventListener("change", (e) => { state.sort = e.target.value; render({ reorder: true }); });

  // ---------------------------------------------------------------------------------------------
  // Saving files (native save dialog)
  // ---------------------------------------------------------------------------------------------
  async function saveFile(it) {
    const a = app();
    if (!a || !it || it.type !== "file" || state.saving.has(it.id)) return null;
    state.saving.add(it.id);
    state.saveErrors.delete(it.id);
    render();
    try {
      const res = await a.DownloadFile(it.id, it.name);
      if (res && res.success) {
        state.saved.set(it.id, res.savedPath || "");
        logActivity(tr("lt.logSaved", { name: it.name }));
        return res.savedPath || "";
      }
      if (res && res.errorMessage) state.saveErrors.set(it.id, res.errorMessage);
      return null;
    } catch (e) {
      state.saveErrors.set(it.id, errText(e));
      return null;
    } finally {
      state.saving.delete(it.id);
      render();
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Item actions (one delegated listener for the whole list)
  // ---------------------------------------------------------------------------------------------
  function itemByKey(key) { return timeline().find((i) => i.key === key); }
  let openMore = null;
  function closeMore() { if (openMore) { openMore.pop.remove(); openMore.btn.setAttribute("aria-expanded", "false"); openMore = null; } }
  document.addEventListener("click", (e) => { if (openMore && !openMore.pop.contains(e.target) && e.target !== openMore.btn) closeMore(); });

  async function copyNote(actionEl, host, content) {
    const ok = await copyText(content || "");
    const label = actionEl.querySelector(".copy-label");
    if (label) label.textContent = ok ? tr("lt.copied") : tr("room.copyFailedShort");
    actionEl.classList.toggle("is-done", ok);
    if (!ok) {
      const pre = host && host.querySelector(".text-item-content");
      if (pre) { const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
      announce(tr("room.copyFailed"), true);
    }
    setTimeout(() => { if (label) label.textContent = tr("room.copy"); actionEl.classList.remove("is-done"); }, 2000);
  }

  async function saveNote(content) {
    const a = app();
    if (!a) return;
    try {
      const res = await a.SaveNote(content || "");
      if (res && res.success) logActivity(tr("room.logNoteSaved"));
      else if (res && res.errorMessage) announce(res.errorMessage, true);
    } catch (e) {
      announce(errText(e), true);
    }
  }

  if (list) {
    list.addEventListener("click", async (e) => {
      const actionEl = e.target.closest("[data-action]");
      if (!actionEl || !list.contains(actionEl)) return;
      const host = actionEl.closest("[data-key]");
      const it = host ? itemByKey(host.dataset.key) : null;
      if (!it) return;
      const action = actionEl.dataset.action;
      if (action === "view" || action === "expand") {
        closeMore();
        openViewer(it.key, actionEl);
      } else if (action === "save") {
        if (!it.raw.outbound) saveFile(it);
      } else if (action === "share") {
        openShare(it.id, it.name, actionEl);
      } else if (action === "copy") {
        copyNote(actionEl, host, it.raw.content);
      } else if (action === "save-note") {
        closeMore();
        saveNote(it.raw.content);
      } else if (action === "more") {
        if (openMore && openMore.btn === actionEl) { closeMore(); return; }
        closeMore();
        const pop = el("div", { class: "lt-more-pop", role: "menu" }, [
          el("button", { type: "button", role: "menuitem", dataset: { action: "expand" }, text: tr("room.readFull") }),
          el("button", { type: "button", role: "menuitem", dataset: { action: "save-note" }, text: tr("room.saveTxt") }),
        ]);
        actionEl.parentNode.appendChild(pop);
        actionEl.setAttribute("aria-expanded", "true");
        openMore = { pop, btn: actionEl };
        pop.querySelector("button").focus();
      } else if (action === "select") {
        if (actionEl.checked) state.selected.add(it.id); else state.selected.delete(it.id);
        updateListChrome();
      }
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Viewer: steps through the viewable items of the current filter and sort
  // ---------------------------------------------------------------------------------------------
  const viewer = $("file-preview-overlay");
  const vBody = $("preview-body");
  const vTitle = $("preview-filename");
  let viewerKey = null;
  let viewerOpener = null;

  function viewable() { return visibleItems().filter((i) => i.type === "note" || i.preview); }
  function stopMedia() {
    if (!vBody) return;
    vBody.querySelectorAll("video, audio").forEach((m) => { try { m.pause(); m.removeAttribute("src"); m.load(); } catch (e) { /* ignore */ } });
  }
  function setViewerSaveLabel(it) {
    const b = $("viewer-save");
    if (!b) return;
    if (it.type === "note") b.textContent = tr("room.copy");
    else if (it.raw.outbound) b.textContent = tr("lt.upSent");
    else b.textContent = state.saving.has(it.id) ? tr("lt.saving") : (state.saved.has(it.id) ? tr("room.saveAgain") : tr("lt.save"));
    b.disabled = (it.type === "file" && (it.raw.outbound || state.saving.has(it.id)));
  }
  function showInViewer(key) {
    const seq = viewable();
    const idx = seq.findIndex((i) => i.key === key);
    const it = idx >= 0 ? seq[idx] : null;
    stopMedia();
    vBody.replaceChildren();
    $("viewer-note").textContent = "";
    viewerKey = key;
    if (!it) { showGone(); return; }
    vTitle.textContent = it.type === "note" ? tr("room.noteTitle", { time: clock(it.at) }) : it.name;
    $("viewer-count").textContent = tr("room.viewerCount", { n: idx + 1, total: seq.length });
    if (it.type === "note") {
      vBody.appendChild(el("pre", { dir: "auto", tabindex: "0" }, [noteContentNode(it.raw.content || "")]));
    } else if (it.preview === "image") {
      vBody.appendChild(el("img", { src: mediaURL(it.id), alt: it.name }));
      const next = seq[idx + 1];
      if (next && next.preview === "image") { const pre = new Image(); pre.src = mediaURL(next.id); }
    } else if (it.preview === "video") {
      vBody.appendChild(el("video", { src: mediaURL(it.id), controls: true, preload: "metadata", playsinline: true }));
    } else if (it.preview === "audio") {
      const ext = extOf(it.name).toUpperCase();
      vBody.appendChild(el("div", { class: "lt-viewer-audio" }, [
        el("div", { class: "lt-slip is-audio" }, [el("span", { class: "lt-slip-hole", "aria-hidden": "true" }), el("span", { class: "lt-slip-ext", text: ext }), el("span", { class: "lt-item-name", text: it.name })]),
        el("audio", { src: mediaURL(it.id), controls: true, preload: "metadata" }),
      ]));
    }
    $("viewer-prev").disabled = idx <= 0;
    $("viewer-next").disabled = idx >= seq.length - 1;
    setViewerSaveLabel(it);
  }
  function showGone() {
    stopMedia();
    vBody.replaceChildren(el("p", { class: "lt-viewer-gone", text: tr("room.gone") }));
    $("viewer-save").disabled = true;
    $("viewer-count").textContent = tr("room.onTable", { count: viewable().length });
  }
  function openViewer(key, opener) {
    viewerOpener = opener || document.activeElement;
    showInViewer(key);
    openModal(viewer, viewerOpener, $("preview-close-btn"));
  }
  function closeViewer() {
    stopMedia();
    vBody.replaceChildren();
    const key = viewerKey;
    viewerKey = null;
    const rec = key && records.get(key);
    const back = rec ? (rec.el.querySelector('[data-action="view"]:not([tabindex="-1"])') || rec.el.querySelector('[data-action="expand"]') || rec.el.querySelector('button:not([tabindex="-1"]), a')) : null;
    closeModal(viewer, back || viewerOpener);
    if (back) back.scrollIntoView({ block: "nearest" });
  }
  function step(d) {
    const seq = viewable();
    const idx = seq.findIndex((i) => i.key === viewerKey);
    const n = seq[idx + d];
    if (n) showInViewer(n.key);
  }
  function refreshViewerAfterPoll() {
    if (!viewerKey) return;
    const seq = viewable();
    const idx = seq.findIndex((i) => i.key === viewerKey);
    if (idx === -1) { if (!vBody.querySelector(".lt-viewer-gone")) showGone(); return; }
    // Keep the media element (and playback); only the position and buttons update.
    $("viewer-count").textContent = tr("room.viewerCount", { n: idx + 1, total: seq.length });
    $("viewer-prev").disabled = idx <= 0;
    $("viewer-next").disabled = idx >= seq.length - 1;
    setViewerSaveLabel(seq[idx]);
  }
  async function viewerSave() {
    const it = viewerKey && itemByKey(viewerKey);
    if (!it) return;
    const note = $("viewer-note");
    if (it.type === "note") {
      const ok = await copyText(it.raw.content || "");
      note.textContent = ok ? tr("lt.copied") : tr("room.copyFailed");
      if (!ok) { const pre = vBody.querySelector("pre"); if (pre) { const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } }
      return;
    }
    if (it.raw.outbound) return;
    const p = await saveFile(it);
    if (viewerKey !== it.key) return;
    if (p !== null) note.textContent = tr("room.savedTo", { path: p });
    else if (state.saveErrors.get(it.id)) note.textContent = state.saveErrors.get(it.id);
    setViewerSaveLabel(it);
  }
  if (viewer) {
    $("preview-close-btn")?.addEventListener("click", closeViewer);
    $("viewer-prev")?.addEventListener("click", () => step(-1));
    $("viewer-next")?.addEventListener("click", () => step(1));
    $("viewer-save")?.addEventListener("click", () => viewerSave());
    // Backdrop: a click on the dark surround (not on the media, title or buttons) closes.
    viewer.addEventListener("click", (e) => {
      const x = e.target;
      if (x === viewer || x === vBody || x.classList.contains("lt-viewer-head") || x.classList.contains("lt-viewer-foot") || x.classList.contains("lt-viewer-audio")) closeViewer();
    });
    viewer.addEventListener("keydown", (e) => {
      if (e.target.closest && e.target.closest("video, audio")) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); step(document.dir === "rtl" ? 1 : -1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); step(document.dir === "rtl" ? -1 : 1); }
      else if ((e.key === "s" || e.key === "S") && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); viewerSave(); }
    });
    let sx = null, sy = null;
    vBody.addEventListener("pointerdown", (e) => { if (e.target.closest("video, audio")) { sx = null; return; } sx = e.clientX; sy = e.clientY; });
    vBody.addEventListener("pointerup", (e) => {
      if (sx === null) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      sx = null;
      if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1);
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Upload tray (the native queue reports every change as an "upload-update" event)
  // ---------------------------------------------------------------------------------------------
  const uploads = new Map(); // id -> item
  const tray = $("upload-tray");
  const trayList = $("tray-list");
  const trayRecords = new Map();
  let trayCollapseTimer = null;

  function upStatusText(item) {
    switch (item.state) {
      case "queued": return tr("room.upQueued");
      case "sending": {
        let s = tr("room.upSending", { percent: Math.min(100, item.percent || 0) });
        if (item.bytesPerSec > 0 && item.sizeBytes) {
          const left = (item.sizeBytes * (1 - (item.percent || 0) / 100)) / item.bytesPerSec;
          s += " · " + tr("room.upSpeed", { speed: formatBytes(item.bytesPerSec), sec: Math.max(0, Math.ceil(left)) });
        }
        return s;
      }
      case "failed": return tr("room.upFailed", { error: item.error || "" });
      case "sent": return tr("lt.upSent");
      case "ended": return tr("room.upEnded");
      default: return "";
    }
  }
  function setTrayCollapsed(collapsed) {
    if (!tray) return;
    tray.classList.toggle("is-collapsed", collapsed);
    $("tray-toggle").textContent = collapsed ? tr("room.trayShow") : tr("room.trayHide");
    $("tray-toggle").setAttribute("aria-expanded", String(!collapsed));
  }
  $("tray-toggle")?.addEventListener("click", () => setTrayCollapsed(!tray.classList.contains("is-collapsed")));

  function renderTray() {
    if (!tray) return;
    const items = Array.from(uploads.values());
    tray.hidden = items.length === 0;
    const n = items.length;
    const sent = items.filter((i) => i.state === "sent").length;
    const failed = items.filter((i) => i.state === "failed").length;
    const ended = items.filter((i) => i.state === "ended").length;
    const open = items.filter((i) => i.state === "queued" || i.state === "sending").length;
    let summary;
    if (open) summary = tr("lt.traySending", { current: Math.min(n, sent + 1), total: n });
    else if (failed || ended) summary = tr("room.traySentOf", { sent, total: n });
    else summary = tr("room.trayAllSent", { total: n });
    if (failed) summary += " · " + tr("room.trayNotSent", { count: failed });
    if (ended) summary += " · " + tr("room.trayStopped", { count: ended });
    $("tray-summary").textContent = summary;

    for (const [id, rec] of trayRecords) if (!uploads.has(id)) { rec.el.remove(); trayRecords.delete(id); }
    let prev = null;
    for (const item of items) {
      let rec = trayRecords.get(item.id);
      if (!rec) {
        const li = el("li", { class: "lt-up", dataset: { id: item.id } }, [
          el("span", { class: "lt-up-name", text: item.name }),
          el("span", { class: "lt-up-status" }),
          el("div", { class: "lt-actions" }),
          el("span", { class: "lt-up-bar", "aria-hidden": "true" }),
        ]);
        rec = { el: li, state: "", lang: "" };
        trayRecords.set(item.id, rec);
      }
      const li = rec.el;
      li.className = "lt-up is-" + item.state;
      li.querySelector(".lt-up-status").textContent = upStatusText(item);
      li.querySelector(".lt-up-bar").style.width = item.state === "sending" ? `${item.percent || 0}%` : (item.state === "sent" ? "100%" : "0");
      if (rec.state !== item.state || rec.lang !== LOCALE()) {
        rec.state = item.state;
        rec.lang = LOCALE();
        const acts = li.querySelector(".lt-actions");
        acts.replaceChildren();
        if (item.state === "failed") {
          acts.appendChild(el("button", { type: "button", class: "lt-ink-btn", dataset: { up: "retry" }, "aria-label": tr("room.retryName", { name: item.name }), text: tr("room.retry") }));
          acts.appendChild(el("button", { type: "button", class: "lt-ink-btn is-soft", dataset: { up: "remove" }, "aria-label": tr("room.removeName", { name: item.name }), text: tr("room.remove") }));
        } else if (item.state === "ended") {
          acts.appendChild(el("button", { type: "button", class: "lt-ink-btn is-soft", dataset: { up: "remove" }, "aria-label": tr("room.removeName", { name: item.name }), text: tr("room.remove") }));
        } else if (item.state === "queued" || item.state === "sending") {
          acts.appendChild(el("button", { type: "button", class: "lt-ink-btn is-line", dataset: { up: "cancel" }, "aria-label": tr("room.cancelName", { name: item.name }), text: tr("lt.cancel") }));
        }
      }
      if (li.previousElementSibling !== prev || li.parentNode !== trayList) {
        trayList.insertBefore(li, prev ? prev.nextSibling : trayList.firstChild);
      }
      prev = li;
    }
    // Collapse to the summary 5 s after everything was sent.
    clearTimeout(trayCollapseTimer);
    if (n && !open && !failed && !ended) trayCollapseTimer = setTimeout(() => setTrayCollapsed(true), 5000);
  }
  trayList?.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-up]");
    const a = app();
    if (!b || !a) return;
    const id = b.closest("[data-id]").dataset.id;
    b.disabled = true;
    try {
      if (b.dataset.up === "cancel") await a.CancelUpload(id);
      else if (b.dataset.up === "remove") await a.RemoveUpload(id);
      else if (b.dataset.up === "retry") await a.RetryUpload(id);
    } finally {
      b.disabled = false;
    }
  });
  function onUploadUpdate(item) {
    if (!item || !item.id) return;
    const prev = uploads.get(item.id);
    if (item.state === "removed") uploads.delete(item.id);
    else uploads.set(item.id, item);
    if (!prev && item.state !== "removed") setTrayCollapsed(false);
    if (prev && prev.state !== item.state) {
      if (item.state === "sent") { announce(tr("room.upSentName", { name: item.name })); pollSoon(); }
      if (item.state === "failed") announce(tr("room.upFailedName", { name: item.name, error: item.error || "" }), true);
    }
    renderTray();
  }

  // Clipboard image paste: Ctrl+V anywhere on the table turns a copied image into an upload.
  // Pastes into text fields are left alone, so text pastes normally.
  document.addEventListener("paste", (e) => {
    if (!state.active) return;
    const tag = e.target && e.target.tagName ? e.target.tagName.toUpperCase() : "";
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    const images = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const ext = (item.type.split("/")[1] || "png").replace(/[^a-z0-9+.-]/gi, "").toLowerCase() || "png";
        const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const blob = item.getAsFile();
        if (blob) images.push({ blob, name: `pasted-image-${ts}.${ext}` });
      }
    }
    if (!images.length) return;
    e.preventDefault();
    for (const im of images) {
      const reader = new FileReader();
      reader.onload = () => {
        const data = String(reader.result || "");
        const b64 = data.slice(data.indexOf(",") + 1);
        const a = app();
        if (!a) return;
        a.UploadPastedImage(im.name, b64).catch((err) => announce(tr("room.pasteFailed", { error: errText(err) }), true));
      };
      reader.onerror = () => announce(tr("room.pasteFailed", { error: String(reader.error || "") }), true);
      reader.readAsDataURL(im.blob);
    }
  });

  // ---------------------------------------------------------------------------------------------
  // Composer
  // ---------------------------------------------------------------------------------------------
  const composer = $("composer");
  const textInput = $("text-input");
  const sendBtn = $("send-text-btn");
  const counter = $("text-size-counter");
  const composeErr = $("text-compose-error");
  const overlimit = $("text-overlimit");
  const isNarrow = () => window.innerWidth < 760;
  function openComposer() {
    if (!composer || !state.active) return;
    composer.hidden = false;
    $("write-note-btn")?.setAttribute("aria-expanded", "true");
    if (isNarrow()) $("composer-backdrop").hidden = false;
    textInput?.focus();
  }
  function closeComposer(keepFocus) {
    if (!composer) return;
    composer.hidden = true;
    $("composer-backdrop").hidden = true;
    $("write-note-btn")?.setAttribute("aria-expanded", "false");
    if (!keepFocus) $("write-note-btn")?.focus();
  }
  $("write-note-btn")?.addEventListener("click", () => (composer.hidden ? openComposer() : closeComposer()));
  $("composer-cancel")?.addEventListener("click", () => closeComposer());
  $("composer-backdrop")?.addEventListener("click", () => closeComposer());
  composer?.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modalStack.length) { e.preventDefault(); e.stopPropagation(); closeComposer(); } });

  const bytesOf = (s) => new TextEncoder().encode(s).length;
  function updateCounter() {
    if (!textInput || !counter) return;
    const b = bytesOf(textInput.value);
    counter.textContent = tr("room.counter", { size: formatBytes(b), max: formatBytes(state.maxTextSize) });
    const over = b > state.maxTextSize;
    counter.classList.toggle("is-over", over);
    if (overlimit) {
      overlimit.hidden = !over;
      if (over) $("text-overlimit-msg").textContent = tr("room.overLimit", { size: formatBytes(b), max: formatBytes(state.maxTextSize) });
    }
    if (sendBtn && !sendBtn.dataset.sending) sendBtn.disabled = over || !state.active;
  }
  function composeError(msg) { composeErr.textContent = msg; composeErr.hidden = false; }
  async function submitNote() {
    const a = app();
    if (!textInput || !state.active || !a) return;
    const content = textInput.value; // sent exactly as typed: indentation and newlines are content
    if (!content.trim()) return;
    if (bytesOf(content) > state.maxTextSize) { composeError(tr("room.tooLarge")); return; }
    sendBtn.disabled = true;
    sendBtn.dataset.sending = "1";
    $("send-text-label").textContent = tr("room.sending");
    composeErr.hidden = true;
    try {
      await a.SendNote(content);
      textInput.value = "";
      updateCounter();
      logActivity(tr("room.logWrote"));
      await poll();
      const mine = state.texts.filter((x) => x.isSelf).pop();
      const rec = mine && records.get("t:" + mine.id);
      if (rec) rec.el.scrollIntoView({ block: "nearest" });
    } catch (e) {
      composeError(tr("room.noteFailed", { error: errText(e) }));
    } finally {
      delete sendBtn.dataset.sending;
      $("send-text-label").textContent = tr("room.sendNote");
      updateCounter();
    }
  }
  if (textInput) {
    textInput.addEventListener("input", () => { updateCounter(); composeErr.hidden = true; });
    textInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey || !e.shiftKey) && !e.isComposing) { e.preventDefault(); submitNote(); }
    });
  }
  sendBtn?.addEventListener("click", submitNote);
  $("send-as-file-btn")?.addEventListener("click", async () => {
    const a = app();
    if (!a || !textInput.value) return;
    try {
      await a.SendNoteAsFile(textInput.value);
      textInput.value = "";
      updateCounter();
    } catch (e) {
      composeError(tr("room.noteFailed", { error: errText(e) }));
    }
  });

  // ---------------------------------------------------------------------------------------------
  // Devices at the table, capacity and the room log
  // ---------------------------------------------------------------------------------------------
  const activities = []; // this computer's own events: { at, text }
  let logClearedAt = 0;
  function logActivity(text) {
    activities.unshift({ at: Date.now(), text });
    if (activities.length > 20) activities.pop();
    renderLog();
  }
  function serverLogText(x) {
    const c = (x.content || "").trim();
    let m;
    if (/^room created\b/i.test(c)) return tr("lt.logOpened");
    if ((m = /^file uploaded:\s*(.+)$/i.exec(c))) return tr("lt.logLaid", { name: m[1] });
    if (/^room closed\b/i.test(c)) return tr("room.logClosed");
    return c;
  }
  function renderLog(force) {
    const ol = $("activity-list");
    if (!ol) return;
    const server = state.texts.filter((x) => x.senderType === "server").map((x) => ({ at: Date.parse(x.createdAt) || 0, text: serverLogText(x) }));
    const all = server.concat(activities).filter((a) => a.at > logClearedAt).sort((x, y) => y.at - x.at).slice(0, 8);
    const sig = LOCALE() + all.map((a) => a.at + a.text).join("|");
    if (!force && ol.dataset.sig === sig) return;
    ol.dataset.sig = sig;
    ol.replaceChildren(...(all.length ? all.map((a) => el("li", { text: `${a.text}, ${clock(new Date(a.at).toISOString())}` })) : [el("li", { text: tr("lt.logEmpty") })]));
    if ($("btn-clear-activity")) $("btn-clear-activity").hidden = all.length === 0;
  }
  $("btn-clear-activity")?.addEventListener("click", () => { activities.length = 0; logClearedAt = Date.now(); renderLog(true); });

  // Device names come from the user agent ("Apple iOS", "Android Device", "Windows Device"…).
  function seatName(n) {
    const s = (n || "").replace(/ Device$/i, "");
    if (/ios|iphone/i.test(s)) return tr("room.seatIphone");
    if (/ipad/i.test(s)) return tr("room.seatIpad");
    if (/android/i.test(s)) return tr("room.seatAndroid");
    if (/mac/i.test(s)) return tr("room.seatMac");
    if (/windows/i.test(s)) return tr("room.seatWindows");
    if (/linux/i.test(s)) return tr("room.seatLinux");
    return s || tr("lt.device");
  }
  function renderSeats(force) {
    const ul = $("participant-list");
    const names = [];
    const seen = {};
    for (const p of state.participants || []) {
      const base = seatName(p.name);
      seen[base] = (seen[base] || 0) + 1;
      names.push({ id: p.id || base, label: seen[base] > 1 ? `${base} ${seen[base]}` : base });
    }
    if (ul) {
      const sig = names.map((x) => x.label).join("|");
      if (force || ul.dataset.sig !== sig) {
        ul.dataset.sig = sig;
        ul.replaceChildren(...names.map((x) => el("li", { class: "lt-seat", text: x.label })));
      }
    }
    const n = typeof state.participantCount === "number" ? state.participantCount : names.length;
    if ($("participant-count")) $("participant-count").textContent = String(n);
    if ($("qr-seats")) $("qr-seats").textContent = n === 0 ? tr("room.seatsNone") : (n === 1 ? tr("room.seatsOne") : tr("room.seatsMany", { count: n }));
    for (const x of names) {
      if (!state.seenSeats.has(x.id)) {
        state.seenSeats.add(x.id);
        if (state.seatsInitialised) logActivity(tr("room.logSat", { name: x.label }));
      }
    }
    state.seatsInitialised = true;
  }
  function renderCapacity() {
    const cap = $("capacity");
    const c = state.capacity;
    if (!cap) return;
    if (!c) { cap.textContent = ""; return; }
    const parts = [];
    if (c.maxRoomSize) parts.push(tr("room.capacitySize", { used: formatBytes(c.totalSizeBytes || 0), max: formatBytes(c.maxRoomSize) }));
    if (c.maxFiles) parts.push(tr("room.capacityFiles", { count: c.fileCount || 0, max: c.maxFiles }));
    cap.textContent = parts.join(" · ");
  }

  // ---------------------------------------------------------------------------------------------
  // Polling
  // ---------------------------------------------------------------------------------------------
  let pollTimer = null;
  let polling = false;
  async function poll() {
    const a = app();
    if (!state.active || !a || polling) return;
    polling = true;
    try {
      const snap = await a.GetRoomSnapshot();
      if (!state.active) return;
      if (snap.status === "closed" || snap.status === "expired" || snap.status === "gone") {
        if (typeof window.roomEndedFromSnapshot === "function") window.roomEndedFromSnapshot();
        return;
      }
      state.participants = snap.participants || [];
      state.participantCount = snap.participantCount || 0;
      renderSeats();
      state.capacity = { totalSizeBytes: snap.totalSizeBytes, maxRoomSize: snap.maxRoomSize, fileCount: snap.fileCount, maxFiles: snap.maxFiles };
      renderCapacity();
      if (snap.maxTextSize && snap.maxTextSize !== state.maxTextSize) { state.maxTextSize = snap.maxTextSize; updateCounter(); }
      state.mediaBase = snap.mediaBaseUrl || state.mediaBase;
      const sig = JSON.stringify([snap.files, snap.texts, snap.shareEnabled]);
      if (sig !== state.lastSnapshot) {
        state.lastSnapshot = sig;
        state.files = snap.files || [];
        state.texts = snap.texts || [];
        state.shareEnabled = Boolean(snap.shareEnabled);
        evaluateView("poll");
        render();
        renderLog();
      }
    } catch (e) {
      // A missed poll is retried on the next cycle.
      console.debug("room poll failed", e);
    } finally {
      polling = false;
    }
  }
  function schedule() {
    clearTimeout(pollTimer);
    if (!state.active) return;
    pollTimer = setTimeout(async () => { await poll(); schedule(); }, document.hidden ? 8000 : 2000);
  }
  function pollSoon() { if (state.active) setTimeout(poll, 150); }

  // ---------------------------------------------------------------------------------------------
  // Share links (only when the server enables global sharing)
  // ---------------------------------------------------------------------------------------------
  const shareDlg = $("share-modal");
  let currentShareId = "";
  function openShare(fileId, filename, opener) {
    if (!shareDlg || !state.shareEnabled) return;
    currentShareId = "";
    $("modal-file-id").value = fileId;
    $("modal-file-subtitle").textContent = tr("room.shareText", { name: filename });
    $("share-result-box").hidden = true;
    $("share-error-box").hidden = true;
    $("copy-share-toast").textContent = "";
    $("generate-share-btn").classList.replace("lt-btn-quiet", "lt-btn-primary");
    openModal(shareDlg, opener, $("share-ttl-select"));
  }
  function shareError(msg) { $("share-error-box").textContent = msg; $("share-error-box").hidden = false; }
  $("close-modal-btn")?.addEventListener("click", () => closeModal(shareDlg));
  $("create-share-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const a = app();
    const btn = $("generate-share-btn");
    if (!a) return;
    btn.disabled = true;
    $("share-error-box").hidden = true;
    try {
      const s = await a.CreateShareLink($("modal-file-id").value, parseInt($("share-ttl-select").value, 10) || 3600);
      currentShareId = s.shareId;
      $("generated-share-input").value = s.shareUrl;
      $("share-result-box").hidden = false;
      $("revoke-share-btn").disabled = false;
      btn.classList.replace("lt-btn-primary", "lt-btn-quiet");
      $("copy-share-btn").focus();
    } catch (err) {
      shareError(errText(err) || tr("room.shareFailed"));
    } finally {
      btn.disabled = false;
    }
  });
  $("copy-share-btn")?.addEventListener("click", async () => {
    const input = $("generated-share-input");
    const ok = await copyText(input.value);
    $("copy-share-toast").textContent = ok ? tr("room.linkCopied") : tr("room.copyLinkFailed");
    if (!ok) input.select();
  });
  $("revoke-share-btn")?.addEventListener("click", async () => {
    const a = app();
    if (!a || !currentShareId) return;
    $("revoke-share-btn").disabled = true;
    try {
      await a.RevokeShareLink(currentShareId);
      $("copy-share-toast").textContent = tr("room.linkRevoked");
      $("generated-share-input").value = "";
      currentShareId = "";
    } catch (err) {
      $("revoke-share-btn").disabled = false;
      shareError(errText(err));
    }
  });

  // ---------------------------------------------------------------------------------------------
  // Room menu and keyboard shortcuts
  // ---------------------------------------------------------------------------------------------
  const menu = $("room-menu");
  const menuBtn = $("room-menu-btn");
  function closeMenu() { if (menu && !menu.hidden) { menu.hidden = true; menuBtn.setAttribute("aria-expanded", "false"); } }
  menuBtn?.addEventListener("click", () => {
    const open = menu.hidden;
    menu.hidden = !open;
    menuBtn.setAttribute("aria-expanded", String(open));
    if (open) menu.querySelector("button")?.focus();
  });
  document.addEventListener("click", (e) => {
    if (menu && !menu.hidden && !menu.contains(e.target) && !menuBtn.contains(e.target)) closeMenu();
  });
  menu?.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeMenu(); menuBtn.focus(); } });
  const shortcuts = $("shortcuts-dialog");
  menu?.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-menu]");
    if (!b) return;
    closeMenu();
    const what = b.dataset.menu;
    if (what === "qr") window.openQRLightbox && window.openQRLightbox();
    else if (what === "copy") {
      const ok = await copyText(($("participant-link-input") || {}).value || "");
      announce(ok ? tr("room.addressCopied") : tr("room.copyAddressFailed"), !ok);
    } else if (what === "theme") {
      const light = document.documentElement.getAttribute("data-theme") === "light";
      window.setUserTheme && window.setUserTheme(light ? "dark" : "light");
    } else if (what === "shortcuts") openModal(shortcuts, menuBtn, $("shortcuts-close"));
    else if (what === "about") window.openAboutModal && window.openAboutModal();
    else if (what === "close") window.closeRoom && window.closeRoom();
  });
  $("shortcuts-close")?.addEventListener("click", () => closeModal(shortcuts));

  document.addEventListener("keydown", (e) => {
    if (!state.active || e.ctrlKey || e.metaKey || e.altKey || anyDialogOpen()) return;
    const tag = ((e.target && e.target.tagName) || "").toUpperCase();
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target && e.target.isContentEditable)) return;
    if (e.key === "q" || e.key === "Q") { e.preventDefault(); window.openQRLightbox && window.openQRLightbox(); }
    else if (e.key === "/") { e.preventDefault(); $("search-input")?.focus(); }
    else if (e.key === "n" || e.key === "N") { e.preventDefault(); openComposer(); }
    else if (e.key === "?") { e.preventDefault(); openModal(shortcuts, document.activeElement, $("shortcuts-close")); }
  });

  // ---------------------------------------------------------------------------------------------
  // Lifecycle, called by main.js
  // ---------------------------------------------------------------------------------------------
  function reset() {
    state.active = false;
    clearTimeout(pollTimer);
    closeAllModals();
    closeMenu();
    closeMore();
    closeComposer(true);
    for (const [, rec] of records) { cleanup(rec.el); rec.el.remove(); }
    records.clear();
    lastOrderSig = "";
    if (list) delete list.dataset.rendered;
    Object.assign(state, {
      files: [], texts: [], participants: [], participantCount: 0, capacity: null, mediaBase: "", shareEnabled: false,
      kind: "all", query: "", sort: "newest", lastSnapshot: "", seatsInitialised: false,
    });
    state.selected.clear(); state.saved.clear(); state.saving.clear(); state.saveErrors.clear(); state.seenSeats.clear();
    activities.length = 0;
    logClearedAt = 0;
    uploads.clear();
    renderTray();
    if ($("search-input")) $("search-input").value = "";
    if ($("sort-select")) $("sort-select").value = "newest";
    if (textInput) textInput.value = "";
    if ($("bulk-note")) $("bulk-note").hidden = true;
    setKind("all");
    renderSeats(true);
    renderCapacity();
    renderLog(true);
    updateCounter();
  }

  window.HamalRoom = {
    // A room is open: start reading it.
    enter() {
      if (state.active) return;
      state.active = true;
      evaluateView("enter");
      render({ reorder: true });
      renderLog(true);
      updateCounter();
      const a = app();
      if (a && typeof a.GetUploads === "function") {
        a.GetUploads().then((items) => { (items || []).forEach(onUploadUpdate); }).catch(() => {});
      }
      poll().then(schedule);
    },
    // The room ended. Returns true when files were still sending.
    leave() {
      const hadOpen = Array.from(uploads.values()).some((i) => i.state === "queued" || i.state === "sending" || i.state === "ended");
      state.active = false;
      clearTimeout(pollTimer);
      stopMedia();
      closeAllModals();
      closeMenu();
      closeComposer(true);
      for (const [, rec] of records) cleanup(rec.el);
      if (tray && !hadOpen) tray.hidden = true;
      return hadOpen;
    },
    reset,
    // The language changed: rebuild everything that has text in it.
    refreshTexts() {
      textsVersion++;
      if (list) list.setAttribute("aria-label", state.view === "list" ? tr("room.listLabel") : tr("room.tableLabel"));
      render({ reorder: true });
      renderLog(true);
      renderSeats(true);
      renderCapacity();
      renderTray();
      updateCounter();
      setTrayCollapsed(tray ? tray.classList.contains("is-collapsed") : false);
    },
  };

  function bindRuntime() {
    if (window.runtime && typeof window.runtime.EventsOn === "function") {
      window.runtime.EventsOn("upload-update", onUploadUpdate);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bindRuntime);
  else bindRuntime();
  document.addEventListener("visibilitychange", () => { if (!document.hidden && state.active) { poll().then(schedule); } });
  updateCounter();
  renderLog(true);
})();
