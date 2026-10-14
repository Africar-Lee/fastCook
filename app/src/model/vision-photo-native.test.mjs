import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

const base64 = "/9j/4AAQSkZJRgABAQAASABIAAD/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9sAQwACAgICAgIDAgIDBQMDAwUGBQUFBQYIBgYGBgYICggICAgICAoKCgoKCgoKDAwMDAwMDg4ODg4PDw8PDw8PDw8P/9sAQwECAgIEBAQHBAQHEAsJCxAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ/90ABAAB/9oADAMBAAIRAxEAPwD4vooor+Uz/fw//9k=";
const cache = 'file:///app/cache/';
const sourceUri = `${cache}ImagePicker/source.jpg`;
const outputUri = `${cache}ImageManipulator/output.jpg`;
let state;
function reset(overrides = {}) {
  state = { files: new Map([[`${cache}ImagePicker/old.jpg`, 100]]), removed: [], permissionCalls: 0,
    launchCalls: 0, encodeCalls: 0, releases: 0, granted: true, canAskAgain: true, sourceUri,
    width: 4000, height: 3000, size: 1024, cancel: false, fail: null, ...overrides };
}
const modules = {
  'expo-file-system': {
    Paths: { cache: { uri: cache } },
    Directory: class {
      constructor(root, folder) { this.uri = `${root.uri}${folder}/`; }
      get exists() { return true; }
      list() { return [...state.files.keys()].filter(uri => uri.startsWith(this.uri)).map(uri => ({ uri })); }
    },
    File: class {
      constructor(uri) { this.uri = uri; }
      get exists() { return state.files.has(this.uri); }
      get size() { if (state.fail === 'read') throw new Error('private path'); return state.files.get(this.uri); }
      delete() { if (state.fail === 'cleanup' && this.uri === sourceUri) throw new Error('private path');
        state.removed.push(this.uri); state.files.delete(this.uri); }
    },
  },
  'expo-image-picker': {
    requestCameraPermissionsAsync: async () => { state.permissionCalls++;
      if (state.fail === 'permission') throw new Error('private path');
      return { granted: state.granted, canAskAgain: state.canAskAgain }; },
    launchCameraAsync: async options => launch(options),
    launchImageLibraryAsync: async options => launch(options),
  },
  'expo-image-manipulator': {
    SaveFormat: { JPEG: 'jpeg' },
    ImageManipulator: { manipulate: uri => {
      assert.equal(uri, state.sourceUri); state.encodeCalls++;
      return {
        resize: size => { state.resize = size; },
        release: () => { state.releases++; },
        renderAsync: async () => {
          if (state.fail === 'render') throw new Error('private path');
          return { release: () => { state.releases++; }, saveAsync: async options => {
            state.options = options; state.files.set(outputUri, 641);
            if (state.fail === 'save') throw new Error('private path');
            return { uri: outputUri, base64, width: 1, height: 1 };
          } };
        },
      };
    } },
  },
};
async function launch(options) {
  state.launchCalls++; state.pickerOptions = options;
  state.files.set(state.sourceUri, state.size);
  if (state.fail === 'picker') throw new Error('private path');
  return state.cancel ? { canceled: true, assets: null } : { canceled: false,
    assets: [{ uri: state.sourceUri, width: state.width, height: state.height, type: 'image' }] };
}
const stubKey = Symbol.for('fastcook.test.visionPhotoNative');
globalThis[stubKey] = modules;
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  if (!(specifier in modules)) return nextResolve(specifier, context);
  const names = Object.keys(modules[specifier]).join(', ');
  return { url: `data:text/javascript,${encodeURIComponent(`export const { ${names} } = globalThis[Symbol.for('fastcook.test.visionPhotoNative')][${JSON.stringify(specifier)}];`)}`, shortCircuit: true };
} });
const { pickVisionPhoto } = await import('../byok/photo.ts');
hooks.deregister(); delete globalThis[stubKey];

test('library selection requests no full-library permission, reencodes and releases only new cache files', async () => {
  reset();
  const result = await pickVisionPhoto('library');
  assert.equal(result.status, 'selected');
  assert.equal(result.photo.uri, `data:image/jpeg;base64,${base64}`);
  assert.equal(result.photo.bytes, 641);
  assert.equal(state.permissionCalls, 0);
  assert.deepEqual(state.pickerOptions.mediaTypes, ['images']);
  assert.equal(state.pickerOptions.exif, false);
  assert.equal(state.pickerOptions.base64, false);
  assert.equal(state.pickerOptions.quality, 1);
  assert.deepEqual(state.resize, { width: 1280 });
  assert.deepEqual(state.options, { format: 'jpeg', compress: 0.75, base64: true });
  assert.equal(state.releases, 2);
  assert.deepEqual(state.removed.sort(), [sourceUri, outputUri].sort());
  assert.equal(state.files.has(`${cache}ImagePicker/old.jpg`), true);
});

test('portrait photos limit height and do not upscale small photos', async () => {
  reset({ width: 3000, height: 4000 }); await pickVisionPhoto('library');
  assert.deepEqual(state.resize, { height: 1280 });
  reset({ width: 400, height: 300 }); await pickVisionPhoto('library');
  assert.equal(state.resize, undefined);
});

test('camera permission denial is actionable and opens no camera', async () => {
  for (const canAskAgain of [true, false]) {
    reset({ granted: false, canAskAgain });
    const result = await pickVisionPhoto('camera');
    assert.equal(result.status, 'failed');
    assert.match(result.error, /相机权限/);
    if (!canAskAgain) assert.match(result.error, /系统设置/);
    assert.equal(state.launchCalls, 0);
    assert.equal(state.permissionCalls, 1);
  }
});

test('camera cancellation removes new temporary capture files', async () => {
  reset({ cancel: true });
  assert.deepEqual(await pickVisionPhoto('camera'), { status: 'cancelled' });
  assert.equal(state.permissionCalls, 1);
  assert.deepEqual(state.removed, [sourceUri]);
  assert.equal(state.encodeCalls, 0);
});

test('rejects oversized input before native pixel processing', async () => {
  for (const values of [{ size: 20 * 1024 * 1024 + 1 }, { width: 6000, height: 4001 }, { width: NaN }]) {
    reset(values);
    assert.equal((await pickVisionPhoto('library')).status, 'failed');
    assert.equal(state.encodeCalls, 0);
    assert.deepEqual(state.removed, [sourceUri]);
  }
});

test('never processes or deletes an original outside the owned cache', async () => {
  reset({ sourceUri: 'file:///photos/original.jpg' });
  assert.equal((await pickVisionPhoto('library')).status, 'failed');
  assert.equal(state.encodeCalls, 0);
  assert.deepEqual(state.removed, []);
  assert.equal(state.files.has(state.sourceUri), true);
});

for (const fail of ['permission', 'picker', 'read', 'render', 'save', 'cleanup']) {
  test(`reports ${fail} failure without leaking paths and releases available resources`, async () => {
    reset({ fail });
    const result = await pickVisionPhoto(fail === 'permission' ? 'camera' : 'library');
    assert.equal(result.status, 'failed');
    assert.equal(result.error.includes('private'), false);
    assert.match(result.error, /重试|重新选择|权限/);
    if (fail === 'render') assert.equal(state.releases, 1);
    if (fail === 'save') {
      assert.equal(state.releases, 2);
      assert.equal(state.files.has(outputUri), false);
    }
    if (fail === 'cleanup') assert.equal(state.files.has(outputUri), false);
  });
}
