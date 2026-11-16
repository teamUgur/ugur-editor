"""Keyword picks with TypeSafe Jev through OpenRouter's Decisions API.
The key is read from the macOS Keychain (service codex.openrouter.jev), never stored in the project."""
import json
import ssl
import subprocess
import urllib.request

import certifi

URL = "https://openrouter.ai/api/alpha/decisions"
MODEL = "typesafe/jev-1.13"
KEYCHAIN_SERVICE = "codex.openrouter.jev"
BATCH = 15              # phrases per request
UNSURE_BELOW = 0.45     # confidence under this gets flagged for review


def _key():
    r = subprocess.run(["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"OpenRouter key not found in Keychain service {KEYCHAIN_SERVICE}")
    return r.stdout.strip()


def _ask(key, state, questions):
    body = json.dumps({"model": MODEL, "state": state, "questions": questions}).encode()
    req = urllib.request.Request(URL, data=body, method="POST", headers={
        "Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60, context=ssl.create_default_context(cafile=certifi.where())) as r:
        return json.loads(r.read())


def pick_keywords(groups, phrases):
    """Marks one group per phrase as the keyword. Writes key, keyProb and unsure into groups.
    Returns {"cost": float, "requests": [ids]}."""
    key = _key()
    script = " ".join(g["text"] for g in groups)
    state = ("Russian Reels voice-over, split into caption groups shown one at a time. "
             f"Full script: {script}")
    cost, ids = 0.0, []
    multi = [(n, p) for n, p in enumerate(phrases) if len(p) > 1]
    for b in range(0, len(multi), BATCH):
        questions = {}
        for n, p in multi[b:b + BATCH]:
            line = " | ".join(groups[i]["text"] for i in p)
            questions[f"p{n}"] = {
                "type": "choice",
                "instructions": (f"Phrase: «{line}». Which caption group carries the main meaning of this phrase "
                                 "and should be emphasized in big serif italic? Prefer the concrete noun, number, "
                                 "result or payoff word, never a filler, pronoun or preposition."),
                "criteria": {f"g{j}": groups[i]["text"] for j, i in enumerate(p)},
            }
        res = _ask(key, state, questions)
        ids.append(res.get("id"))
        cost += res.get("usage", {}).get("cost", 0) or 0
        for qid, ans in res["answers"].items():
            p = phrases[int(qid[1:])]
            j = int(ans["choice"][1:])
            g = groups[p[j]]
            g["key"] = True
            g["keyProb"] = ans["probabilities"].get(ans["choice"])
            g["unsure"] = ans.get("confidence", 1) < UNSURE_BELOW
    return {"cost": round(cost, 6), "requests": ids}
