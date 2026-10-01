/**
 * A minimal MP4 whose header states a length and a size: `ftyp`, `moov`
 * (`mvhd` + one video `tkhd`), `mdat`. Enough for the app's header check
 * (FILM-1729) and for a vendor sandbox that stores bytes; not playable.
 */
function box(type: string, payload: Uint8Array) {
  const out = new Uint8Array(8 + payload.length);

  new DataView(out.buffer).setUint32(0, out.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(payload, 8);

  return out;
}

function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;

  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }

  return out;
}

export function headerOnlyMp4(options: {
  seconds: number;
  width: number;
  height: number;
}) {
  const mvhd = new Uint8Array(100);
  const mvhdView = new DataView(mvhd.buffer);

  mvhdView.setUint32(12, 1000);
  mvhdView.setUint32(16, Math.round(options.seconds * 1000));

  const tkhd = new Uint8Array(84);
  const tkhdView = new DataView(tkhd.buffer);

  tkhdView.setInt32(40, 0x10000);
  tkhdView.setUint32(76, options.width * 0x10000);
  tkhdView.setUint32(80, options.height * 0x10000);

  return concat(
    box('ftyp', new TextEncoder().encode('isom\0\0\0\0isomavc1')),
    box('moov', concat(box('mvhd', mvhd), box('trak', box('tkhd', tkhd)))),
    box('mdat', new Uint8Array(4096).fill(7)),
  );
}
