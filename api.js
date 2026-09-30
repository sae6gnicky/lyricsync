/* ============================================================================
   LyricSync — Mocked AI/Backend API layer
   ----------------------------------------------------------------------------
   Everything here is a FRONTEND MOCK. Each function simulates a real network
   call with setTimeout + dummy data and reports progress via an onProgress
   callback. To ship for real, replace the mock bodies with the fetch() calls
   sketched in the "INTEGRATION:" comment blocks (and move secrets/keys to a
   backend — never call paid AI APIs directly from the browser with a key).

   Exposed on window.LyricSyncAPI:
     - extractAudioFromYouTube(url, onProgress)
     - transcribeAudio(audioSource, onProgress)          // Mode B  (ASR)
     - alignLyricsToAudio(audioSource, rawLyrics, onProgress) // Mode A (forced alignment)
   ============================================================================ */

(function () {
  "use strict";

  // Small helper: resolve after `ms`, useful for simulating latency.
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));

  /* --------------------------------------------------------------------------
     DUMMY DATA
     Two sample transcripts so the UI has realistic content to render.
     Timestamps are in seconds. Each item: { time, text }.
     -------------------------------------------------------------------------- */
  const DUMMY_TRANSCRIPTION = [
    { time: 0.0,  text: "Yeah, we lit up the city lights tonight" },
    { time: 4.2,  text: "Chasing every echo down the boulevard" },
    { time: 8.6,  text: "Neon rivers running through my mind" },
    { time: 12.9, text: "I can feel the rhythm in my heart" },
    { time: 17.4, text: "So take my hand, we'll dance until the dawn" },
    { time: 21.8, text: "Nothing gonna stop us, we belong" },
    { time: 26.3, text: "Under skies of purple and of gold" },
    { time: 30.7, text: "This is a story that will never grow old" },
    { time: 35.5, text: "Oh-oh-oh, we're electric tonight" },
    { time: 40.0, text: "Oh-oh-oh, everything feels so right" },
    { time: 44.6, text: "Turn it up until the morning comes" },
    { time: 49.1, text: "We are the melody, we are the drums" },
  ];

  /* --------------------------------------------------------------------------
     extractAudioFromYouTube
     Mode: used when the user pastes a YouTube URL.
     Real job: server extracts an audio stream from the video.
     -------------------------------------------------------------------------- */
  async function extractAudioFromYouTube(url, onProgress) {
    onProgress && onProgress("extract", "Extracting audio from YouTube…");

    // --- MOCK: pretend the server downloaded & converted the audio ----------
    await wait(1800);

    // Parse the video id so the UI can embed the real YouTube player.
    const videoId = parseYouTubeId(url);

    /* INTEGRATION: replace the mock above with a call to YOUR backend, which
       does the actual extraction (doing this client-side is not feasible and
       often violates YouTube ToS — always proxy through a server you control).

       Example backend contract:

         const res = await fetch("/api/youtube/extract", {
           method: "POST",
           headers: { "Content-Type": "application/json" },
           body: JSON.stringify({ url }),
         });
         if (!res.ok) throw new Error("Extraction failed");
         const data = await res.json();
         // => { audioUrl: "https://.../audio.mp3", videoId, durationSec }

       Server-side you might use yt-dlp / youtube-dl + ffmpeg, or a hosted
       "YouTube to MP3" API. Return a temporary signed URL to the audio file
       plus the videoId (so the frontend can embed the player).
    */
    return {
      type: "youtube",
      videoId,
      // In a real app this would be the extracted-audio URL from your backend.
      audioUrl: null,
      durationSec: 54,
    };
  }

  /* --------------------------------------------------------------------------
     transcribeAudio  — MODE B (media only, no lyrics provided)
     Real job: run Automatic Speech Recognition to produce text + timestamps.
     -------------------------------------------------------------------------- */
  async function transcribeAudio(audioSource, onProgress) {
    onProgress && onProgress("upload", "Uploading audio to transcription service…");
    await wait(1200);

    onProgress && onProgress("transcribe", "Transcribing lyrics with AI (ASR)…");
    await wait(2600);

    onProgress && onProgress("timestamps", "Generating timestamps from scratch…");
    await wait(1600);

    /* INTEGRATION: swap the mock for a real ASR call. Do this from a BACKEND
       so your API key stays secret. Two common providers:

       ── OpenAI Whisper (verbose_json gives per-segment timestamps) ──────────
         // On your server:
         const form = new FormData();
         form.append("file", audioFileStream);
         form.append("model", "whisper-1");
         form.append("response_format", "verbose_json");
         form.append("timestamp_granularities[]", "segment");
         const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
           method: "POST",
           headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
           body: form,
         });
         const json = await r.json();
         // Map json.segments -> [{ time: seg.start, text: seg.text.trim() }]

       ── Deepgram (pre-recorded, word/utterance timings) ─────────────────────
         const r = await fetch("https://api.deepgram.com/v1/listen?utterances=true", {
           method: "POST",
           headers: {
             Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
             "Content-Type": "audio/mpeg",
           },
           body: audioBuffer,
         });
         const json = await r.json();
         // Map json.results.utterances -> [{ time: u.start, text: u.transcript }]

       Then expose it to the frontend as e.g. POST /api/transcribe returning
       { lines: [{ time, text }, ...] }, and here you'd do:
         const res = await fetch("/api/transcribe", { method: "POST", body: form });
         const { lines } = await res.json();
         return lines;
    */
    return DUMMY_TRANSCRIPTION.map((l) => ({ ...l })); // clone to keep mock pristine
  }

  /* --------------------------------------------------------------------------
     alignLyricsToAudio — MODE A (media + user-provided raw lyrics)
     Real job: "forced alignment" — attach accurate timestamps to lines the
     user already wrote (higher accuracy than transcribing from scratch).
     -------------------------------------------------------------------------- */
  async function alignLyricsToAudio(audioSource, rawLyrics, onProgress) {
    onProgress && onProgress("upload", "Uploading audio + lyrics for alignment…");
    await wait(1200);

    onProgress && onProgress("align", "Aligning your lyrics to the audio track…");
    await wait(2800);

    onProgress && onProgress("timestamps", "Attaching precise timestamps to each line…");
    await wait(1400);

    // Split the user's raw lyrics into non-empty lines.
    const lines = rawLyrics
      .split("
")
      .map((s) => s.trim())
      .filter(Boolean);

    /* --- MOCK: distribute lines evenly across the (assumed) track duration ---
       This is ONLY to make the demo look plausible. A real aligner returns the
       true start time of each line based on the audio.                        */
    const durationSec = (audioSource && audioSource.durationSec) || 54;
    const step = durationSec / Math.max(lines.length, 1);
    const aligned = lines.map((text, i) => ({
      time: +(i * step).toFixed(2),
      text,
    }));

    /* INTEGRATION: replace with a real forced-alignment service (again, from a
       backend). Options:
         • gentle (Kaldi-based forced aligner, self-hosted)
         • aeneas (Python, text-to-audio alignment)
         • WhisperX (Whisper + wav2vec2 alignment for word-level timings)
         • ElevenLabs / AssemblyAI alignment endpoints

       Example backend contract:
         const form = new FormData();
         form.append("audio", audioFile);
         form.append("transcript", rawLyrics);
         const res = await fetch("/api/align", { method: "POST", body: form });
         const { lines } = await res.json();  // [{ time, text }]
         return lines;
    */
    return aligned;
  }

  /* --------------------------------------------------------------------------
     Utility: pull the 11-char video id out of common YouTube URL shapes.
     -------------------------------------------------------------------------- */
  function parseYouTubeId(url) {
    if (!url) return null;
    const patterns = [
      /(?:youtube\.com\/watch\?v=)([\w-]{11})/,
      /(?:youtu\.be\/)([\w-]{11})/,
      /(?:youtube\.com\/embed\/)([\w-]{11})/,
      /(?:youtube\.com\/shorts\/)([\w-]{11})/,
    ];
    for (const re of patterns) {
      const m = url.match(re);
      if (m) return m[1];
    }
    // Fallback: assume any bare 11-char token is an id.
    const bare = url.trim().match(/^[\w-]{11}$/);
    return bare ? bare[0] : null;
  }

  // Expose the mock API globally so app.js can use it without a bundler.
  window.LyricSyncAPI = {
    extractAudioFromYouTube,
    transcribeAudio,
    alignLyricsToAudio,
    parseYouTubeId,
  };
})();
