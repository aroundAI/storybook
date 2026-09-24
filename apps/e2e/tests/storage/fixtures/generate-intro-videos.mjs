/**
 * Generates the two intro-video fixtures the KB-39 spec uploads
 * (`intro-a.webm`, `intro-b.webm`): 1.2 s of a solid colour, 64x64, VP8.
 *
 * Why WebM, and why this way: Playwright's Chromium has no H.264 decoder,
 * so an .mp4 fails the intro dialog's duration read; and MediaRecorder
 * leaves the Duration element out, which the dialog would read as Infinity
 * and refuse as "longer than 60 seconds". So the video is recorded in that
 * Chromium and the Duration is written into Segment > Info afterwards.
 *
 *   node apps/e2e/tests/storage/fixtures/generate-intro-videos.mjs
 */
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
const b = await chromium.launch(); const p = await b.newPage();
async function record(colour) {
  return p.evaluate(async (colour) => {
    const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d'); const stream = canvas.captureStream(10);
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' }); const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data); const done = new Promise((r) => (rec.onstop = r)); rec.start(100);
    const t0 = performance.now();
    while (performance.now() - t0 < 1200) { ctx.fillStyle = colour; ctx.fillRect(0,0,64,64); ctx.fillStyle='#fff'; ctx.fillRect(((performance.now()-t0)/20)%64,28,8,8); await new Promise((r) => setTimeout(r, 50)); }
    rec.stop(); await done; return [...new Uint8Array(await new Blob(chunks).arrayBuffer())];
  }, colour);
}
function withDuration(bytes, ms) {
  const buf = Buffer.from(bytes);
  const info = buf.indexOf(Buffer.from([0x15, 0x49, 0xa9, 0x66]));
  const sizeByte = buf[info + 4];
  if (!(sizeByte & 0x80)) throw new Error('expected a 1-byte Info size');
  const size = sizeByte & 0x7f;
  const dur = Buffer.alloc(11); dur.set([0x44, 0x89, 0x88], 0); dur.writeDoubleBE(ms, 3);
  if (size + 11 > 126) throw new Error('Info too large');
  const start = info + 5;
  return Buffer.concat([buf.subarray(0, info + 4), Buffer.from([0x80 | (size + 11)]), buf.subarray(start, start + size), dur, buf.subarray(start + size)]);
}
for (const [name, colour] of [['intro-a', '#dc2828'], ['intro-b', '#285adc']]) {
  const fixed = withDuration(await record(colour), 1200);
  writeFileSync(new URL(`./${name}.webm`, import.meta.url), fixed);
  const d = await p.evaluate(async (bytes) => {
    const f = new File([new Uint8Array(bytes)], 'x.webm', { type: 'video/webm' });
    return new Promise((res) => { const v = document.createElement('video'); v.preload = 'metadata';
      v.onloadedmetadata = () => res(String(v.duration)); v.onerror = () => res('error ' + v.error?.message); v.src = URL.createObjectURL(f); });
  }, [...fixed]);
  console.log(name, fixed.length, 'bytes, duration', d);
}
await b.close();
