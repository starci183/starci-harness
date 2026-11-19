// shot-crops.mts - the full-resolution crops of a gallery shot that `starci audit run` writes beside it (contexts/project/gallery.md PROJECT-GALLERY-8): the FIRST VIEWPORT (what a
// visitor sees before scrolling) and the HEADER REGION of `1440.png` and `390.png`, each cut from the shot at its own pixel density, never scaled. An auditor that opens only a
// full-page shot sees it shrunk to fit and misses a wrapped label or a 32px button; the crops are small enough to be read at 1:1. Pure Node (zlib), no image library.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/** The widths a screen is shot at and the viewport height of each (CSS px): the first-viewport crop is one screen of that device. */
export const CROP_VIEWPORTS = Object.freeze({ '1440': { width: 1440, height: 900 }, '390': { width: 390, height: 844 } } as const);
/** The header region: the top of the page, tall enough for a two-row header or a header under an announcement bar (CSS px). */
export const HEADER_REGION_PX = 128;
/** The crops of one width, in the order the brief lists them. */
export const CROP_KINDS = ['first', 'header'] as const;
export type CropKind = (typeof CROP_KINDS)[number];
/** `<width>-first.png` and `<width>-header.png`: the files a screen folder may hold besides its shots. */
export const CROP_FILES: readonly string[] = Object.freeze(Object.keys(CROP_VIEWPORTS).flatMap((width) => CROP_KINDS.map((kind) => `${width}-${kind}.png`)));

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 4: 2, 6: 4 };

interface Png { width: number; height: number; colorType: number; bytesPerPixel: number; rows: Buffer }

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** Reads an 8-bit, non-interlaced grey, RGB or RGBA PNG (what a browser screenshot is) into unfiltered scanlines; null for any other shape. */
export function decodePng(file: Buffer): Png | null {
  if (file.length < 33 || !file.subarray(0, 8).equals(SIGNATURE)) return null;
  let at = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const data: Buffer[] = [];
  while (at + 12 <= file.length) {
    const length = file.readUInt32BE(at);
    const type = file.toString('ascii', at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      colorType = body[9] as number;
      if (body[8] !== 8 || body[12] !== 0 || CHANNELS[colorType] === undefined) return null;
    } else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  const channels = CHANNELS[colorType];
  if (channels === undefined || width === 0 || height === 0 || data.length === 0) return null;
  const raw = zlib.inflateSync(Buffer.concat(data));
  const stride = width * channels;
  if (raw.length !== (stride + 1) * height) return null;
  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)] as number;
    const from = y * (stride + 1) + 1;
    const to = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? (rows[to + x - channels] as number) : 0;
      const up = y > 0 ? (rows[to - stride + x] as number) : 0;
      const upLeft = y > 0 && x >= channels ? (rows[to - stride + x - channels] as number) : 0;
      const value = raw[from + x] as number;
      rows[to + x] = (filter === 0 ? value : filter === 1 ? value + left : filter === 2 ? value + up : filter === 3 ? value + ((left + up) >> 1) : filter === 4 ? value + paeth(left, up, upLeft) : -1) & 0xff;
      if (filter > 4) return null;
    }
  }
  return { width, height, colorType, bytesPerPixel: channels, rows };
}

/** The PNG of the top `height` rows of a decoded one (the whole width: both crops start at the top of the page). */
export function encodeTop(png: Png, height: number): Buffer {
  const rows = Math.min(height, png.height);
  const stride = png.width * png.bytesPerPixel;
  const raw = Buffer.alloc((stride + 1) * rows);
  for (let y = 0; y < rows; y += 1) png.rows.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(png.width, 0);
  header.writeUInt32BE(rows, 4);
  header[8] = 8;
  header[9] = png.colorType;
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

/** The crop heights, in image pixels, of a shot `imageWidth` wide taken for a `cssWidth` wide page: the pixel density is read from the image, so a 2x shot gives 2x crops. */
export function cropHeights(imageWidth: number, width: '1440' | '390'): Record<CropKind, number> {
  const scale = imageWidth / CROP_VIEWPORTS[width].width;
  return { first: Math.round(CROP_VIEWPORTS[width].height * scale), header: Math.round(HEADER_REGION_PX * scale) };
}

/** What one `cropShots` call did, per width: the files written and why a width gave none. */
export interface CropResult { written: string[]; notes: string[] }

/**
 * Writes `<width>-first.png` and `<width>-header.png` beside `1440.png` and `390.png` in `dir`, full resolution. A shot that is not an 8-bit grey/RGB/RGBA PNG gives no crop and a
 * note (the auditor then reads the full shot); a missing shot is the caller's refusal, not this function's.
 */
export function cropShots(dir: string): CropResult {
  const result: CropResult = { written: [], notes: [] };
  for (const width of ['1440', '390'] as const) {
    const source = path.join(dir, `${width}.png`);
    if (!fs.existsSync(source)) continue;
    let png: Png | null = null;
    try { png = decodePng(fs.readFileSync(source)); } catch { png = null; }
    if (png === null) { result.notes.push(`${width}.png is not an 8-bit PNG this tool reads: no crops of it; open the full shot at 1:1`); continue; }
    const heights = cropHeights(png.width, width);
    for (const kind of CROP_KINDS) {
      const target = path.join(dir, `${width}-${kind}.png`);
      fs.writeFileSync(target, encodeTop(png, heights[kind]));
      result.written.push(target);
    }
  }
  return result;
}
