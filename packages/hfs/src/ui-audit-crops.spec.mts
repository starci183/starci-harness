// The full-resolution crops `starci audit run` writes beside a screen's shots (runtime/scripts/hfs/shot-crops.mts; contexts/project/gallery.md PROJECT-GALLERY-8): the first viewport and the
// header region of 1440.png and 390.png, cut at the shot's own pixel density, and the layout checklist in the brief. A screen folder may hold them without being flagged stray.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { CROP_FILES, cropHeights, cropShots, decodePng } from '../runtime/scripts/hfs/shot-crops.mjs';
import { galleryParams } from '../runtime/scripts/hfs/gallery.mjs';
import { galleryScreens } from '../runtime/scripts/hfs/rules/gallery.mjs';
import { auditBrief, LAYOUT_CHECKLIST } from '../runtime/scripts/hfs/screen-yaml.mjs';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buffer: Buffer): number => { let c = 0xffffffff; for (const byte of buffer) c = (crcTable[(c ^ byte) & 0xff] as number) ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type: string, data: Buffer): Buffer => { const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8); out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length); return out; };

/** A `width` by `height` RGBA PNG whose rows alternate the Sub (1), Up (2) and Paeth (4) filters, so the decoder's unfiltering is exercised. Pixel (x, y) is [x, y, x + y, 255] mod 256. */
function png(width: number, height: number): Buffer {
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) pixels.set([x & 255, y & 255, (x + y) & 255, 255], y * stride + x * 4);
  const raw = Buffer.alloc((stride + 1) * height);
  const filters = [1, 2, 4];
  for (let y = 0; y < height; y += 1) {
    const filter = filters[y % 3] as number;
    raw[y * (stride + 1)] = filter;
    for (let i = 0; i < stride; i += 1) {
      const value = pixels[y * stride + i] as number;
      const left = i >= 4 ? (pixels[y * stride + i - 4] as number) : 0;
      const up = y > 0 ? (pixels[(y - 1) * stride + i] as number) : 0;
      const upLeft = y > 0 && i >= 4 ? (pixels[(y - 1) * stride + i - 4] as number) : 0;
      const p = left + up - upLeft;
      const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)] as [number, number, number];
      const predictor = filter === 1 ? left : filter === 2 ? up : pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      raw[y * (stride + 1) + 1 + i] = (value - predictor) & 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('crops: the first viewport and the header region are cut at the shot density and equal the top rows', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-crops-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // 1440 shot at 1x (900 first-viewport rows), 390 shot at 2x (1688 first-viewport rows, 256 header rows).
  fs.writeFileSync(path.join(dir, '1440.png'), png(1440, 1000));
  fs.writeFileSync(path.join(dir, '390.png'), png(780, 2000));
  const result = cropShots(dir);
  assert.deepEqual(result.notes, []);
  assert.deepEqual(result.written.map((file) => path.basename(file)).sort(), [...CROP_FILES].sort());
  const size = (name: string) => { const decoded = decodePng(fs.readFileSync(path.join(dir, name))); assert.ok(decoded !== null, name); return decoded; };
  assert.deepEqual([size('1440-first.png').width, size('1440-first.png').height], [1440, 900]);
  assert.deepEqual([size('1440-header.png').width, size('1440-header.png').height], [1440, 128]);
  assert.deepEqual([size('390-first.png').width, size('390-first.png').height], [780, 1688]);
  assert.deepEqual([size('390-header.png').width, size('390-header.png').height], [780, 256]);
  const full = decodePng(fs.readFileSync(path.join(dir, '390.png')));
  assert.ok(full !== null);
  assert.ok(full.rows.subarray(0, size('390-header.png').rows.length).equals(size('390-header.png').rows), 'the header crop is the top rows, unscaled');
  assert.deepEqual(cropHeights(2880, '1440'), { first: 1800, header: 256 });
});

test('crops: a shot that is not an 8-bit PNG gives a note and no crop, and the brief lists the crops and the layout checklist', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-crops-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, '1440.png'), 'not a png');
  const result = cropShots(dir);
  assert.equal(result.written.length, 0);
  assert.match(result.notes.join(''), /1440\.png is not an 8-bit PNG/);
  const brief = auditBrief({ id: 'a/b', folder: 'gallery/pages/a/b', value: { title: 't' }, shotPaths: ['x/1440.png'], cropPaths: ['x/1440-first.png', 'x/390-header.png'], laws: [] });
  assert.match(brief, /x\/1440-first\.png/);
  assert.match(brief, /x\/390-header\.png/);
  for (const item of LAYOUT_CHECKLIST) assert.ok(brief.includes(item), item);
  assert.match(brief, /control height.*40px/);
  assert.match(brief, /no wrapped label/);
  assert.match(brief, /overflow goes to the menu/);
  // owner, 2026-11-21: buttons stay md 40 / sm 32 with no invisible hit area, so the lens never asks for a 44px tap target
  assert.doesNotMatch(brief, /44px|tap target/u);
});

test('crops: a screen folder holding the crops is not stray, any other extra still is', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hfs-crops-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const params = galleryParams();
  const folder = path.join(root, ...params.pages.split('/'), 'customers', 'list');
  fs.mkdirSync(folder, { recursive: true });
  for (const name of [...CROP_FILES, '1440.png', '390.png', 'screen.yaml', '1440-extra.png']) fs.writeFileSync(path.join(folder, name), 'x');
  const { screens } = galleryScreens(root, params);
  assert.deepEqual(screens.map((screen) => screen.stray), [['1440-extra.png']]);
});
