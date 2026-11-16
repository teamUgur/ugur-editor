import {useCallback, useEffect, useRef, useState} from 'react';
import {Player, PlayerRef} from '@remotion/player';
import {Captions, Group, H, W, groupAt} from './remotion/Captions';

type Summary = {id: string; name: string; status: string; duration?: number; output?: string};
type Project = Summary & {groups: Group[]; fps: number; duration: number; error?: string; jev?: {cost?: number; error?: string}};

const BUSY = ['queued', 'converting', 'transcribing', 'keywords', 'rendering'];
const STATUS: Record<string, string> = {
  queued: 'Queued', converting: 'Converting video', transcribing: 'Transcribing', keywords: 'Picking keywords',
  ready: 'Ready for review', rendering: 'Rendering', rendered: 'Rendered', error: 'Error',
};

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

export const App = () => {
  const [list, setList] = useState<Summary[]>([]);
  const [pid, setPidState] = useState<string | null>(() => location.hash.slice(1) || null);
  const setPid = (id: string) => { setPidState(id); history.replaceState(null, '', `#${id}`); };
  const [p, setP] = useState<Project | null>(null);
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState(false);

  const loadList = useCallback(async () => {
    const r = await fetch('/api/projects');
    setList(await r.json());
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  // Poll the open project while the pipeline or a render is running.
  useEffect(() => {
    if (!pid) return;
    let stop = false;
    const tick = async () => {
      const r = await fetch(`/api/projects/${pid}`);
      if (!r.ok || stop) return;
      const d: Project = await r.json();
      setP(prev => (prev && prev.id === d.id && !BUSY.includes(prev.status) && !BUSY.includes(d.status) ? {...d, groups: prev.groups} : d));
      if (BUSY.includes(d.status)) setTimeout(tick, 1500);
      else loadList();
    };
    tick();
    return () => { stop = true; };
  }, [pid, p?.status === 'rendering', loadList]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    let last = '';
    for (const f of Array.from(files)) {
      const fd = new FormData();
      fd.append('file', f);
      const r = await fetch('/api/projects', {method: 'POST', body: fd});
      last = (await r.json()).id;
    }
    setUploading(false);
    await loadList();
    setPid(last);
  };

  return (
    <div className="app"
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={e => { if (e.currentTarget === e.target) setDrag(false); }}
      onDrop={e => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}>
      <aside className="side">
        <div className="brand">Ugur Editor</div>
        <label className="drop">
          <input type="file" accept="video/*,.mov,.mkv" multiple hidden onChange={e => upload(e.target.files)} />
          <strong>{uploading ? 'Uploading…' : 'Drop a video'}</strong>
          <span>or click to choose. MOV, MP4, any format</span>
        </label>
        <div className="list">
          {list.map(s => (
            <button key={s.id} className={`item ${s.id === pid ? 'on' : ''}`} onClick={() => setPid(s.id)}>
              <span className="name">{s.name}</span>
              <span className={`st ${s.status}`}>{STATUS[s.status] ?? s.status}</span>
            </button>
          ))}
          {!list.length && <p className="empty">No videos yet.</p>}
        </div>
      </aside>
      <main className="main">
        {p ? <Editor key={p.id} p={p} setP={setP} /> : <div className="hint">Drop a video anywhere on this page to start.</div>}
      </main>
      {drag && <div className="dragover">Drop to import</div>}
    </div>
  );
};

const Editor = ({p, setP}: {p: Project; setP: (f: (x: Project | null) => Project | null) => void}) => {
  const player = useRef<PlayerRef>(null);
  const [t, setT] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const saveTimer = useRef<number>(0);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const ready = p.status === 'ready' || p.status === 'rendered';
  const frames = Math.max(1, Math.round((p.duration || 1) * (p.fps || 30)));

  useEffect(() => {
    const pl = player.current;
    if (!pl) return;
    const on = (e: {detail: {frame: number}}) => setT(e.detail.frame / (p.fps || 30));
    pl.addEventListener('frameupdate', on);
    return () => pl.removeEventListener('frameupdate', on);
  }, [ready, p.fps]);

  const active = p.groups.length ? groupAt(p.groups, t) : undefined;
  useEffect(() => {
    if (active && player.current?.isPlaying()) rowRefs.current[active.id]?.scrollIntoView({block: 'nearest'});
  }, [active?.id]);

  const update = (groups: Group[]) => {
    setP(x => (x ? {...x, groups} : x));
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      fetch(`/api/projects/${p.id}/groups`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({groups})});
    }, 400);
  };

  const toggleKey = (id: string) => update(p.groups.map(g => (g.id === id ? {...g, key: !g.key, unsure: false} : g)));
  const setText = (id: string, text: string) => update(p.groups.map(g => (g.id === id ? {...g, text} : g)));
  const seek = (g: Group) => player.current?.seekTo(Math.round(g.start * p.fps) + 1);

  const render = async () => {
    window.clearTimeout(saveTimer.current);
    await fetch(`/api/projects/${p.id}/groups`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({groups: p.groups})});
    await fetch(`/api/projects/${p.id}/render`, {method: 'POST'});
    setP(x => (x ? {...x, status: 'rendering'} : x));
  };

  if (!ready && p.status !== 'rendering') {
    return (
      <div className="hint">
        {p.status === 'error' ? <><b>Something failed.</b><pre>{p.error}</pre></> : <><div className="spin" />{STATUS[p.status] ?? p.status}…</>}
      </div>
    );
  }

  const keys = p.groups.filter(g => g.key).length;
  const unsure = p.groups.filter(g => g.unsure).length;

  return (
    <div className="editor">
      <section className="stage">
        <Player
          ref={player}
          component={Captions}
          inputProps={{src: `/files/${p.id}/video.mp4`, groups: p.groups, fps: p.fps, duration: p.duration}}
          durationInFrames={frames}
          fps={p.fps}
          compositionWidth={W}
          compositionHeight={H}
          controls
          clickToPlay
          style={{height: 'calc(100vh - 120px)', aspectRatio: '9 / 16', borderRadius: 14, overflow: 'hidden'}}
        />
        <div className="bar">
          <button className="render" disabled={p.status === 'rendering'} onClick={render}>
            {p.status === 'rendering' ? 'Rendering…' : 'Render MP4'}
          </button>
          {p.status === 'rendered' && p.output && <span className="out">Saved: {p.output.split('/').slice(-2).join('/')}</span>}
          {p.error && <span className="err">{p.error}</span>}
        </div>
      </section>
      <section className="groups">
        <header>
          <b>{p.groups.length} captions</b>
          <span>{keys} keywords{unsure ? ` · ${unsure} to check` : ''}</span>
          {p.jev?.error && <span className="err">Keywords failed: {p.jev.error}</span>}
        </header>
        <p className="help">Click a caption to make it the keyword. Double-click to fix the text. Click the time to jump there.</p>
        <div className="rows">
          {p.groups.map(g => (
            <div key={g.id} ref={el => { rowRefs.current[g.id] = el; }} className={`row ${g.key ? 'key' : ''} ${g.unsure ? 'unsure' : ''} ${active?.id === g.id ? 'now' : ''}`}>
              <button className="time" onClick={() => seek(g)}>{fmt(g.start)}</button>
              {editing === g.id ? (
                <input autoFocus defaultValue={g.text}
                  onBlur={e => { setText(g.id, e.target.value.trim() || g.text); setEditing(null); }}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur(); }} />
              ) : (
                <button className="text" onClick={() => toggleKey(g.id)} onDoubleClick={() => setEditing(g.id)}>{g.text}</button>
              )}
              {g.unsure && <span className="flag" title="Jev was not sure about this keyword">check</span>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
