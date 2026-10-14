import assert from 'node:assert/strict';
import test from 'node:test';
import { isOwnedPhotoCacheUri, jpegBase64Bytes, MAX_PHOTO_INPUT_BYTES, MAX_PHOTO_INPUT_PIXELS,
  readPhotoHeaderDimensions, validatePhotoInput, validateVisionPhoto } from '../byok/photo-validation.ts';

const base64 = "/9j/4AAQSkZJRgABAQAASABIAAD/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9sAQwACAgICAgIDAgIDBQMDAwUGBQUFBQYIBgYGBgYICggICAgICAoKCgoKCgoKDAwMDAwMDg4ODg4PDw8PDw8PDw8P/9sAQwECAgIEBAQHBAQHEAsJCxAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ/90ABAAB/9oADAMBAAIRAxEAPwD4vooor+Uz/fw//9k=";
const photo = { uri: `data:image/jpeg;base64,${base64}`, base64, width: 1, height: 1, mimeType: 'image/jpeg', bytes: 641 };

test('accepts an actual JPEG with matching dimensions, byte count and data URI', () => {
  assert.deepEqual(validateVisionPhoto(photo), { data: photo, error: null });
  assert.equal(jpegBase64Bytes(base64), Buffer.from(base64, 'base64').length);
  assert.deepEqual(readPhotoHeaderDimensions(Buffer.from(base64, 'base64')), { width: 1, height: 1 });
});

for (const [label, field, value] of [
  ['non-JPEG MIME', 'mimeType', 'image/png'], ['remote URI', 'uri', 'https://example.com/private.jpg'],
  ['wrong bytes', 'bytes', 642], ['NaN bytes', 'bytes', NaN], ['infinite bytes', 'bytes', Infinity],
  ['wrong width', 'width', 2], ['zero height', 'height', 0], ['fractional width', 'width', 1.5],
  ['oversized width', 'width', 1281], ['zero bytes', 'bytes', 0], ['non-string base64', 'base64', null],
]) {
  test(`rejects ${label}`, () => assert.equal(validateVisionPhoto({ ...photo, [field]: value }).data, null));
}

for (const value of [null, undefined, {}, 'photo', []]) {
  test(`rejects malformed photo value ${JSON.stringify(value)}`, () => assert.equal(validateVisionPhoto(value).data, null));
}

for (const base64 of ['', 'YWJj!', 'Y Q==', 'YR==', 'YWJ=', '=AAA', 'AAA===', 'A'.repeat(3_000_000)]) {
  test(`rejects invalid base64 of length ${base64.length}`, () => assert.equal(jpegBase64Bytes(base64), null));
}

test('rejects EXIF, XMP, IPTC and comment metadata in encoded photos', () => {
  const original = Buffer.from(base64, 'base64');
  for (const marker of [0xe1, 0xed, 0xfe]) {
    const bytes = Buffer.concat([original.subarray(0, 2), Buffer.from([255, marker, 0, 6, 71, 80, 83, 0]), original.subarray(2)]);
    const value = bytes.toString('base64');
    assert.equal(validateVisionPhoto({ ...photo, base64: value, uri: `data:image/jpeg;base64,${value}`, bytes: bytes.length }).data, null);
  }
});

test('accepts JPEG ICC colour profiles emitted by browser canvas and rejects unrelated APP2 payloads', () => {
  const original = Buffer.from(base64, 'base64');
  for (const [payload, valid] of [
    [Buffer.concat([Buffer.from('ICC_PROFILE\0', 'ascii'), Buffer.from([1, 1]), Buffer.alloc(128)]), true],
    [Buffer.from('PRIVATE_GPS\0secret location'), false],
    [Buffer.concat([Buffer.from('ICC_PROFILE\0', 'ascii'), Buffer.from([0, 1]), Buffer.alloc(128)]), false],
    [Buffer.concat([Buffer.from('ICC_PROFILE\0', 'ascii'), Buffer.from([2, 1]), Buffer.alloc(128)]), false],
    [Buffer.from('ICC_PROFILE\0'), false],
  ]) {
    const segment = Buffer.alloc(4);
    segment.writeUInt16BE(0xffe2, 0);
    segment.writeUInt16BE(payload.length + 2, 2);
    const bytes = Buffer.concat([original.subarray(0, 2), segment, payload, original.subarray(2)]);
    const value = bytes.toString('base64');
    const result = validateVisionPhoto({ ...photo, base64: value, uri: `data:image/jpeg;base64,${value}`, bytes: bytes.length });
    assert.equal(result.error === null, valid);
  }
});

test('rejects JPEG truncation and non-JPEG payloads even when byte counts match', () => {
  for (const bytes of [Buffer.from(base64, 'base64').subarray(0, 100), Buffer.from('plain text image')]) {
    const value = bytes.toString('base64');
    assert.equal(validateVisionPhoto({ ...photo, base64: value, uri: `data:image/jpeg;base64,${value}`, bytes: bytes.length }).data, null);
  }
});

test('bounds source file bytes, integer dimensions and total pixels before processing', () => {
  assert.equal(validatePhotoInput(6000, 4000, MAX_PHOTO_INPUT_BYTES), null);
  for (const values of [[6000, 4001, 1], [10_001, 1, 1], [1, 1, MAX_PHOTO_INPUT_BYTES + 1],
    [NaN, 1, 10], [1, Infinity, 10], [1, 1, NaN], [1, 1, 0], [0, 1, 10], [1.5, 1, 10]]) {
    assert.equal(typeof validatePhotoInput(...values), 'string');
  }
  assert.equal(MAX_PHOTO_INPUT_PIXELS, 24_000_000);
});

test('reads PNG header dimensions before any pixel decoding', () => {
  const bytes = Buffer.alloc(24);
  bytes.writeUInt32BE(0x89504e47, 0); bytes.writeUInt32BE(0x0d0a1a0a, 4);
  bytes.writeUInt32BE(0x49484452, 12); bytes.writeUInt32BE(50_000, 16); bytes.writeUInt32BE(50_000, 20);
  const dimensions = readPhotoHeaderDimensions(bytes);
  assert.deepEqual(dimensions, { width: 50_000, height: 50_000 });
  assert.match(validatePhotoInput(dimensions.width, dimensions.height, 100), /分辨率/);
  assert.equal(readPhotoHeaderDimensions(bytes.subarray(0, 20)), null);
});

test('only permits deletion of direct image files in the application-owned image cache', () => {
  const cache = 'file:///private/app/cache/';
  for (const folder of ['ImagePicker', 'ImageManipulator']) {
    assert.equal(isOwnedPhotoCacheUri(`${cache}${folder}/unique-123.jpg`, cache), true);
    assert.equal(isOwnedPhotoCacheUri(`${cache}${folder}/unique-123.jpg`, cache.slice(0, -1)), true);
  }
  for (const uri of ['file:///Pictures/original.jpg', `${cache}other/original.jpg`, `${cache}ImagePicker/../original.jpg`,
    `${cache}ImagePicker/%2E%2E%2Foriginal.jpg`, `${cache}ImagePicker/nested/original.jpg`, `${cache}ImagePicker/private.json`,
    'https://example.com/ImagePicker/photo.jpg', 'content://photos/original.jpg']) {
    assert.equal(isOwnedPhotoCacheUri(uri, cache), false);
  }
  assert.equal(isOwnedPhotoCacheUri(`${cache}ImagePicker/photo.jpg`, null), false);
});
