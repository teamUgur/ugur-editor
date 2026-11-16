import {Composition} from 'remotion';
import {Captions, CaptionProps, H, W, keptSegments, outLength} from './Captions';

const defaults: CaptionProps = {src: '', groups: [], fps: 30, duration: 1};

export const Root: React.FC = () => (
  <Composition
    id="Captions"
    component={Captions}
    width={W}
    height={H}
    fps={30}
    durationInFrames={30}
    defaultProps={defaults}
    calculateMetadata={({props}) => ({fps: props.fps, durationInFrames: outLength(keptSegments(props.cuts, props.duration, props.fps))})}
  />
);
