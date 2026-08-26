import { db } from "./db.js";
import { AudioRecorder, formatDuration } from "./audio.js";
import { renderReport } from "./report.js";

const view = document.getElementById("view");
const topbarTitle = document.getElementById("topbarTitle");
const btnBack = document.getElementById("btnBack");
const btnNewVisit = document.getElementById("btnNewVisit");
const toastEl = document.getElementById("toast");

let activeObjectUrls = [];
let recorder = new AudioRecorder();
let recordTimerHandle = null;

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

// ---------------------------------------------------------------- router
window.addEventListener("hashchange", route);
window.addEventListener("DOMContentLoaded", route);
btnNewVisit.addEventListener("click", async () => {
  const visit = {
    id: db.newId(),
    customer: "",
    date: new Date().toISOString().slice(0, 16),
    location: "",
    tekniker: "",
    status: "planlagt",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await db.saveVisit(visit);
  location.hash = `#/visit/${visit.id}`;
});
btnBack.addEventListener("click", () => history.back());

function route() {
  revokeObjectUrls();
  if (recorder.isRecording) recorder.stop();
  const hash = location.hash || "#/";
  const detailMatch = hash.match(/^#\/visit\/([^/]+)\/report$/);
  const editMatch = hash.match(/^#\/visit\/([^/]+)$/);

  if (detailMatch) {
    btnBack.hidden = false;
    btnNewVisit.hidden = true;
    showReport(detailMatch[1]);
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
    visit.updatedAt = new Date().toISOString();
    await db.saveVisit(visit);
    topbarTitle.textContent = visit.customer || "Nytt besøk";
  }
  function scheduleSave() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(persistField, 400);
  }
  [fCustomer, fLocation, fTekniker].forEach((el) => el.addEventListener("input", scheduleSave));
  [fStatus, fDate].forEach((el) => el.addEventListener("change", persistField));

  // ---- tabs ----
  const tabBtns = [...document.querySelectorAll(".tab-btn")];
  const panels = [...document.querySelectorAll(".tab-panel")];
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabBtns.forEach((b) => b.classList.toggle("active", b === btn));
      panels.forEach((p) => (p.hidden = p.dataset.panel !== btn.dataset.tab));
    });
  });

  await Promise.all([renderNotes(visitId), renderPhotos(visitId), renderAudio(visitId)]);

  document.getElementById("btnDeleteVisit").addEventListener("click", async () => {
    if (!confirm("Slette dette besøket og alt innhold (bilder, notater, lyd)? Dette kan ikke angres.")) return;
    await db.deleteVisit(visitId);
    location.hash = "#/";
  });
  document.getElementById("btnOpenReport").addEventListener("click", () => {
    location.hash = `#/visit/${visitId}/report`;
  });
}

async function renderNotes(visitId) {
  const listEl = document.getElementById("noteList");
  const input = document.getElementById("noteInput");
  const btnAdd = document.getElementById("btnAddNote");

  async function refresh() {
    const notes = await db.listNotes(visitId);
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
        refresh();
      });
      listEl.appendChild(row);
    }
  }

  btnAdd.addEventListener("click", async () => {
    const text = input.value.trim();
    if (!text) return;
    await db.addNote(visitId, text);
    input.value = "";
    refresh();
  });

  await refresh();
}

async function renderPhotos(visitId) {
  const listEl = document.getElementById("photoList");
  const input = document.getElementById("photoInput");

  async function refresh() {
    const photos = await db.listPhotos(visitId);
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
        t = setTimeout(() => db.updatePhotoCaption(p.id, captionInput.value), 400);
      });
      row.querySelector(".btn-del").addEventListener("click", async () => {
        await db.deletePhoto(p.id);
        refresh();
      });
      listEl.appendChild(row);
    }
  }

  input.addEventListener("change", async () => {
    const files = [...input.files];
    for (const file of files) {
      await db.addPhoto(visitId, file);
    }
    input.value = "";
    refresh();
    toast(files.length > 1 ? `${files.length} bilder lagt til` : "Bilde lagt til");
  });

  await refresh();
}

async function renderAudio(visitId) {
  const listEl = document.getElementById("audioList");
  const btnRecord = document.getElementById("btnRecord");
  const timerEl = document.getElementById("recordTimer");

  async function refresh() {
    const clips = await db.listAudio(visitId);
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
        t = setTimeout(() => db.updateAudioLabel(a.id, labelInput.value), 400);
      });
      row.querySelector(".btn-del").addEventListener("click", async () => {
        await db.deleteAudio(a.id);
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
        await db.addAudio(visitId, result.blob, result.duration);
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

  const [notes, photosRaw, audioRaw] = await Promise.all([
    db.listNotes(visitId),
    db.listPhotos(visitId),
    db.listAudio(visitId),
  ]);
  const photos = photosRaw.map((p) => ({ ...p, url: trackUrl(URL.createObjectURL(p.blob)) }));
  const audioClips = audioRaw.map((a) => ({ ...a, url: trackUrl(URL.createObjectURL(a.blob)) }));

  document.getElementById("reportContent").innerHTML = renderReport(visit, notes, photos, audioClips);

  document.getElementById("btnPrint").addEventListener("click", async () => {
    window.print();
    if (visit.status !== "sendt") {
      visit.status = "gjennomfort";
      visit.updatedAt = new Date().toISOString();
      await db.saveVisit(visit);
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
    visit.updatedAt = new Date().toISOString();
    await db.saveVisit(visit);
    toast("Status satt til 'Rapport sendt'");
  });
}

// ---------------------------------------------------------------- service worker
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
