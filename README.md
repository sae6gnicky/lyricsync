# 🎤 LyricSync — AI Time-Synced Lyrics Generator

Upload an audio file or paste a YouTube link and get **time-stamped lyrics** you
can play back, fine-tune, and export as `.lrc` or `.srt`.

- **Mode A — Forced Alignment:** you provide the raw lyrics, the app aligns each
  line to the audio for accurate timestamps.
- **Mode B — Auto-Transcribe (ASR):** no lyrics provided → the app transcribes
  and timestamps them from scratch (Whisper / Deepgram).

The frontend is a **single-page React app with no build step** — the AI/backend
pieces are **mocked** so you can run and demo the whole flow instantly. This
document explains exactly where and how to plug in real APIs.

---

## → Run it

Because the browser can't fetch local files via `file://`, serve the folder over
HTTP:

```bash
# any static server works — pick one
python3 -m http.server 8000
#   → open http://localhost:8000

# or
npx serve .
```

> The app loads React + Babel from a CDN and transpiles JSX in the browser. Great
> for demos; for production, migrate to a bundler (see the last section).

### Files

| File | Purpose |
|------|---------|
| `index.html` | Entry point; loads React/Babel + the app scripts |
| `styles.css` | Dark, responsive, music-app theme |
| `api.js` | **Mocked** AI/backend layer (`window.LyricSyncAPI`) |
| `app.js` | React components + app logic |
| `server.example.js` | Reference Node/Express backend (Whisper/Deepgram/align) |

---

## 🔌 Where the mocks live

All AI work goes through three functions in **`api.js`**. Each one currently uses
`setTimeout` + dummy data and is annotated with an `INTEGRATION:` comment block
showing the real call. Search the file for `INTEGRATION:`.

| Function | Used when | Replace with |
|----------|-----------|--------------|
| `extractAudioFromYouTube(url, onProgress)` | user pastes a YouTube URL | your backend `POST /api/youtube/extract` (yt-dlp + ffmpeg) |
| `transcribeAudio(source, onProgress)` | **Mode B** — media only | ASR API (OpenAI Whisper / Deepgram / AssemblyAI) |
| `alignLyricsToAudio(source, rawLyrics, onProgress)` | **Mode A** — media + lyrics | forced aligner (WhisperX / gentle / aeneas) |

Each returns lyric lines shaped as:

```js
[ { time: 0.0, text: "First line" }, { time: 4.2, text: "Second line" }, ... ]
```

`time` is **seconds** (float). The UI handles LRC/SRT formatting from there.

---

## ⚠️ Golden rule: never call paid AI APIs from the browser

Your API keys must stay on a server. The frontend should call **your** backend,
which holds the secret keys and talks to the AI providers. The examples below run
server-side (see `server.example.js` for a runnable sketch).

---

## 🧩 Integration recipes

### 1) YouTube → audio (backend only)

Client-side extraction isn't feasible and often violates YouTube's ToS. Do it on
a server with [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) + `ffmpeg`.

```js
// api.js → extractAudioFromYouTube: replace the mock body with
const res = await fetch("/api/youtube/extract", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ url }),
});
const data = await res.json(); // { audioUrl, videoId, durationSec }
return { type: "youtube", ...data };
```

### 2) Mode B — OpenAI Whisper transcription (with timestamps)

Whisper's `verbose_json` response includes per-segment start times.

```js
// server side
const form = new FormData();
form.append("file", fs.createReadStream(audioPath));
form.append("model", "whisper-1");
form.append("response_format", "verbose_json");
form.append("timestamp_granularities[]", "segment");

const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
  body: form,
});
const json = await r.json();
const lines = json.segments.map((s) => ({ time: s.start, text: s.text.trim() }));
```

### 2b) Mode B — Deepgram alternative

```js
const r = await fetch("https://api.deepgram.com/v1/listen?utterances=true", {
  method: "POST",
  headers: {
    Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
    "Content-Type": "audio/mpeg",
  },
  body: audioBuffer,
});
const json = await r.json();
const lines = json.results.utterances.map((u) => ({ time: u.start, text: u.transcript }));
```

### 3) Mode A — Forced alignment (lyrics you already have)

Alignment is more accurate than transcription because the words are known;
the model only solves *when* each word is sung. Good options:

- **[WhisperX](https://github.com/m-bain/whisperX)** — Whisper + wav2vec2, word-level timings.
- **[gentle](https://github.com/lowerquality/gentle)** — Kaldi-based forced aligner.
- **[aeneas](https://github.com/readbeyond/aeneas)** — text↔audio alignment.
- Hosted: AssemblyAI / ElevenLabs alignment endpoints.

```js
// api.js → alignLyricsToAudio: replace the mock body with
const form = new FormData();
form.append("audio", audioFile);
form.append("transcript", rawLyrics);
const res = await fetch("/api/align", { method: "POST", body: form });
const { lines } = await res.json(); // [{ time, text }]
return lines;
```

---

## 🖥️ Suggested backend API contract

| Endpoint | Body | Returns |
|----------|------|---------|
| `POST /api/youtube/extract` | `{ url }` | `{ audioUrl, videoId, durationSec }` |
| `POST /api/transcribe` | multipart `audio` file | `{ lines: [{ time, text }] }` |
| `POST /api/align` | multipart `audio` + `transcript` | `{ lines: [{ time, text }] }` |

Because ASR/alignment can take a while, consider making these **async jobs**:
return `{ jobId }` immediately, then poll `GET /api/jobs/:id` (or use websockets/
SSE) for `{ status, progress, message, lines }`. The frontend's `onProgress`
callback is already designed to surface those `message` strings.

A runnable Express reference implementation is in **`server.example.js`**.

---

## · Features implemented in the frontend

- Drag-and-drop audio upload (MP3/WAV/M4A) **or** YouTube URL
- Optional raw-lyrics textarea **or** `.txt` upload
- Automatic Mode A / Mode B detection based on whether lyrics are supplied
- Step-by-step progress UI ("Extracting audio…", "Transcribing…", "Aligning…")
- Interactive player: local `<audio>` element **or** embedded YouTube (IFrame API)
- Live highlight of the current line + smooth auto-scroll (Apple-Music style)
- Click any line to seek the audio to that timestamp
- Edit mode: adjust timestamps and text, add/remove lines
- Export to `.lrc` and `.srt`
- Dark, responsive layout

---

## 🏗️ Migrating to a build setup (production)

For a real deployment, move off the in-browser Babel/CDN approach:

```bash
npm create vite@latest lyricsync -- --template react
```

Then:
1. Move the components from `app.js` into `src/` modules (`App.jsx`, etc.).
2. Turn `api.js` into `src/api.js` and swap the mocks for `fetch()` calls to your
   backend (recipes above).
3. Keep API keys server-side; deploy the backend separately (`server.example.js`
   is a starting point).
