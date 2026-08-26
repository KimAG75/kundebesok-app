export class AudioRecorder {
  constructor() {
    this.mediaRecorder = null;
    this.chunks = [];
    this.stream = null;
    this.startedAt = 0;
  }

  get isRecording() {
    return !!this.mediaRecorder && this.mediaRecorder.state === "recording";
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    const mimeType = MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : MediaRecorder.isTypeSupported("audio/mp4")
      ? "audio/mp4"
      : "";
    this.mediaRecorder = mimeType ? new MediaRecorder(this.stream, { mimeType }) : new MediaRecorder(this.stream);
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    this.startedAt = Date.now();
    this.mediaRecorder.start();
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.mediaRecorder) return resolve(null);
      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: this.mediaRecorder.mimeType || "audio/webm" });
        const duration = Math.round((Date.now() - this.startedAt) / 1000);
        this.stream.getTracks().forEach((t) => t.stop());
        this.mediaRecorder = null;
        this.stream = null;
        resolve({ blob, duration });
      };
      this.mediaRecorder.stop();
    });
  }
}

export function formatDuration(totalSeconds) {
  const m = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}
