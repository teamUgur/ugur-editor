// node render.mjs <props.json> <out.mp4> - renders the Captions composition with Remotion.
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {bundle} from '@remotion/bundler';
import {renderMedia, selectComposition} from '@remotion/renderer';

const [propsPath, out] = process.argv.slice(2);
const inputProps = JSON.parse(readFileSync(propsPath, 'utf8'));

const serveUrl = await bundle({entryPoint: path.resolve('src/remotion/index.ts')});
const composition = await selectComposition({serveUrl, id: 'Captions', inputProps});
let last = -1;
await renderMedia({
  composition,
  serveUrl,
  codec: 'h264',
  crf: 18,
  outputLocation: out,
  inputProps,
  onProgress: ({progress}) => {
    const p = Math.floor(progress * 100);
    if (p !== last && p % 10 === 0) console.log(`render ${p}%`);
    last = p;
  },
});
console.log(`done ${out}`);
