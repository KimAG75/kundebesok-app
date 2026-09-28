// Phone camera photos can be several MB each, which is slow and unreliable
// to upload over a weak mobile connection at a customer site. Downscaling
// and re-encoding as JPEG client-side, before it ever hits IndexedDB or the
// upload queue, makes sync far more likely to actually succeed.
export async function compressImage(file, maxDim = 1600, quality = 0.82) {
  if (!file.type || !file.type.startsWith("image/") || file.type === "image/svg+xml") return file;
  try {
    const bitmap = await createImageBitmap(file);
    let { width, height } = bitmap;
    if (width > maxDim || height > maxDim) {
      const scale = maxDim / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    return blob || file;
  } catch (err) {
    console.error("image compression failed, using original file", err);
    return file;
  }
}
