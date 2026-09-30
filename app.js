/* ============================================================================
   LyricSync — Main React app
   ----------------------------------------------------------------------------
   Screens (driven by `stage` state):
     "input"      -> media + optional lyrics entry, choose/process
     "processing" -> progress steps while mocked AI runs
     "result"     -> interactive player + synced/editable lyrics + export

   All AI calls go through window.LyricSyncAPI (see api.js), which is mocked.
   ============================================================================ */

const { useState, useRef, useEffect, useCallback } = React;
const API = window.LyricSyncAPI;

/* ------------------------------- Helpers ---------------------------------- */

// seconds -> "M:SS" for compact display.
function fmtClock(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// seconds -> "[mm:ss.xx]" LRC timestamp.
function toLrcTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.round((sec - Math.floor(sec)) * 100);
  return `[${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}]`;
}

// seconds -> "HH:MM:SS,mmm" SRT timestamp.
function toSrtTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

// Parse a user-typed "M:SS.xx" (or plain seconds) back into seconds.
function parseClockInput(str) {
  str = String(str).trim();
  if (str.includes(":")) {
    const [mm, ss] = str.split(":");
    return (parseInt(mm, 10) || 0) * 60 + (parseFloat(ss) || 0);
  }
  return parseFloat(str) || 0;
}

// Build .lrc text from lyric lines.
function buildLRC(lines, meta = {}) {
  const header = [
    meta.title ? `[ti:${meta.title}]` : null,
    meta.artist ? `[ar:${meta.artist}]` : null,
    `[by:LyricSync]`,
  ].filter(Boolean);
  const body = [...lines]
    .sort((a, b) => a.time - b.time)
    .map((l) => `${toLrcTime(l.time)}${l.text}`);
  return header.concat(body).join("
") + "
";
}

// Build .srt text. End time = next line's start (or +3s for the last line).
function buildSRT(lines) {
  const sorted = [...lines].sort((a, b) => a.time - b.time);
  return (
    sorted
      .map((l, i) => {
        const start = l.time;
        const end = i + 1 < sorted.length ? sorted[i + 1].time : start + 3;
        return `${i + 1}
${toSrtTime(start)} --> ${toSrtTime(end)}
${l.text}`;
      })
      .join("

") + "
"
  );
}

// Trigger a client-side file download for a text blob.
function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ============================== Components ================================= */

/* ---- Icon: small inline logo mark ---- */
function LogoMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M9 18V5l10-2v13" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="6" cy="18" r="3" stroke="#fff" strokeWidth="2" />
      <circle cx="16" cy="16" r="3" stroke="#fff" strokeWidth="2" />
    </svg>
  );
}

/* ---- Drag & drop audio uploader ---- */
function MediaInput({ audioFile, setAudioFile, youtubeUrl, setYoutubeUrl }) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);

  const accept = ".mp3,.wav,.m4a,audio/*";

  const handleFiles = (files) => {
    const f = files && files[0];
    if (!f) return;
    // Basic client-side validation of allowed audio types.
    const ok = /\.(mp3|wav|m4a)$/i.test(f.name) || f.type.startsWith("audio/");
    if (!ok) {
      alert("Please choose an MP3, WAV, or M4A audio file.");
      return;
    }
    setAudioFile(f);
    setYoutubeUrl(""); // a local file and a URL are mutually exclusive inputs
  };

  return (
    <div className="panel">
      <h3 className="section-title">
        <span>🎵</span> 1 · Media Input
      </h3>

      {/* Drag-and-drop zone */}
      <div
        className={"dropzone" + (drag ? " drag" : "")}
        onClick={() => inputRef.current && inputRef.current.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          handleFiles(e.dataTransfer.files);
        }}
      >
        <div className="icon">📥</div>
        <div className="hint">
          <strong>Drag &amp; drop</strong> an audio file, or click to browse
        </div>
        <div className="sub">Supports MP3, WAV, M4A</div>
        {audioFile && (
          <div className="file-chip">✓ {audioFile.name}</div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          hidden
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      <div className="divider-or">OR</div>

      {/* YouTube URL */}
      <label className="field-label" htmlFor="yt">Paste a YouTube URL</label>
      <input
        id="yt"
        type="url"
        placeholder="https://www.youtube.com/watch?v=…"
        value={youtubeUrl}
        onChange={(e) => {
          setYoutubeUrl(e.target.value);
          if (e.target.value) setAudioFile(null); // mutually exclusive
        }}
      />
    </div>
  );
}

/* ---- Optional raw-lyrics input (textarea or .txt upload) ---- */
function LyricsInput({ rawLyrics, setRawLyrics }) {
  const inputRef = useRef(null);

  const handleFile = (files) => {
    const f = files && files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setRawLyrics(String(reader.result));
    reader.readAsText(f);
  };

  return (
    <div className="panel">
      <h3 className="section-title">
        <span>📝</span> 2 · Lyrics Input
        <span className="badge-opt">optional</span>
      </h3>

      <label className="field-label">
        Paste raw lyrics (one line per lyric). Leave empty to auto-transcribe.
      </label>
      <textarea
        placeholder={"We lit up the city lights tonight
Chasing every echo down the boulevard
…"}
        value={rawLyrics}
        onChange={(e) => setRawLyrics(e.target.value)}
      />

      <div style={{ marginTop: 12 }}>
        <button
          className="btn btn-ghost"
          onClick={() => inputRef.current && inputRef.current.click()}
        >
          📄 Upload .txt lyrics file
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".txt,text/plain"
          hidden
          onChange={(e) => handleFile(e.target.files)}
        />
      </div>
    </div>
  );
}

/* ---- Processing screen: animated step list driven by onProgress ---- */
const STEP_LABELS = {
  extract: "Extracting audio",
  upload: "Uploading media",
  transcribe: "Transcribing lyrics (ASR)",
  align: "Aligning lyrics to audio",
  timestamps: "Generating timestamps",
};

function Processing({ steps, currentKey, message, percent }) {
  return (
    <div className="panel progress-wrap">
      <h3 className="section-title"><span>⚙️</span> Processing</h3>
      <div className="progress-steps">
        {steps.map((key) => {
          const idx = steps.indexOf(key);
          const curIdx = steps.indexOf(currentKey);
          const state = idx < curIdx ? "done" : idx === curIdx ? "active" : "";
          return (
            <div key={key} className={"step " + state}>
              <span className="dot">
                {state === "done" ? "✓" : state === "active" ? <span className="spinner" /> : idx + 1}
              </span>
              <span>{STEP_LABELS[key] || key}</span>
            </div>
          );
        })}
      </div>
      <div className="progress-bar"><div style={{ width: percent + "%" }} /></div>
      <p style={{ color: "var(--text-1)", fontSize: 14, marginTop: 14 }}>{message}</p>
    </div>
  );
}

/* ---- The interactive result: player + synced, editable lyrics ---- */
function Result({ result, lyrics, setLyrics, onReset }) {
  const audioRef = useRef(null);
  const scrollRef = useRef(null);
  const lineRefs = useRef([]);
  const ytPlayerRef = useRef(null); // YouTube IFrame API player instance

  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [toast, setToast] = useState(null);

  const isYouTube = result.type === "youtube" && result.videoId;
  // For a local file we build an object URL to feed the <audio> element.
  const [objectUrl] = useState(() =>
    result.type === "file" && result.file ? URL.createObjectURL(result.file) : null
  );

  useEffect(() => () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, [objectUrl]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  /* ---------- YouTube IFrame API: load once, poll current time ---------- */
  useEffect(() => {
    if (!isYouTube) return;
    let interval;

    function createPlayer() {
      ytPlayerRef.current = new window.YT.Player("yt-player", {
        videoId: result.videoId,
        events: {
          onStateChange: (e) => {
            // 1 = playing, 2 = paused, 0 = ended
            setPlaying(e.data === 1);
          },
        },
      });
      // Poll the player time (the API has no time-update event).
      interval = setInterval(() => {
        const p = ytPlayerRef.current;
        if (p && p.getCurrentTime) setCurrentTime(p.getCurrentTime());
      }, 200);
    }

    if (window.YT && window.YT.Player) {
      createPlayer();
    } else {
      // Inject the API script and wait for the global ready callback.
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.body.appendChild(tag);
      window.onYouTubeIframeAPIReady = createPlayer;
    }
    return () => interval && clearInterval(interval);
  }, [isYouTube, result.videoId]);

  /* ---------- Determine which lyric line is "active" right now ---------- */
  const activeIndex = (() => {
    const sorted = lyrics;
    let idx = -1;
    for (let i = 0; i < sorted.length; i++) {
      if (currentTime >= sorted[i].time) idx = i;
      else break;
    }
    return idx;
  })();

  /* ---------- Auto-scroll the active line into view (Apple-Music style) --- */
  useEffect(() => {
    if (editMode) return; // don't fight the user while editing
    const el = lineRefs.current[activeIndex];
    if (el && scrollRef.current) {
      const c = scrollRef.current;
      const top = el.offsetTop - c.clientHeight / 2 + el.clientHeight / 2;
      c.scrollTo({ top, behavior: "smooth" });
    }
  }, [activeIndex, editMode]);

  /* ---------- Seek helper works for both audio element and YT player ----- */
  const seekTo = (t) => {
    if (isYouTube) {
      const p = ytPlayerRef.current;
      if (p && p.seekTo) { p.seekTo(t, true); p.playVideo && p.playVideo(); }
    } else if (audioRef.current) {
      audioRef.current.currentTime = t;
      audioRef.current.play();
    }
    setCurrentTime(t);
  };

  /* ---------- Editing: update a line's time or text ---------- */
  const updateLine = (i, patch) => {
    setLyrics((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };
  const addLine = () => setLyrics((prev) => [...prev, { time: currentTime, text: "New lyric line" }]);
  const removeLine = (i) => setLyrics((prev) => prev.filter((_, idx) => idx !== i));

  /* ---------- Exports ---------- */
  const exportLRC = () => { downloadText("lyrics.lrc", buildLRC(lyrics)); showToast("Downloaded lyrics.lrc"); };
  const exportSRT = () => { downloadText("lyrics.srt", buildSRT(lyrics)); showToast("Downloaded lyrics.srt"); };

  return (
    <div className="result-layout">
      {/* -------------------- Player -------------------- */}
      <div className="panel player-card">
        <h3 className="section-title"><span>▶️</span> Player</h3>

        {isYouTube ? (
          // The YT IFrame API replaces this div with the real player.
          <div id="yt-player" className="yt-frame" />
        ) : (
          <>
            <div className={"audio-visual" + (playing ? " playing" : "")}>
              <div className="disc" />
            </div>
            <audio
              ref={audioRef}
              src={objectUrl || undefined}
              controls
              onTimeUpdate={(e) => setCurrentTime(e.target.currentTime)}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
            />
            {!objectUrl && (
              <p style={{ color: "var(--text-2)", fontSize: 13 }}>
                No local audio stream (demo). In production the backend returns
                an <code>audioUrl</code> to play here.
              </p>
            )}
          </>
        )}

        <div className="controls-row">
          <span className="time-display">🕒 {fmtClock(currentTime)}</span>
        </div>

        <button className="btn btn-ghost btn-lg" onClick={onReset} style={{ marginTop: 18 }}>
          ↩ Start over
        </button>
      </div>

      {/* -------------------- Lyrics -------------------- */}
      <div className="panel lyrics-card">
        <div className="lyrics-header">
          <h3 className="section-title" style={{ margin: 0 }}>
            <span>🎤</span> Synced Lyrics
          </h3>
          <div className="toolbar">
            <button
              className={"btn " + (editMode ? "btn-primary" : "btn-ghost")}
              onClick={() => setEditMode((v) => !v)}
            >
              {editMode ? "✓ Done editing" : "✎ Edit timestamps"}
            </button>
            <button className="btn btn-ghost" onClick={exportLRC}>⬇ .lrc</button>
            <button className="btn btn-ghost" onClick={exportSRT}>⬇ .srt</button>
          </div>
        </div>

        <div className="lyrics-scroll" ref={scrollRef}>
          {lyrics.map((line, i) => {
            const active = i === activeIndex;
            const past = i < activeIndex;
            return (
              <div
                key={i}
                ref={(el) => (lineRefs.current[i] = el)}
                className={"lyric-line" + (active ? " active" : past ? " past" : "")}
                onClick={() => !editMode && seekTo(line.time)}
                title={editMode ? "" : "Click to jump to this line"}
              >
                {editMode ? (
                  <>
                    {/* Editable timestamp (accepts "M:SS.xx" or seconds) */}
                    <input
                      className="lyric-edit-input"
                      defaultValue={fmtClock(line.time)}
                      onBlur={(e) => updateLine(i, { time: parseClockInput(e.target.value) })}
                    />
                    <input
                      className="lyric-text-input"
                      value={line.text}
                      onChange={(e) => updateLine(i, { text: e.target.value })}
                    />
                    <button
                      className="btn btn-ghost"
                      style={{ padding: "4px 10px" }}
                      onClick={() => removeLine(i)}
                      title="Delete line"
                    >✕</button>
                  </>
                ) : (
                  <>
                    <span className="lyric-time">{fmtClock(line.time)}</span>
                    <span className="lyric-text">{line.text}</span>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {editMode && (
          <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={addLine}>
            + Add line at current time ({fmtClock(currentTime)})
          </button>
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/* ============================== Root App =================================== */
function App() {
  const [stage, setStage] = useState("input"); // input | processing | result

  // Inputs
  const [audioFile, setAudioFile] = useState(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [rawLyrics, setRawLyrics] = useState("");

  // Processing UI state
  const [steps, setSteps] = useState([]);
  const [progKey, setProgKey] = useState(null);
  const [progMsg, setProgMsg] = useState("");
  const [error, setError] = useState("");

  // Output
  const [result, setResult] = useState(null); // media descriptor for the player
  const [lyrics, setLyrics] = useState([]);    // [{ time, text }]

  const hasMedia = !!audioFile || !!youtubeUrl.trim();
  const hasLyrics = rawLyrics.trim().length > 0;
  // Mode A when the user supplies lyrics, Mode B (ASR) otherwise.
  const mode = hasLyrics ? "A" : "B";

  // percent for the progress bar, derived from step position.
  const percent = steps.length
    ? Math.round(((steps.indexOf(progKey) + 1) / steps.length) * 100)
    : 0;

  const onProgress = useCallback((key, msg) => {
    setProgKey(key);
    setProgMsg(msg);
  }, []);

  const run = async () => {
    setError("");
    if (!hasMedia) {
      setError("Please add an audio file or a YouTube URL first.");
      return;
    }

    // Decide the sequence of steps to display for this run.
    const pipeline = [];
    if (youtubeUrl.trim()) pipeline.push("extract");
    if (mode === "A") pipeline.push("upload", "align", "timestamps");
    else pipeline.push("upload", "transcribe", "timestamps");
    setSteps(pipeline);
    setStage("processing");

    try {
      // 1) Resolve the media source (YouTube extraction or local file).
      let media;
      if (youtubeUrl.trim()) {
        media = await API.extractAudioFromYouTube(youtubeUrl.trim(), onProgress);
      } else {
        media = { type: "file", file: audioFile, durationSec: 54 };
      }

      // 2) Generate lyrics via the appropriate mode.
      let lines;
      if (mode === "A") {
        lines = await API.alignLyricsToAudio(media, rawLyrics, onProgress);
      } else {
        lines = await API.transcribeAudio(media, onProgress);
      }

      setResult(media);
      setLyrics(lines);
      setStage("result");
    } catch (e) {
      console.error(e);
      setError("Something went wrong while processing. Please try again.");
      setStage("input");
    }
  };

  const reset = () => {
    setStage("input");
    setResult(null);
    setLyrics([]);
    setProgKey(null);
    setSteps([]);
  };

  return (
    <div className="app">
      <header className="header">
        <div className="logo"><LogoMark /></div>
        <div className="brand">
          <h1>LyricSync</h1>
          <p>AI time-synced lyrics generator</p>
        </div>
      </header>

      <p className="tagline">
        Upload an audio file or paste a YouTube link and get perfectly
        time-stamped lyrics. Provide your own lyrics for precise alignment, or
        let the AI transcribe them from scratch — then fine-tune and export to{" "}
        <strong>.lrc</strong> or <strong>.srt</strong>.
      </p>

      {stage === "input" && (
        <>
          <div className="grid">
            <MediaInput
              audioFile={audioFile}
              setAudioFile={setAudioFile}
              youtubeUrl={youtubeUrl}
              setYoutubeUrl={setYoutubeUrl}
            />
            <LyricsInput rawLyrics={rawLyrics} setRawLyrics={setRawLyrics} />
          </div>

          <div className="panel" style={{ marginTop: 20 }}>
            <div className="mode-note">
              Detected mode:{" "}
              {mode === "A" ? (
                <><strong>Mode A · Forced Alignment</strong> — your lyrics will be timed to the audio.</>
              ) : (
                <><strong>Mode B · Auto-Transcribe (ASR)</strong> — lyrics will be transcribed and timed automatically.</>
              )}
            </div>

            {error && (
              <p style={{ color: "var(--danger)", fontSize: 14, marginTop: 12 }}>{error}</p>
            )}

            <button
              className="btn btn-primary btn-lg"
              onClick={run}
              disabled={!hasMedia}
            >
              · Generate synced lyrics
            </button>
          </div>
        </>
      )}

      {stage === "processing" && (
        <Processing steps={steps} currentKey={progKey} message={progMsg} percent={percent} />
      )}

      {stage === "result" && result && (
        <Result result={result} lyrics={lyrics} setLyrics={setLyrics} onReset={reset} />
      )}

      <p className="footer-note">
        Demo build — AI calls are mocked in <code>api.js</code>. See{" "}
        <code>README.md</code> for how to wire up Whisper / Deepgram / forced
        alignment through your backend.
      </p>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
