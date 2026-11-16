// Reel 11 caption style. The same component draws the browser preview and the final render.
import {AbsoluteFill, OffthreadVideo, useCurrentFrame, useVideoConfig} from 'remotion';
import {loadFont as loadInter} from '@remotion/google-fonts/Inter';
import {loadFont as loadCormorant} from '@remotion/google-fonts/CormorantGaramond';

const inter = loadInter('normal', {weights: ['800'], subsets: ['latin', 'cyrillic']}).fontFamily;
const serif = loadCormorant('italic', {weights: ['500'], subsets: ['latin', 'cyrillic']}).fontFamily;

export type Group = {id: string; text: string; start: number; end: number; key: boolean; keyProb?: number; unsure?: boolean};
export type CaptionProps = {src: string; groups: Group[]; fps: number; duration: number};

export const W = 1080;
export const H = 1920;
const SIZE = 84;            // Inter ExtraBold, tracking -3%
const KEY_SIZE = SIZE * 1.5; // the keyword in Cormorant Italic
const CENTER_Y = 960;       // captions always sit in the vertical middle of the frame

// Each group stays on screen until the next one starts, so every frame carries a caption.
export const groupAt = (groups: Group[], t: number) => {
  let cur = groups[0];
  for (const g of groups) {
    if (g.start <= t) cur = g;
    else break;
  }
  return cur;
};

export const Captions: React.FC<CaptionProps> = ({src, groups}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const g = groups.length ? groupAt(groups, frame / fps) : undefined;

  return (
    <AbsoluteFill style={{background: '#000'}}>
      {src ? <OffthreadVideo src={src} style={{width: '100%', height: '100%', objectFit: 'cover'}} /> : null}
      {g ? (
        <div style={{position: 'absolute', left: 60, right: 60, top: CENTER_Y, transform: 'translateY(-50%)', textAlign: 'center'}}>
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
