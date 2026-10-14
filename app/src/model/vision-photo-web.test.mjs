import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { pickVisionPhoto } from '../byok/photo.web.ts';

const base64 = "/9j/4AAQSkZJRgABAQAASABIAAD/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9sAQwACAgICAgIDAgIDBQMDAwUGBQUFBQYIBgYGBgYICggICAgICAoKCgoKCgoKDAwMDAwMDg4ODg4PDw8PDw8PDw8P/9sAQwECAgIEBAQHBAQHEAsJCxAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ/90ABAAB/9oADAMBAAIRAxEAPwD4vooor+Uz/fw//9k=";
const original = { document: globalThis.document, Image: globalThis.Image,
  createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
let state;
function reset(overrides = {}) {
  state = { file: new File([Buffer.from(base64, 'base64')], 'photo.jpg', { type: 'image/jpeg' }),
    urls: [], revoked: [], removed: 0, images: [], canvases: [], event: 'change', fail: null, ...overrides };
}
URL.createObjectURL = () => { state.urls.push('blob:owned-photo'); return 'blob:owned-photo'; };
URL.revokeObjectURL = uri => { state.revoked.push(uri); };
globalThis.Image = class {
  constructor() { this.naturalWidth = 1; this.naturalHeight = 1; state.images.push(this); }
  set src(value) { this.source = value; if (value) queueMicrotask(() => {
    if (state.fail === 'decode') this.onerror?.(); else this.onload?.();
  }); }
};
globalThis.document = {
  body: { appendChild: () => {} },
  createElement: tag => {
    if (tag === 'canvas') {
      const canvas = { width: 0, height: 0, getContext: () => ({ drawImage: () => {} }), toDataURL: (format, quality) => {
        assert.equal(format, 'image/jpeg'); assert.equal(quality, 0.75);
        if (state.fail === 'encode') throw new Error('private file contents');
        return `data:image/jpeg;base64,${base64}`;
      } };
      state.canvases.push(canvas); return canvas;
    }
    assert.equal(tag, 'input');
    const handlers = new Map();
    const input = { files: state.file ? [state.file] : [], style: {}, addEventListener: (event, handler) => handlers.set(event, handler),
      remove: () => { state.removed++; }, click: () => {
        if (state.fail === 'picker') throw new Error('private path');
        queueMicrotask(() => handlers.get(state.event)?.());
      } };
    state.input = input; return input;
  },
};
after(() => {
  globalThis.document = original.document; globalThis.Image = original.Image;
  URL.createObjectURL = original.createObjectURL; URL.revokeObjectURL = original.revokeObjectURL;
});

test('web selection keeps only reencoded data and releases input, source URL and canvas', async () => {
  reset();
  const result = await pickVisionPhoto('library');
  assert.equal(result.status, 'selected');
  assert.equal(result.photo.base64, base64);
  assert.equal(result.photo.bytes, 641);
  assert.equal(state.input.capture, undefined);
  assert.equal(state.input.multiple, false);
  assert.deepEqual(state.revoked, state.urls);
  assert.equal(state.removed, 1);
  assert.equal(state.images[0].source, '');
  assert.deepEqual([state.canvases[0].width, state.canvases[0].height], [0, 0]);
});

test('web camera requests the rear capture picker only on explicit selection', async () => {
  reset();
  assert.equal((await pickVisionPhoto('camera')).status, 'selected');
  assert.equal(state.input.capture, 'environment');
});

test('web cancellation releases the file input without decoding or retaining any image', async () => {
  reset({ event: 'cancel' });
  assert.deepEqual(await pickVisionPhoto('library'), { status: 'cancelled' });
  assert.equal(state.removed, 1);
  assert.deepEqual(state.urls, []);
  assert.deepEqual(state.images, []);
});

test('web rejects oversized files before reading their contents', async () => {
  reset({ file: { size: 20 * 1024 * 1024 + 1, slice: () => { throw new Error('must not read'); } } });
  const result = await pickVisionPhoto('library');
  assert.equal(result.status, 'failed');
  assert.match(result.error, /20 MB/);
  assert.deepEqual(state.urls, []);
});

test('web rejects excessive dimensions from PNG headers before invoking a decoder', async () => {
  const header = Buffer.alloc(24);
  header.writeUInt32BE(0x89504e47, 0); header.writeUInt32BE(0x0d0a1a0a, 4);
  header.writeUInt32BE(0x49484452, 12); header.writeUInt32BE(50_000, 16); header.writeUInt32BE(50_000, 20);
  reset({ file: new File([header], 'large.png', { type: 'image/png' }) });
  const result = await pickVisionPhoto('library');
  assert.equal(result.status, 'failed');
  assert.match(result.error, /分辨率/);
  assert.deepEqual(state.images, []);
  assert.deepEqual(state.urls, []);
});

test('web rejects unsupported content even when its filename and MIME claim it is JPEG', async () => {
  reset({ file: new File(['not an image'], 'photo.jpg', { type: 'image/jpeg' }) });
  assert.equal((await pickVisionPhoto('library')).status, 'failed');
  assert.deepEqual(state.urls, []);
});

for (const fail of ['picker', 'decode', 'encode']) {
  test(`web ${fail} failure releases created resources and reports no private contents`, async () => {
    reset({ fail });
    const result = await pickVisionPhoto('library');
    assert.equal(result.status, 'failed');
    assert.equal(result.error.includes('private'), false);
    assert.equal(state.removed, 1);
    assert.deepEqual(state.revoked, state.urls);
    if (fail === 'encode') assert.deepEqual([state.canvases[0].width, state.canvases[0].height], [0, 0]);
  });
}
