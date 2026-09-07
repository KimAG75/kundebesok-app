import { supabase } from "./supabaseClient.js";
import { db } from "./db.js";

let statusListeners = [];
export function onStatusChange(cb) {
  statusListeners.push(cb);
}
function setStatus(s) {
  statusListeners.forEach((cb) => cb(s));
}

let dataChangedListeners = [];
export function onDataChanged(cb) {
  dataChangedListeners.push(cb);
}
function notifyDataChanged() {
  dataChangedListeners.forEach((cb) => cb());
}

let syncing = false;
let syncTimer = null;
let currentUserId = null;

export function setCurrentUser(userId) {
  currentUserId = userId;
}

export function scheduleSync(delay = 800) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncAll(), delay);
}

function newer(remoteIso, local) {
  if (!local) return true;
  if (local.dirty) return false;
  return new Date(remoteIso) > new Date(local.updatedAt || 0);
}

async function pushVisits(userId) {
  const dirty = await db.getDirty("visits");
  for (const v of dirty) {
    const row = {
      id: v.id,
      user_id: userId,
      customer: v.customer || "",
      date: v.date ? new Date(v.date).toISOString() : null,
      location: v.location || "",
      tekniker: v.tekniker || "",
      status: v.status || "planlagt",
      deleted: !!v.deleted,
      created_at: v.createdAt,
      updated_at: v.updatedAt,
    };
    const { error } = await supabase.from("visits").upsert(row);
    if (!error) await db.clearDirty("visits", v.id);
    else console.error("push visit failed", error);
  }
}

async function pushNotes(userId) {
  const dirty = await db.getDirty("notes");
  for (const n of dirty) {
    const row = {
      id: n.id,
      visit_id: n.visitId,
      user_id: userId,
      text: n.text || "",
      deleted: !!n.deleted,
      created_at: n.createdAt,
      updated_at: n.updatedAt,
    };
    const { error } = await supabase.from("notes").upsert(row);
    if (!error) await db.clearDirty("notes", n.id);
    else console.error("push note failed", error);
  }
}

async function pushPhotos(userId) {
  const dirty = await db.getDirty("photos");
  for (const p of dirty) {
    let storagePath = p.storagePath;
    if (!storagePath && p.blob && !p.deleted) {
      const ext = (p.blob.type && p.blob.type.split("/")[1]) || "jpg";
      storagePath = `${userId}/${p.visitId}/${p.id}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("media")
        .upload(storagePath, p.blob, { upsert: true, contentType: p.blob.type || "image/jpeg" });
      if (upErr) {
        console.error("photo upload failed", upErr);
        continue;
      }
      await db.setStoragePath("photos", p.id, storagePath);
    }
    if (!storagePath) continue; // deleted before ever uploaded, nothing to reference remotely
    const row = {
      id: p.id,
      visit_id: p.visitId,
      user_id: userId,
      storage_path: storagePath,
      caption: p.caption || "",
      deleted: !!p.deleted,
      created_at: p.createdAt,
      updated_at: p.updatedAt,
    };
    const { error } = await supabase.from("photos").upsert(row);
    if (!error) await db.clearDirty("photos", p.id);
    else console.error("push photo row failed", error);
  }
}

async function pushAudio(userId) {
  const dirty = await db.getDirty("audio");
  for (const a of dirty) {
    let storagePath = a.storagePath;
    if (!storagePath && a.blob && !a.deleted) {
      const ext = (a.blob.type && a.blob.type.split("/")[1]) || "webm";
      storagePath = `${userId}/${a.visitId}/${a.id}.${ext.split(";")[0]}`;
      const { error: upErr } = await supabase.storage
        .from("media")
        .upload(storagePath, a.blob, { upsert: true, contentType: a.blob.type || "audio/webm" });
      if (upErr) {
        console.error("audio upload failed", upErr);
        continue;
      }
      await db.setStoragePath("audio", a.id, storagePath);
    }
    if (!storagePath) continue;
    const row = {
      id: a.id,
      visit_id: a.visitId,
      user_id: userId,
      storage_path: storagePath,
      duration: a.duration || 0,
      label: a.label || "",
      deleted: !!a.deleted,
      created_at: a.createdAt,
      updated_at: a.updatedAt,
    };
    const { error } = await supabase.from("audio_clips").upsert(row);
    if (!error) await db.clearDirty("audio", a.id);
    else console.error("push audio row failed", error);
  }
}

async function pullVisits(userId) {
  const { data, error } = await supabase.from("visits").select("*").eq("user_id", userId);
  if (error) throw error;
  for (const row of data) {
    const local = await db.getById("visits", row.id);
    if (!newer(row.updated_at, local)) continue;
    await db.putFromRemote("visits", {
      id: row.id,
      customer: row.customer,
      date: row.date,
      location: row.location,
      tekniker: row.tekniker,
      status: row.status,
      deleted: row.deleted,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
}

async function pullNotes(userId) {
  const { data, error } = await supabase.from("notes").select("*").eq("user_id", userId);
  if (error) throw error;
  for (const row of data) {
    const local = await db.getById("notes", row.id);
    if (!newer(row.updated_at, local)) continue;
    await db.putFromRemote("notes", {
      id: row.id,
      visitId: row.visit_id,
      text: row.text,
      deleted: row.deleted,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
}

async function pullPhotos(userId) {
  const { data, error } = await supabase.from("photos").select("*").eq("user_id", userId);
  if (error) throw error;
  for (const row of data) {
    const local = await db.getById("photos", row.id);
    if (!newer(row.updated_at, local)) continue;
    let blob = local?.blob || null;
    if (!row.deleted && !blob) {
      const { data: fileData, error: dlErr } = await supabase.storage.from("media").download(row.storage_path);
      if (dlErr) {
        console.error("photo download failed", dlErr);
        continue;
      }
      blob = fileData;
    }
    await db.putFromRemote("photos", {
      id: row.id,
      visitId: row.visit_id,
      blob,
      caption: row.caption,
      storagePath: row.storage_path,
      deleted: row.deleted,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
}

async function pullAudio(userId) {
  const { data, error } = await supabase.from("audio_clips").select("*").eq("user_id", userId);
  if (error) throw error;
  for (const row of data) {
    const local = await db.getById("audio", row.id);
    if (!newer(row.updated_at, local)) continue;
    let blob = local?.blob || null;
    if (!row.deleted && !blob) {
      const { data: fileData, error: dlErr } = await supabase.storage.from("media").download(row.storage_path);
      if (dlErr) {
        console.error("audio download failed", dlErr);
        continue;
      }
      blob = fileData;
    }
    await db.putFromRemote("audio", {
      id: row.id,
      visitId: row.visit_id,
      blob,
      duration: row.duration,
      label: row.label,
      storagePath: row.storage_path,
      deleted: row.deleted,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
}

export async function syncAll() {
  if (syncing || !currentUserId) return;
  if (!navigator.onLine) {
    setStatus({ state: "offline" });
    return;
  }
  syncing = true;
  setStatus({ state: "syncing" });
  try {
    await pushVisits(currentUserId);
    await pushNotes(currentUserId);
    await pushPhotos(currentUserId);
    await pushAudio(currentUserId);
    await pullVisits(currentUserId);
    await pullNotes(currentUserId);
    await pullPhotos(currentUserId);
    await pullAudio(currentUserId);
    setStatus({ state: "synced", at: new Date() });
    notifyDataChanged();
  } catch (err) {
    console.error("sync failed", err);
    setStatus({ state: "error", message: err.message });
  } finally {
    syncing = false;
  }
}

window.addEventListener("online", () => scheduleSync(200));
window.addEventListener("offline", () => setStatus({ state: "offline" }));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") scheduleSync(200);
});
setInterval(() => scheduleSync(0), 45000);
