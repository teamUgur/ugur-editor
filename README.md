# Ugur Editor

> **Status: stopped on 2026-11-16.** Ugur decided not to continue this project. The reason: anyone can get the same result by asking Claude Code to caption a video, so a separate tool adds little value. The code works as it is (import, captions, Jev keywords, review page, render) and stays here as a reference. Caption dragging and video cutting were started but not finished.

Local auto-caption tool for Ugur's Reels. Drop a video on the page and it transcribes the speech, splits it into 1-2 word captions in the Reel 11 style, and marks a keyword in each phrase in serif italic. You review the captions and render an MP4.

## Run

```bash
./start
```

This builds the review page and opens http://localhost:8765. Rendered videos go to `marketing/editing/Done videos/<name>-captions.mp4`.

## How it works

1. **Import:** any video ffmpeg can read is copied into `projects/<id>/` and converted to an H.264 proxy (`video.mp4`).
2. **Transcribe:** whisper.cpp (`large-v3-turbo`, Russian) gives a start and end for every word. Starts are moved to the first 50 ms of real voice, because Whisper often starts words too early.
3. **Group (Reel 11 rules):** one word per caption. A short word (2 letters or less) joins the next one, and a number joins the word after it ("100 часов"). Each caption stays until the next one starts, so every frame has a caption.
4. **Keywords:** groups are split into phrases (sentence end, a pause of 0.5 s, or 6 groups). TypeSafe Jev (OpenRouter Decisions API) picks one keyword per phrase. Picks with low confidence are flagged "check".
5. **Review:** click a caption to switch it between normal and keyword, double-click to fix the text, click the time to jump there. Edits save automatically.
6. **Render:** Remotion renders the same `Captions` component used in the preview to a 1080x1920 MP4.

## Style

- Normal word: Inter ExtraBold 84 px, tracking -3%, white, soft shadow.
- Keyword: Cormorant Garamond Medium Italic, 1.5x size.
- Always centred on y 960, the vertical middle of the frame. Words just appear, no animation.

The style lives in `web/src/remotion/Captions.tsx`.

## Requirements

- macOS with `ffmpeg` and `whisper-cli` (Homebrew `whisper-cpp`).
- Whisper model at `~/.cache/whisper.cpp/ggml-large-v3-turbo-q5_0.bin` (override with `WHISPER_MODEL`).
- Python 3 with `pip install -r backend/requirements.txt`.
- Node 20+.
- OpenRouter key in the macOS Keychain, service `codex.openrouter.jev`. Without it, captions still work and keywords are marked by hand.

## Privacy

Only the transcript text is sent to OpenRouter, for keyword picks. Videos and audio stay on this Mac. `projects/` is git-ignored.

## Layout

```
backend/   Python: FastAPI server, pipeline, grouping rules, Jev client
web/       React review page, Remotion composition, render.mjs
projects/  one folder per imported video (git-ignored)
start      one-command launcher
```
