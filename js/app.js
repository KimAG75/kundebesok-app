import { db } from "./db.js";
import { AudioRecorder, formatDuration } from "./audio.js";
import { renderReport } from "./report.js";
import { supabase } from "./supabaseClient.js";
import { onDataChanged, onStatusChange, scheduleSync, setCurrentUser, syncAll } from "./sync.js";

const view = document.getElementById("view");
const topbarTitle = document.getElementById("topbarTitle");
const btnBack = document.getElementById("btnBack");
const btnNewVisit = document.getElementById("btnNewVisit");
const btnAccount = document.getElementById("btnAccount");
const syncStatusEl = document.getElementById("syncStatus");
const toastEl = document.getElementById("toast");

let activeObjectUrls = [];
let recorder = new AudioRecorder();
let recordTimerHandle = null;
let currentUser = null;

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => (toastEl.hidden = true), 2200);
}

function revokeObjectUrls() {
  activeObjectUrls.forEach((u) => URL.revokeObjectURL(u));
  activeObjectUrls = [];
}

function trackUrl(url) {
  activeObjectUrls.push(url);
  return url;
}

function clone(tplId) {
  return document.getElementById(tplId).content.firstElementChild.cloneNode(true);
}

// ---------------------------------------------------------------- sync status UI
const SYNC_LABEL = {
  syncing: "🔄 Synkroniserer…",
  offline: "📴 Offline",
  error: "⚠️ Synk-feil",
};
onDataChanged(() => {
  // Only auto-refresh the list screen; leave detail/report screens alone so we
  // don't clobber input focus or scroll position while the user is editing.
  if (currentUser && (!location.hash || location.hash === "#/")) route();
});
onStatusChange((s) => {
  syncStatusEl.hidden = false;
  if (s.state === "synced") {
    syncStatusEl.textContent = `✅ Synk ${s.at.toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" })}`;
  } else {
    syncStatusEl.textContent = SYNC_LABEL[s.state] || "";
  }
});

// ---------------------------------------------------------------- auth
async function showAuth(message) {
  view.innerHTML = "";
  topbarTitle.textContent = "Kundebesøk";
  btnBack.hidden = true;
  btnNewVisit.hidden = true;
  btnAccount.hidden = true;
  syncStatusEl.hidden = true;
  view.appendChild(clone("tpl-auth"));

  const emailEl = document.getElementById("authEmail");
  const passEl = document.getElementById("authPassword");
  const errEl = document.getElementById("authError");
  if (message) {
    errEl.textContent = message;
    errEl.hidden = false;
  }

  function showError(err) {
    errEl.textContent = err;
    errEl.hidden = false;
  }

  document.getElementById("btnSignIn").addEventListener("click", async () => {
    errEl.hidden = true;
    const { error } = await supabase.auth.signInWithPassword({ email: emailEl.value.trim(), password: passEl.value });
    if (error) showError(oversettAuthFeil(error.message));
  });

  document.getElementById("btnSignUp").addEventListener("click", async () => {
    errEl.hidden = true;
    const { error } = await supabase.auth.signUp({ email: emailEl.value.trim(), password: passEl.value });
    if (error) showError(oversettAuthFeil(error.message));
    else showError("Bruker opprettet. Sjekk e-posten din for bekreftelse, eller logg inn direkte hvis bekreftelse ikke kreves.");
  });
}

function oversettAuthFeil(msg) {
  if (/invalid login credentials/i.test(msg)) return "Feil e-post eller passord.";
  if (/password should be at least/i.test(msg)) return "Passordet må være minst 6 tegn.";
  if (/user already registered/i.test(msg)) return "Denne e-posten er allerede registrert. Prøv å logge inn.";
  return msg;
}

btnAccount.addEventListener("click", async () => {
  const email = currentUser?.email || "";
  if (confirm(`Logget inn som ${email}\n\nTrykk OK for å logge ut.`)) {
    await supabase.auth.signOut();
  }
});

supabase.auth.onAuthStateChange((_event, session) => {
  currentUser = session?.user || null;
  if (currentUser) {
    setCurrentUser(currentUser.id);
    btnAccount.hidden = false;
    syncAll();
    route();
  } else {
    setCurrentUser(null);
    showAuth();
  }
});

// ---------------------------------------------------------------- router
window.addEventListener("hashchange", () => {
  if (currentUser) route();
});
btnNewVisit.addEventListener("click", async () => {
  const visit = await db.createVisit();
  scheduleSync(200);
  location.hash = `#/visit/${visit.id}`;
});
btnBack.addEventListener("click", () => history.back());

function route() {
  revokeObjectUrls();
  if (recorder.isRecording) recorder.stop();
  const hash = location.hash || "#/";
  const reportMatch = hash.match(/^#\/visit\/([^/]+)\/report$/);
  const pointMatch = hash.match(/^#\/visit\/([^/]+)\/point\/([^/]+)$/);
  const editMatch = hash.match(/^#\/visit\/([^/]+)$/);

  if (reportMatch) {
    btnBack.hidden = false;
    btnNewVisit.hidden = true;
    showReport(reportMatch[1]);
  } else if (pointMatch) {
    btnBack.hidden = false;
    btnNewVisit.hidden = true;
    showPointDetail(pointMatch[1], pointMatch[2]);
  } else if (editMatch) {
    btnBack.hidden = false;
    btnNewVisit.hidden = true;
    showDetail(editMatch[1]);
  } else {
    btnBack.hidden = true;
    btnNewVisit.hidden = false;
    showList();
  }
}

// ---------------------------------------------------------------- list screen
async function showList() {
  topbarTitle.textContent = "Kundebesøk";
  view.innerHTML = "";
  view.appendChild(clone("tpl-list"));

  const searchInput = document.getElementById("searchInput");
  const filterStatus = document.getElementById("filterStatus");
  const listEl = document.getElementById("visitList");
  const emptyState = document.getElementById("emptyState");

  const visits = await db.listVisits();

  function render() {
    const q = searchInput.value.trim().toLowerCase();
    const status = filterStatus.value;
    const filtered = visits.filter((v) => {
      const matchesQ = !q || (v.customer || "").toLowerCase().includes(q) || (v.location || "").toLowerCase().includes(q);
      const matchesStatus = !status || v.status === status;
      return matchesQ && matchesStatus;
    });

    listEl.innerHTML = "";
    emptyState.hidden = visits.length !== 0;

    for (const v of filtered) {
      const card = clone("tpl-visit-card");
      card.querySelector(".vc-customer").textContent = v.customer || "(uten kundenavn)";
      card.querySelector(".vc-date").textContent = v.date
        ? new Date(v.date).toLocaleString("nb-NO", { dateStyle: "short", timeStyle: "short" })
        : "";
      card.querySelector(".vc-location").textContent = v.location || "";
      const badge = card.querySelector(".vc-status-badge");
      badge.textContent = { planlagt: "Planlagt", gjennomfort: "Gjennomført", sendt: "Sendt" }[v.status] || v.status;
      badge.dataset.status = v.status;
      card.addEventListener("click", () => (location.hash = `#/visit/${v.id}`));
      listEl.appendChild(card);
    }
  }

  searchInput.addEventListener("input", render);
  filterStatus.addEventListener("change", render);
  render();
}

// ---------------------------------------------------------------- detail screen
async function showDetail(visitId) {
  const visit = await db.getVisit(visitId);
  if (!visit) {
    location.hash = "#/";
    return;
  }
  topbarTitle.textContent = visit.customer || "Nytt besøk";
  view.innerHTML = "";
  view.appendChild(clone("tpl-detail"));

  const fCustomer = document.getElementById("fCustomer");
  const fStatus = document.getElementById("fStatus");
  const fDate = document.getElementById("fDate");
  const fLocation = document.getElementById("fLocation");
  const fTekniker = document.getElementById("fTekniker");

  fCustomer.value = visit.customer || "";
  fStatus.value = visit.status || "planlagt";
  fDate.value = visit.date || "";
  fLocation.value = visit.location || "";
  fTekniker.value = visit.tekniker || "";

  let saveTimeout = null;
  async function persistField() {
    visit.customer = fCustomer.value;
    visit.status = fStatus.value;
    visit.date = fDate.value;
    visit.location = fLocation.value;
    visit.tekniker = fTekniker.value;
    await db.saveVisit(visit);
    topbarTitle.textContent = visit.customer || "Nytt besøk";
    scheduleSync();
  }
  function scheduleSave() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(persistField, 400);
  }
  [fCustomer, fLocation, fTekniker].forEach((el) => el.addEventListener("input", scheduleSave));
  [fStatus, fDate].forEach((el) => el.addEventListener("change", persistField));

  await renderPoints(visitId);

  document.getElementById("btnAddPoint").addEventListener("click", async () => {
    const point = await db.createPoint(visitId);
    scheduleSync(200);
    location.hash = `#/visit/${visitId}/point/${point.id}`;
  });

  document.getElementById("btnDeleteVisit").addEventListener("click", async () => {
    if (!confirm("Slette dette besøket og alt innhold (punkter, bilder, notater, lyd)? Dette kan ikke angres.")) return;
    await db.deleteVisit(visitId);
    scheduleSync(200);
    location.hash = "#/";
  });
  document.getElementById("btnOpenReport").addEventListener("click", () => {
    location.hash = `#/visit/${visitId}/report`;
  });
}

async function renderPoints(visitId) {
  const listEl = document.getElementById("pointList");
  const emptyState = document.getElementById("pointEmptyState");
  const points = await db.listPoints(visitId);
  emptyState.hidden = points.length !== 0;
  listEl.innerHTML = "";

  for (const p of points) {
    const card = clone("tpl-point-item");
    card.querySelector(".point-badge").textContent = `＃${p.number}`;
    card.querySelector(".point-title").textContent = p.title || "(uten beskrivelse)";
    const [notes, photos, audioClips] = await Promise.all([
      db.listNotes(p.id),
      db.listPhotos(p.id),
      db.listAudio(p.id),
    ]);
    const parts = [];
    if (notes.length) parts.push(`${notes.length} notat${notes.length > 1 ? "er" : ""}`);
    if (photos.length) parts.push(`${photos.length} bilde${photos.length > 1 ? "r" : ""}`);
    if (audioClips.length) parts.push(`${audioClips.length} lyd`);
    card.querySelector(".point-summary").textContent = parts.join(" · ");
    card.addEventListener("click", () => (location.hash = `#/visit/${visitId}/point/${p.id}`));
    listEl.appendChild(card);
  }
}

// ---------------------------------------------------------------- point detail screen
async function showPointDetail(visitId, pointId) {
  const [visit, point] = await Promise.all([db.getVisit(visitId), db.getPoint(pointId)]);
  if (!visit || !point) {
    location.hash = `#/visit/${visitId}`;
    return;
  }
  topbarTitle.textContent = `${visit.customer || "Besøk"} · ＃${point.number}`;
  view.innerHTML = "";
  view.appendChild(clone("tpl-point-detail"));

  document.querySelector(".point-header-badge").textContent = `＃${point.number}`;
  const fPointTitle = document.getElementById("fPointTitle");
  fPointTitle.value = point.title || "";
  let titleTimeout = null;
  fPointTitle.addEventListener("input", () => {
    clearTimeout(titleTimeout);
    titleTimeout = setTimeout(async () => {
      await db.updatePointTitle(pointId, fPointTitle.value);
      scheduleSync();
    }, 400);
  });

  // ---- tabs ----
  const tabBtns = [...document.querySelectorAll(".tab-btn")];
  const panels = [...document.querySelectorAll(".tab-panel")];
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabBtns.forEach((b) => b.classList.toggle("active", b === btn));
      panels.forEach((p) => (p.hidden = p.dataset.panel !== btn.dataset.tab));
    });
  });

  await Promise.all([renderNotes(pointId, visitId), renderPhotos(pointId, visitId), renderAudio(pointId, visitId)]);

  document.getElementById("btnDeletePoint").addEventListener("click", async () => {
    if (!confirm(`Slette punkt ＃${point.number} og alt innhold (bilder, notater, lyd)? Dette kan ikke angres.`)) return;
    await db.deletePoint(pointId);
    scheduleSync(200);
    location.hash = `#/visit/${visitId}`;
  });
}

async function renderNotes(pointId, visitId) {
  const listEl = document.getElementById("noteList");
  const input = document.getElementById("noteInput");
  const btnAdd = document.getElementById("btnAddNote");

  async function refresh() {
    const notes = await db.listNotes(pointId);
    listEl.innerHTML = "";
    for (const n of notes) {
      const row = clone("tpl-note-item");
      row.querySelector(".item-text").textContent = n.text;
      row.querySelector(".item-meta").textContent = new Date(n.createdAt).toLocaleString("nb-NO", {
        dateStyle: "short",
        timeStyle: "short",
      });
      row.querySelector(".btn-del").addEventListener("click", async () => {
        await db.deleteNote(n.id);
        scheduleSync();
        refresh();
      });
      listEl.appendChild(row);
    }
  }

  btnAdd.addEventListener("click", async () => {
    const text = input.value.trim();
    if (!text) return;
    await db.addNote(pointId, visitId, text);
    input.value = "";
    scheduleSync();
    refresh();
  });

  await refresh();
}

async function renderPhotos(pointId, visitId) {
  const listEl = document.getElementById("photoList");
  const input = document.getElementById("photoInput");

  async function refresh() {
    const photos = await db.listPhotos(pointId);
    listEl.innerHTML = "";
    for (const p of photos) {
      const row = clone("tpl-photo-item");
      const url = trackUrl(URL.createObjectURL(p.blob));
      row.querySelector(".photo-thumb").src = url;
      const captionInput = row.querySelector(".photo-caption");
      captionInput.value = p.caption || "";
      let t = null;
      captionInput.addEventListener("input", () => {
        clearTimeout(t);
        t = setTimeout(async () => {
          await db.updatePhotoCaption(p.id, captionInput.value);
          scheduleSync();
        }, 400);
      });
      row.querySelector(".btn-del").addEventListener("click", async () => {
        await db.deletePhoto(p.id);
        scheduleSync();
        refresh();
      });
      listEl.appendChild(row);
    }
  }

  input.addEventListener("change", async () => {
    const files = [...input.files];
    for (const file of files) {
      await db.addPhoto(pointId, visitId, file);
    }
    input.value = "";
    scheduleSync();
    refresh();
    toast(files.length > 1 ? `${files.length} bilder lagt til` : "Bilde lagt til");
  });

  await refresh();
}

async function renderAudio(pointId, visitId) {
  const listEl = document.getElementById("audioList");
  const btnRecord = document.getElementById("btnRecord");
  const timerEl = document.getElementById("recordTimer");

  async function refresh() {
    const clips = await db.listAudio(pointId);
    listEl.innerHTML = "";
    for (const a of clips) {
      const row = clone("tpl-audio-item");
      const url = trackUrl(URL.createObjectURL(a.blob));
      row.querySelector("audio").src = url;
      const labelInput = row.querySelector(".audio-label");
      labelInput.value = a.label || "";
      let t = null;
      labelInput.addEventListener("input", () => {
        clearTimeout(t);
        t = setTimeout(async () => {
          await db.updateAudioLabel(a.id, labelInput.value);
          scheduleSync();
        }, 400);
      });
      row.querySelector(".btn-del").addEventListener("click", async () => {
        await db.deleteAudio(a.id);
        scheduleSync();
        refresh();
      });
      listEl.appendChild(row);
    }
  }

  btnRecord.addEventListener("click", async () => {
    if (recorder.isRecording) {
      clearInterval(recordTimerHandle);
      timerEl.hidden = true;
      btnRecord.classList.remove("recording");
      btnRecord.textContent = "🎙️ Start opptak";
      const result = await recorder.stop();
      if (result && result.blob.size > 0) {
        await db.addAudio(pointId, visitId, result.blob, result.duration);
        scheduleSync();
        refresh();
        toast("Lydopptak lagret");
      }
      return;
    }
    try {
      await recorder.start();
    } catch (err) {
      toast("Fikk ikke tilgang til mikrofon: " + err.message);
      return;
    }
    const startedAt = Date.now();
    btnRecord.classList.add("recording");
    btnRecord.textContent = "⏹ Stopp opptak";
    timerEl.hidden = false;
    recordTimerHandle = setInterval(() => {
      timerEl.textContent = formatDuration((Date.now() - startedAt) / 1000);
    }, 250);
  });

  await refresh();
}

// ---------------------------------------------------------------- report screen
async function showReport(visitId) {
  const visit = await db.getVisit(visitId);
  if (!visit) {
    location.hash = "#/";
    return;
  }
  topbarTitle.textContent = "Rapport";
  view.innerHTML = "";
  view.appendChild(clone("tpl-report"));

  const rawPoints = await db.listPoints(visitId);
  const points = await Promise.all(
    rawPoints.map(async (point) => {
      const [notes, photosRaw, audioRaw] = await Promise.all([
        db.listNotes(point.id),
        db.listPhotos(point.id),
        db.listAudio(point.id),
      ]);
      const photos = photosRaw.map((p) => ({ ...p, url: trackUrl(URL.createObjectURL(p.blob)) }));
      const audioClips = audioRaw.map((a) => ({ ...a, url: trackUrl(URL.createObjectURL(a.blob)) }));
      return { ...point, notes, photos, audioClips };
    })
  );

  document.getElementById("reportContent").innerHTML = renderReport(visit, points);

  document.getElementById("btnPrint").addEventListener("click", async () => {
    window.print();
    if (visit.status !== "sendt") {
      visit.status = "gjennomfort";
      await db.saveVisit(visit);
      scheduleSync();
    }
  });

  const btnShare = document.getElementById("btnShare");
  if (navigator.share) {
    btnShare.hidden = false;
    btnShare.addEventListener("click", async () => {
      try {
        await navigator.share({
          title: `Servicerapport – ${visit.customer || ""}`,
          text: `Servicerapport for besøk hos ${visit.customer || "kunde"} (${visit.location || ""})`,
        });
      } catch (err) {
        if (err.name !== "AbortError") toast("Deling feilet: " + err.message);
      }
    });
  }

  document.getElementById("btnEmail").addEventListener("click", async () => {
    const subject = encodeURIComponent(`Servicerapport – ${visit.customer || "besøk"}`);
    const body = encodeURIComponent(
      `Hei,\n\nVedlagt servicerapport fra besøk ${visit.date ? new Date(visit.date).toLocaleDateString("nb-NO") : ""} hos ${visit.customer || ""}.\n\nBruk "Skriv ut / Lagre som PDF" for å lage PDF-filen, og legg den ved denne e-posten manuelt.\n\nMvh`
    );
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
    visit.status = "sendt";
    await db.saveVisit(visit);
    scheduleSync();
    toast("Status satt til 'Rapport sendt'");
  });
}

// ---------------------------------------------------------------- service worker
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
