"""Local API for the review page: import videos, read and save captions, start renders."""
import json
import os
import subprocess
import tempfile
import threading
import time
import uuid

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import pipeline

ROOT = pipeline.ROOT
WEB = os.path.join(ROOT, "web")
DONE = os.path.expanduser(os.environ.get(
    "DONE_DIR", "~/Documents/private-ugur-python-projects/marketing/editing/Done videos"))
PORT = int(os.environ.get("PORT", "8765"))

os.makedirs(pipeline.PROJECTS, exist_ok=True)
app = FastAPI()
app.mount("/files", StaticFiles(directory=pipeline.PROJECTS), name="files")


def _exists(pid):
    if not os.path.exists(os.path.join(pipeline.pdir(pid), "project.json")):
        raise HTTPException(404, "project not found")


@app.get("/api/projects")
def list_projects():
    out = []
    for pid in os.listdir(pipeline.PROJECTS):
        try:
            d = pipeline.load(pid)
        except (FileNotFoundError, NotADirectoryError, json.JSONDecodeError):
            continue
        out.append({k: d.get(k) for k in ("id", "name", "status", "created", "duration", "output")})
    return sorted(out, key=lambda p: p.get("created") or 0, reverse=True)


@app.post("/api/projects")
def import_video(file: UploadFile):
    pid = time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:4]
    fd, tmp = tempfile.mkstemp(dir=pipeline.PROJECTS)
    with os.fdopen(fd, "wb") as f:
        while chunk := file.file.read(1 << 20):
            f.write(chunk)
    pipeline.create(pid, file.filename or "video.mov", tmp)
    d = pipeline.load(pid)
    d["created"] = time.time()
    pipeline.save(pid, d)
    threading.Thread(target=pipeline.run, args=(pid,), daemon=True).start()
    return {"id": pid}


@app.get("/api/projects/{pid}")
def get_project(pid: str):
    _exists(pid)
    return pipeline.load(pid)


class Groups(BaseModel):
    groups: list[dict]


@app.put("/api/projects/{pid}/groups")
def save_groups(pid: str, body: Groups):
    _exists(pid)
    d = pipeline.load(pid)
    d["groups"] = body.groups
    pipeline.save(pid, d)
    return {"ok": True}


def _render(pid):
    d = pipeline.load(pid)
    os.makedirs(DONE, exist_ok=True)
    out = os.path.join(DONE, f"{d['name']}-captions.mp4")
    props = {"src": f"http://localhost:{PORT}/files/{pid}/video.mp4", "groups": d["groups"],
             "fps": d["fps"], "duration": d["duration"]}
    props_path = os.path.join(pipeline.pdir(pid), "render-props.json")
    with open(props_path, "w") as f:
        json.dump(props, f, ensure_ascii=False)
    log = open(os.path.join(pipeline.pdir(pid), "render.log"), "w")
    r = subprocess.run(["node", "render.mjs", props_path, out], cwd=WEB, stdout=log, stderr=subprocess.STDOUT)
    if r.returncode == 0:
        pipeline.status(pid, "rendered", output=out)
    else:
        pipeline.status(pid, "ready", error="render failed, see render.log in the project folder")


@app.post("/api/projects/{pid}/render")
def render(pid: str):
    _exists(pid)
    d = pipeline.load(pid)
    if d["status"] not in ("ready", "rendered"):
        raise HTTPException(409, f"project is {d['status']}")
    pipeline.status(pid, "rendering", error=None)
    threading.Thread(target=_render, args=(pid,), daemon=True).start()
    return {"ok": True}


dist = os.path.join(WEB, "dist")
if os.path.isdir(dist):
    app.mount("/", StaticFiles(directory=dist, html=True), name="web")
