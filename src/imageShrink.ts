// Phone cameras produce photos of 5-15 MB, but the receipt reader (AWS
// Textract) refuses anything over 10 MB, and big uploads are slow on a
// restaurant's wifi. So before a photo goes to the server it is scaled
// down to a size that is still sharp enough to read every line of a
// receipt. Anything that is not a photo (a PDF, say) or is already small
// is sent exactly as it is, and if the photo cannot be read by this
// browser (some HEIC files on Windows) the original is sent untouched.

const SKIP_BELOW_BYTES = 1.5 * 1024 * 1024;
const MAX_SIDE = 3000;
const QUALITY = 0.85;

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; done: () => void }> {
  if (typeof createImageBitmap === "function") {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bmp, width: bmp.width, height: bmp.height, done: () => bmp.close() };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode failed"));
      el.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, done: () => undefined };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size <= SKIP_BELOW_BYTES) return file;
  try {
    const { source, width, height, done } = await decode(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      done();
      return file;
    }
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(source, 0, 0, w, h);
    done();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
    if (!blob || blob.size >= file.size) return file;
    const base = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${base}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  }
}
