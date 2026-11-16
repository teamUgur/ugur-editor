"""Import -> proxy video -> Whisper words -> snap starts to the voice -> groups -> Jev keywords -> captions.json."""
import json
import os
import shutil
import subprocess
import wave

import numpy as np

import grouping
import jev

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECTS = os.path.join(ROOT, "projects")
MODEL = os.path.expanduser(os.environ.get("WHISPER_MODEL", "~/.cache/whisper.cpp/ggml-large-v3-turbo-q5_0.bin"))
LANG = os.environ.get("WHISPER_LANG", "ru")
VOICE_DB = -34          # 10 ms RMS above this counts as voice (same threshold as the YouTube cutting rule)


def pdir(pid):
    return os.path.join(PROJECTS, pid)


def load(pid):
    with open(os.path.join(pdir(pid), "project.json")) as f:
        return json.load(f)


def save(pid, data):
    path = os.path.join(pdir(pid), "project.json")
    with open(path + ".tmp", "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    os.replace(path + ".tmp", path)


def status(pid, step, **extra):
    data = load(pid)
    data["status"] = step
    data.update(extra)
    save(pid, data)


def _run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"{cmd[0]} failed: {r.stderr[-800:]}")
    return r.stdout


def probe(path):
    out = json.loads(_run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                           "stream=width,height,r_frame_rate:format=duration", "-of", "json", path]))
    st = out["streams"][0]
    num, den = st["r_frame_rate"].split("/")
    return {"width": st["width"], "height": st["height"],
            "fps": round(int(num) / int(den), 3), "duration": float(out["format"]["duration"])}


def make_proxy(src, dst):
    """Any input ffmpeg reads -> H.264/AAC mp4 the browser player and Remotion can both use."""
    _run(["ffmpeg", "-v", "error", "-y", "-i", src, "-c:v", "libx264", "-preset", "veryfast", "-crf", "17",
          "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", dst])


def transcribe(video, work):
    wav = os.path.join(work, "audio.wav")
    _run(["ffmpeg", "-v", "error", "-y", "-i", video, "-ar", "16000", "-ac", "1", wav])
    base = os.path.join(work, "whisper")
    _run(["whisper-cli", "-m", MODEL, "-l", LANG, "-f", wav, "-ml", "1", "-sow", "-ojf", "-of", base, "-np"])
    with open(base + ".json") as f:
        segs = json.load(f)["transcription"]
    words = [{"w": s["text"], "s": s["offsets"]["from"] / 1000, "e": s["offsets"]["to"] / 1000} for s in segs]
    return words, wav


def snap_to_voice(words, wav):
    """Whisper often starts a word too early (first word at 0.14 s when he speaks at 1.3 s).
    Move each start forward to the first 50 ms of continuous voice inside the word (single clicks don't count)."""
    with wave.open(wav) as w:
        sr = w.getframerate()
        a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    hop = sr // 100
    n = len(a) // hop
    rms = np.sqrt(np.mean(a[:n * hop].reshape(n, hop) ** 2, axis=1) + 1e-12)
    loud = (20 * np.log10(rms) > VOICE_DB).astype(int)
    run = np.convolve(loud, np.ones(5, dtype=int), "full")[4:]      # 5 frames of voice in a row start here
    voiced = run[:n] == 5
    for k, wd in enumerate(words):
        nxt_end = words[k + 1]["e"] if k + 1 < len(words) else wd["e"] + 0.5
        i0, i1 = int(wd["s"] * 100), int(max(wd["e"], nxt_end - 0.1) * 100)   # no voice inside -> look a bit past it
        hits = np.nonzero(voiced[i0:i1])[0]
        if len(hits):
            wd["s"] = float((i0 + hits[0]) / 100)
            wd["e"] = max(wd["e"], wd["s"] + 0.05)
    return words


def run(pid):
    d = pdir(pid)
    data = load(pid)
    try:
        status(pid, "converting")
        video = os.path.join(d, "video.mp4")
        make_proxy(os.path.join(d, data["original"]), video)
        status(pid, "transcribing", **probe(video))

        raw, wav = transcribe(video, d)
        words = snap_to_voice(grouping.clean_words(raw), wav)
        groups = grouping.make_groups(words)
        phrases = grouping.make_phrases(groups)
        status(pid, "keywords", groups=groups)

        try:
            info = jev.pick_keywords(groups, phrases)
            status(pid, "ready", groups=groups, jev=info)
        except Exception as e:      # captions still work without keywords; the user can mark them by hand
            status(pid, "ready", groups=groups, jev={"error": str(e)})
    except Exception as e:
        status(pid, "error", error=str(e))


def create(pid, filename, src_path):
    d = pdir(pid)
    os.makedirs(d, exist_ok=True)
    ext = os.path.splitext(filename)[1].lower() or ".mov"
    shutil.move(src_path, os.path.join(d, "original" + ext))
    save(pid, {"id": pid, "name": os.path.splitext(filename)[0], "original": "original" + ext,
               "status": "queued", "groups": []})
