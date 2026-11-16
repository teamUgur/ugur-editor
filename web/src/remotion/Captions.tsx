// Reel 11 caption style. The same component draws the browser preview and the final render.
import {AbsoluteFill, OffthreadVideo, Series, useCurrentFrame, useVideoConfig} from 'remotion';
import {loadFont as loadInter} from '@remotion/google-fonts/Inter';
import {loadFont as loadCormorant} from '@remotion/google-fonts/CormorantGaramond';

const inter = loadInter('normal', {weights: ['800'], subsets: ['latin', 'cyrillic']}).fontFamily;
const serif = loadCormorant('italic', {weights: ['500'], subsets: ['latin', 'cyrillic']}).fontFamily;

export type Group = {id: string; text: string; start: number; end: number; key: boolean; keyProb?: number; unsure?: boolean};
export type Cut = {from: number; to: number; gid?: string};   // seconds of the source video; gid = cut made from a caption row
export type Pos = {x: number; y: number};                   // caption centre in frame pixels
export type CaptionProps = {src: string; groups: Group[]; fps: number; duration: number; cuts?: Cut[]; pos?: Pos};

export const W = 1080;
export const H = 1920;
export const DEFAULT_POS: Pos = {x: W / 2, y: 1390};   // under the chin on unshifted talking-head footage
const SIZE = 84;            // Inter ExtraBold, tracking -3%
const KEY_SIZE = SIZE * 1.5; // the keyword in Cormorant Italic
const FADE = 2;             // frames of audio fade at each cut, so cuts don't click

// Each group stays on screen until the next one starts, so every frame carries a caption.
export const groupAt = (groups: Group[], t: number) => {
  let cur = groups[0];
  for (const g of groups) {
    if (g.start <= t) cur = g;
    else break;
  }
  return cur;
};

// Kept pieces of the source in frames [a, b), after removing every cut.
export type Seg = {a: number; b: number};
export const keptSegments = (cuts: Cut[] | undefined, duration: number, fps: number): Seg[] => {
  const total = Math.max(1, Math.round(duration * fps));
  const ranges = (cuts ?? [])
    .map(c => ({a: Math.max(0, Math.round(c.from * fps)), b: Math.min(total, Math.round(c.to * fps))}))
    .filter(r => r.b > r.a)
    .sort((x, y) => x.a - y.a);
  const segs: Seg[] = [];
  let at = 0;
  for (const r of ranges) {
    if (r.a > at) segs.push({a: at, b: r.a});
    at = Math.max(at, r.b);
  }
  if (at < total) segs.push({a: at, b: total});
  return segs.length ? segs : [{a: 0, b: 1}];
};

export const outLength = (segs: Seg[]) => segs.reduce((n, s) => n + s.b - s.a, 0);

export const outToSrc = (segs: Seg[], f: number) => {
  for (const s of segs) {
    if (f < s.b - s.a) return s.a + f;
    f -= s.b - s.a;
  }
  return segs[segs.length - 1].b - 1;
};

// Source frame -> output frame; a frame inside a cut maps to the start of the next kept piece.
export const srcToOut = (segs: Seg[], f: number) => {
  let out = 0;
  for (const s of segs) {
    if (f < s.b) return out + Math.max(0, f - s.a);
    out += s.b - s.a;
  }
  return Math.max(0, out - 1);
};

export const Captions: React.FC<CaptionProps> = ({src, groups, duration, cuts, pos}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const segs = keptSegments(cuts, duration, fps);
  const t = outToSrc(segs, frame) / fps;
  const g = groups.length ? groupAt(groups, t) : undefined;
  const p = pos ?? DEFAULT_POS;

  return (
    <AbsoluteFill style={{background: '#000'}}>
      {src ? (
        <Series>
          {segs.map(s => {
            const len = s.b - s.a;
            return (
              <Series.Sequence key={s.a} durationInFrames={len}>
                <OffthreadVideo
                  src={src}
                  trimBefore={s.a}
                  durationInFrames={len}
                  volume={f => (segs.length > 1 ? Math.min(1, (f + 1) / FADE, (len - f) / FADE) : 1)}
                  style={{width: '100%', height: '100%', objectFit: 'cover'}}
                />
              </Series.Sequence>
            );
          })}
        </Series>
      ) : null}
      {g ? (
        <div style={{position: 'absolute', left: p.x, top: p.y, transform: 'translate(-50%, -50%)', width: W - 120, textAlign: 'center'}}>
          <span style={{
            color: '#fff',
            fontFamily: g.key ? serif : inter,
            fontWeight: g.key ? 500 : 800,
            fontStyle: g.key ? 'italic' : 'normal',
            fontSize: g.key ? KEY_SIZE : SIZE,
            letterSpacing: g.key ? 0 : '-0.03em',
            lineHeight: 1.05,
            textShadow: '0 0 14px rgba(0,0,0,.55), 0 0 28px rgba(0,0,0,.55)',
          }}>{g.text}</span>
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
