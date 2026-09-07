import { formatDuration } from "./audio.js";

const STATUS_LABEL = {
  planlagt: "Planlagt",
  gjennomfort: "Gjennomført",
  sendt: "Rapport sendt",
};

function fmtDate(iso) {
  if (!iso) return "–";
  const d = new Date(iso);
  return d.toLocaleString("nb-NO", { dateStyle: "medium", timeStyle: "short" });
}

function esc(str) {
  return (str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderPoint(point) {
  const { notes, photos, audioClips } = point;

  const notesHtml = notes.length
    ? notes.map((n) => `<div class="report-note"><time>${fmtDate(n.createdAt)}</time>${esc(n.text)}</div>`).join("")
    : `<p class="report-note">Ingen notater.</p>`;

  const photosHtml = photos.length
    ? `<div class="report-photo-grid">${photos
        .map(
          (p) => `<figure class="report-photo">
            <img src="${p.url}" alt="${esc(p.caption)}">
            ${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ""}
          </figure>`
        )
        .join("")}</div>`
    : `<p>Ingen bilder.</p>`;

  const audioHtml = audioClips.length
    ? audioClips
        .map(
          (a) => `<div class="report-audio-row no-print">
            <audio controls src="${a.url}"></audio>
            <span>${esc(a.label) || "Lydnotat"} (${formatDuration(a.duration)})</span>
          </div>`
        )
        .join("")
    : `<p>Ingen lydopptak.</p>`;

  return `
    <section class="report-point">
      <h3 class="report-point-heading">＃${point.number}${point.title ? ` — ${esc(point.title)}` : ""}</h3>
      <div class="report-subsection">
        <h4>Notater</h4>
        ${notesHtml}
      </div>
      <div class="report-subsection">
        <h4>Bilder</h4>
        ${photosHtml}
      </div>
      <div class="report-subsection">
        <h4>Lydopptak</h4>
        ${audioHtml}
      </div>
    </section>
  `;
}

export function renderReport(visit, points) {
  const pointsHtml = points.length
    ? points.map(renderPoint).join("")
    : `<p>Ingen punkter registrert for dette besøket.</p>`;

  return `
    <h2>Servicerapport – ${esc(visit.customer) || "Uten navn"}</h2>
    <div class="report-meta">
      <div><span>Kunde</span>${esc(visit.customer) || "–"}</div>
      <div><span>Status</span>${STATUS_LABEL[visit.status] || visit.status}</div>
      <div><span>Dato / tid</span>${visit.date ? fmtDate(visit.date) : "–"}</div>
      <div><span>Sted</span>${esc(visit.location) || "–"}</div>
      <div><span>Tekniker</span>${esc(visit.tekniker) || "–"}</div>
    </div>

    ${pointsHtml}
  `;
}
