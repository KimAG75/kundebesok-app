const DB_NAME = "kundebesok-db";
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("visits")) {
        db.createObjectStore("visits", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("notes")) {
        const s = db.createObjectStore("notes", { keyPath: "id" });
        s.createIndex("visitId", "visitId");
      }
      if (!db.objectStoreNames.contains("photos")) {
        const s = db.createObjectStore("photos", { keyPath: "id" });
        s.createIndex("visitId", "visitId");
      }
      if (!db.objectStoreNames.contains("audio")) {
        const s = db.createObjectStore("audio", { keyPath: "id" });
        s.createIndex("visitId", "visitId");
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

export const db = {
  newId,

  // ---- visits ----
  async listVisits() {
    const store = await tx("visits", "readonly");
    const all = await wrap(store.getAll());
    return all.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  },
  async getVisit(id) {
    const store = await tx("visits", "readonly");
    return wrap(store.get(id));
  },
  async saveVisit(visit) {
    const store = await tx("visits", "readwrite");
    await wrap(store.put(visit));
    return visit;
  },
  async deleteVisit(id) {
    const vStore = await tx("visits", "readwrite");
    await wrap(vStore.delete(id));
    for (const storeName of ["notes", "photos", "audio"]) {
      const items = await this._byVisit(storeName, id);
      const s = await tx(storeName, "readwrite");
      for (const item of items) await wrap(s.delete(item.id));
    }
  },

  async _byVisit(storeName, visitId) {
    const store = await tx(storeName, "readonly");
    const idx = store.index("visitId");
    return wrap(idx.getAll(visitId));
  },

  // ---- notes ----
  listNotes(visitId) {
    return this._byVisit("notes", visitId).then((items) =>
      items.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    );
  },
  async addNote(visitId, text) {
    const note = { id: newId(), visitId, text, createdAt: new Date().toISOString() };
    const store = await tx("notes", "readwrite");
    await wrap(store.put(note));
    return note;
  },
  async deleteNote(id) {
    const store = await tx("notes", "readwrite");
    await wrap(store.delete(id));
  },

  // ---- photos ----
  listPhotos(visitId) {
    return this._byVisit("photos", visitId).then((items) =>
      items.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    );
  },
  async addPhoto(visitId, blob, caption = "") {
    const photo = { id: newId(), visitId, blob, caption, createdAt: new Date().toISOString() };
    const store = await tx("photos", "readwrite");
    await wrap(store.put(photo));
    return photo;
  },
  async updatePhotoCaption(id, caption) {
    const store = await tx("photos", "readwrite");
    const photo = await wrap(store.get(id));
    if (!photo) return;
    photo.caption = caption;
    await wrap(store.put(photo));
  },
  async deletePhoto(id) {
    const store = await tx("photos", "readwrite");
    await wrap(store.delete(id));
  },

  // ---- audio ----
  listAudio(visitId) {
    return this._byVisit("audio", visitId).then((items) =>
      items.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    );
  },
  async addAudio(visitId, blob, duration, label = "") {
    const clip = { id: newId(), visitId, blob, duration, label, createdAt: new Date().toISOString() };
    const store = await tx("audio", "readwrite");
    await wrap(store.put(clip));
    return clip;
  },
  async updateAudioLabel(id, label) {
    const store = await tx("audio", "readwrite");
    const clip = await wrap(store.get(id));
    if (!clip) return;
    clip.label = label;
    await wrap(store.put(clip));
  },
  async deleteAudio(id) {
    const store = await tx("audio", "readwrite");
    await wrap(store.delete(id));
  },
};
