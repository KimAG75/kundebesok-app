const DB_NAME = "kundebesok-db";
const DB_VERSION = 2;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const t = req.transaction;

      if (!db.objectStoreNames.contains("visits")) {
        db.createObjectStore("visits", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("points")) {
        const s = db.createObjectStore("points", { keyPath: "id" });
        s.createIndex("visitId", "visitId");
      }
      if (!db.objectStoreNames.contains("notes")) {
        const s = db.createObjectStore("notes", { keyPath: "id" });
        s.createIndex("visitId", "visitId");
        s.createIndex("pointId", "pointId");
      } else {
        const s = t.objectStore("notes");
        if (!s.indexNames.contains("pointId")) s.createIndex("pointId", "pointId");
      }
      if (!db.objectStoreNames.contains("photos")) {
        const s = db.createObjectStore("photos", { keyPath: "id" });
        s.createIndex("visitId", "visitId");
        s.createIndex("pointId", "pointId");
      } else {
        const s = t.objectStore("photos");
        if (!s.indexNames.contains("pointId")) s.createIndex("pointId", "pointId");
      }
      if (!db.objectStoreNames.contains("audio")) {
        const s = db.createObjectStore("audio", { keyPath: "id" });
        s.createIndex("visitId", "visitId");
        s.createIndex("pointId", "pointId");
      } else {
        const s = t.objectStore("audio");
        if (!s.indexNames.contains("pointId")) s.createIndex("pointId", "pointId");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return openDb().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function now() {
  return new Date().toISOString();
}

async function byIndex(storeName, indexName, value) {
  const store = await tx(storeName, "readonly");
  const idx = store.index(indexName);
  return wrap(idx.getAll(value));
}

async function softDeleteAllByIndex(storeName, indexName, value) {
  const items = await byIndex(storeName, indexName, value);
  const store = await tx(storeName, "readwrite");
  for (const item of items) {
    item.deleted = true;
    item.dirty = true;
    item.updatedAt = now();
    await wrap(store.put(item));
  }
}

export const db = {
  newId,

  // ---- generic sync helpers ----
  async getDirty(storeName) {
    const store = await tx(storeName, "readonly");
    const all = await wrap(store.getAll());
    return all.filter((r) => r.dirty);
  },
  async clearDirty(storeName, id) {
    const store = await tx(storeName, "readwrite");
    const rec = await wrap(store.get(id));
    if (!rec) return;
    rec.dirty = false;
    await wrap(store.put(rec));
  },
  async updateBlob(storeName, id, blob) {
    const store = await tx(storeName, "readwrite");
    const rec = await wrap(store.get(id));
    if (!rec) return;
    rec.blob = blob;
    await wrap(store.put(rec));
  },
  async setStoragePath(storeName, id, storagePath) {
    const store = await tx(storeName, "readwrite");
    const rec = await wrap(store.get(id));
    if (!rec) return;
    rec.storagePath = storagePath;
    await wrap(store.put(rec));
  },
  async getById(storeName, id) {
    const store = await tx(storeName, "readonly");
    return wrap(store.get(id));
  },
  async putFromRemote(storeName, record) {
    const store = await tx(storeName, "readwrite");
    await wrap(store.put({ ...record, dirty: false }));
  },
  async getAll(storeName) {
    const store = await tx(storeName, "readonly");
    return wrap(store.getAll());
  },
  async reassignPoint(storeName, id, pointId) {
    const store = await tx(storeName, "readwrite");
    const rec = await wrap(store.get(id));
    if (!rec) return;
    rec.pointId = pointId;
    rec.dirty = true;
    rec.updatedAt = now();
    await wrap(store.put(rec));
  },
  // Notes/photos/audio created before the "points" feature existed have no
  // pointId, so they're invisible in the point-scoped UI. Fold them into a
  // catch-all point per visit so nothing stays orphaned/hidden.
  async ensureLegacyPoint(visitId) {
    const LEGACY_TITLE = "Tidligere registreringer";
    const existing = await byIndex("points", "visitId", visitId);
    const found = existing.find((p) => p.title === LEGACY_TITLE && !p.deleted);
    if (found) return found;
    return this.createPoint(visitId).then(async (point) => {
      point.title = LEGACY_TITLE;
      const store = await tx("points", "readwrite");
      await wrap(store.put(point));
      return point;
    });
  },

  // ---- visits ----
  async listVisits() {
    const store = await tx("visits", "readonly");
    const all = await wrap(store.getAll());
    return all.filter((v) => !v.deleted).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  },
  async getVisit(id) {
    const store = await tx("visits", "readonly");
    const v = await wrap(store.get(id));
    return v && !v.deleted ? v : null;
  },
  async createVisit() {
    const visit = {
      id: newId(),
      customer: "",
      date: new Date().toISOString().slice(0, 16),
      location: "",
      tekniker: "",
      status: "planlagt",
      deleted: false,
      dirty: true,
      createdAt: now(),
      updatedAt: now(),
    };
    const store = await tx("visits", "readwrite");
    await wrap(store.put(visit));
    return visit;
  },
  async saveVisit(visit) {
    visit.updatedAt = now();
    visit.dirty = true;
    const store = await tx("visits", "readwrite");
    await wrap(store.put(visit));
    return visit;
  },
  async deleteVisit(id) {
    const store = await tx("visits", "readwrite");
    const visit = await wrap(store.get(id));
    if (visit) {
      visit.deleted = true;
      visit.dirty = true;
      visit.updatedAt = now();
      await wrap(store.put(visit));
    }
    const points = await byIndex("points", "visitId", id);
    for (const point of points) {
      await this.deletePoint(point.id);
    }
  },

  // ---- points ----
  listPoints(visitId) {
    return byIndex("points", "visitId", visitId).then((items) =>
      items.filter((p) => !p.deleted).sort((a, b) => a.number - b.number)
    );
  },
  async getPoint(id) {
    const store = await tx("points", "readonly");
    const p = await wrap(store.get(id));
    return p && !p.deleted ? p : null;
  },
  async createPoint(visitId) {
    const existing = await byIndex("points", "visitId", visitId);
    const nextNumber = existing.reduce((max, p) => Math.max(max, p.number || 0), 0) + 1;
    const point = {
      id: newId(),
      visitId,
      number: nextNumber,
      title: "",
      deleted: false,
      dirty: true,
      createdAt: now(),
      updatedAt: now(),
    };
    const store = await tx("points", "readwrite");
    await wrap(store.put(point));
    return point;
  },
  async updatePointTitle(id, title) {
    const store = await tx("points", "readwrite");
    const point = await wrap(store.get(id));
    if (!point) return;
    point.title = title;
    point.dirty = true;
    point.updatedAt = now();
    await wrap(store.put(point));
  },
  async deletePoint(id) {
    const store = await tx("points", "readwrite");
    const point = await wrap(store.get(id));
    if (point) {
      point.deleted = true;
      point.dirty = true;
      point.updatedAt = now();
      await wrap(store.put(point));
    }
    for (const storeName of ["notes", "photos", "audio"]) {
      await softDeleteAllByIndex(storeName, "pointId", id);
    }
  },

  // ---- notes ----
  listNotes(pointId) {
    return byIndex("notes", "pointId", pointId).then((items) =>
      items.filter((n) => !n.deleted).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    );
  },
  async addNote(pointId, visitId, text) {
    const note = {
      id: newId(),
      pointId,
      visitId,
      text,
      deleted: false,
      dirty: true,
      createdAt: now(),
      updatedAt: now(),
    };
    const store = await tx("notes", "readwrite");
    await wrap(store.put(note));
    return note;
  },
  async deleteNote(id) {
    const store = await tx("notes", "readwrite");
    const note = await wrap(store.get(id));
    if (!note) return;
    note.deleted = true;
    note.dirty = true;
    note.updatedAt = now();
    await wrap(store.put(note));
  },

  // ---- photos ----
  listPhotos(pointId) {
    return byIndex("photos", "pointId", pointId).then((items) =>
      items.filter((p) => !p.deleted).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    );
  },
  async addPhoto(pointId, visitId, blob, caption = "") {
    const photo = {
      id: newId(),
      pointId,
      visitId,
      blob,
      caption,
      storagePath: null,
      deleted: false,
      dirty: true,
      createdAt: now(),
      updatedAt: now(),
    };
    const store = await tx("photos", "readwrite");
    await wrap(store.put(photo));
    return photo;
  },
  async updatePhotoCaption(id, caption) {
    const store = await tx("photos", "readwrite");
    const photo = await wrap(store.get(id));
    if (!photo) return;
    photo.caption = caption;
    photo.dirty = true;
    photo.updatedAt = now();
    await wrap(store.put(photo));
  },
  async deletePhoto(id) {
    const store = await tx("photos", "readwrite");
    const photo = await wrap(store.get(id));
    if (!photo) return;
    photo.deleted = true;
    photo.dirty = true;
    photo.updatedAt = now();
    await wrap(store.put(photo));
  },

  // ---- audio ----
  listAudio(pointId) {
    return byIndex("audio", "pointId", pointId).then((items) =>
      items.filter((a) => !a.deleted).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    );
  },
  async addAudio(pointId, visitId, blob, duration, label = "") {
    const clip = {
      id: newId(),
      pointId,
      visitId,
      blob,
      duration,
      label,
      storagePath: null,
      deleted: false,
      dirty: true,
      createdAt: now(),
      updatedAt: now(),
    };
    const store = await tx("audio", "readwrite");
    await wrap(store.put(clip));
    return clip;
  },
  async updateAudioLabel(id, label) {
    const store = await tx("audio", "readwrite");
    const clip = await wrap(store.get(id));
    if (!clip) return;
    clip.label = label;
    clip.dirty = true;
    clip.updatedAt = now();
    await wrap(store.put(clip));
  },
  async deleteAudio(id) {
    const store = await tx("audio", "readwrite");
    const clip = await wrap(store.get(id));
    if (!clip) return;
    clip.deleted = true;
    clip.dirty = true;
    clip.updatedAt = now();
    await wrap(store.put(clip));
  },
};
