"""Turn Whisper word timings into caption groups (Reel 11 rules) and phrases for keyword picks."""
import re

FIX = {"еще": "ещё"}
PUNCT = ",.!?;:…«»\"“”"
MAX_CHARS = 18          # one or two words, never wider than the frame at 84 px
JOIN_GAP = 0.3          # a short word rides with the next one only when it follows quickly
PHRASE_GAP = 0.5        # a pause this long starts a new phrase
PHRASE_MAX = 6          # groups per phrase, so every few seconds get one keyword
MIN_SHOW = 0.15         # seconds; Whisper sometimes gives a word zero length


def clean_words(raw):
    """raw: [{"w", "s", "e"}] from Whisper, seconds. Drops empty tokens, glues "-то" style tails."""
    out = []
    for w in raw:
        txt = w["w"].strip()
        if not txt:
            continue
        end_of_sentence = txt[-1] in ".!?…"
        bare = txt.strip(PUNCT)
        if not bare:
            if out and end_of_sentence:
                out[-1]["eos"] = True
            continue
        bare = FIX.get(bare, bare)
        if bare.startswith("-") and out:
            out[-1]["w"] += bare
            out[-1]["e"] = w["e"]
            out[-1]["eos"] = end_of_sentence
            continue
        out.append({"w": bare, "s": w["s"], "e": w["e"], "eos": end_of_sentence})
    return out


def _is_num(t):
    return bool(re.match(r"^\d", t))


def make_groups(words):
    """Reel 11 rules: one word per group; a short word (2 letters or less) joins the next one;
    a number joins the word after it ("4 агента", "100 часов"). Each group stays on screen until the next starts."""
    groups, k = [], 0
    while k < len(words):
        cur = words[k]
        items = [cur]
        if k + 1 < len(words):
            nxt = words[k + 1]
            short = len(cur["w"]) <= 2 and not _is_num(cur["w"]) and nxt["s"] - cur["e"] < JOIN_GAP
            unit = _is_num(cur["w"]) and nxt["s"] - cur["e"] < 0.6       # "4 агента", "100 часов", "30 лет"
            fits = len(cur["w"]) + 1 + len(nxt["w"]) <= MAX_CHARS
            if (short or unit) and fits and not cur.get("eos"):
                items.append(nxt)
        text = " ".join(i["w"] for i in items)
        groups.append({
            "id": f"g{len(groups)}",
            "text": text,
            "start": round(items[0]["s"], 3),
            "end": round(items[-1]["e"], 3),
            "eos": bool(items[-1].get("eos")),
            "key": False,
        })
        k += len(items)
    for a, b in zip(groups, groups[1:]):       # every group gets at least MIN_SHOW on screen
        b["start"] = round(max(b["start"], a["start"] + MIN_SHOW), 3)
        b["end"] = max(b["end"], b["start"])
    return groups


def make_phrases(groups):
    """Split groups into phrases: sentence ends, long pauses, or PHRASE_MAX groups."""
    phrases, cur = [], []
    for i, g in enumerate(groups):
        if cur:
            gap = g["start"] - groups[i - 1]["end"]
            if groups[i - 1]["eos"] or gap >= PHRASE_GAP or len(cur) >= PHRASE_MAX:
                phrases.append(cur)
                cur = []
        cur.append(i)
    if cur:
        phrases.append(cur)
    return phrases
