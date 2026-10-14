import { t } from '../i18n/core.ts';
import type { StorageResult } from '../storage/types';
import type { VisionPhoto } from './types';

export const MAX_VISION_PHOTO_BYTES = 2 * 1024 * 1024;
export const MAX_VISION_PHOTO_EDGE = 1280;
export const MAX_PHOTO_INPUT_BYTES = 20 * 1024 * 1024;
export const MAX_PHOTO_INPUT_PIXELS = 24_000_000;
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function validatePhotoInput(width: unknown, height: unknown, bytes: unknown): string | null {
  if (!positiveInteger(bytes)) return t('无法读取图片大小，请重新选择一张图片。');
  if (bytes > MAX_PHOTO_INPUT_BYTES) return t('图片超过 20 MB，请选择较小的图片。');
  if (!positiveInteger(width) || !positiveInteger(height)) return t('无法读取图片尺寸，请换一张图片。');
  if (width > 10_000 || height > 10_000 || width * height > MAX_PHOTO_INPUT_PIXELS) {
    return t('图片分辨率超过 2400 万像素或边长过大，请缩小后重试。');
  }
  return null;
}

export function readPhotoHeaderDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a
    && view.getUint32(12) === 0x49484452) return { width: view.getUint32(16), height: view.getUint32(20) };
  if (bytes.length >= 30 && view.getUint32(0) === 0x52494646 && view.getUint32(8) === 0x57454250) {
    const chunk = view.getUint32(12);
    if (chunk === 0x56503858) return { width: 1 + (view.getUint32(24, true) & 0xffffff), height: 1 + (view.getUint32(26, true) >>> 8) };
    if (chunk === 0x5650384c && bytes[20] === 0x2f) return { width: 1 + (view.getUint16(21, true) & 0x3fff), height: 1 + ((view.getUint32(21, true) >>> 14) & 0x3fff) };
    if (chunk === 0x56503820 && bytes[23] === 0x9d && bytes[24] === 1 && bytes[25] === 0x2a) {
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    }
  }
  if (bytes.length < 4 || view.getUint16(0) !== 0xffd8) return null;
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset++] !== 255) return null;
    while (offset < bytes.length && bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (offset + 2 > bytes.length || marker === 0xda || marker === 0xd9) return null;
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if ((marker === 0xc0 || marker === 0xc1 || marker === 0xc2) && length >= 8) {
      return { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
    }
    offset += length;
  }
  return null;
}

export function jpegBase64Bytes(base64: string): number | null {
  if (!base64 || base64.length > 4 * Math.ceil(MAX_VISION_PHOTO_BYTES / 3) || base64.length % 4 !== 0) return null;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const content = base64.slice(0, base64.length - padding);
  if (/[^A-Za-z0-9+/]/.test(content)) return null;
  const last = BASE64_ALPHABET.indexOf(content.at(-1)!);
  if ((padding === 2 && (last & 15) !== 0) || (padding === 1 && (last & 3) !== 0)) return null;
  return base64.length / 4 * 3 - padding;
}

function jpegByte(base64: string, offset: number): number {
  const bitOffset = offset * 8;
  const index = Math.floor(bitOffset / 6);
  const bits = (BASE64_ALPHABET.indexOf(base64[index]!) << 6) | BASE64_ALPHABET.indexOf(base64[index + 1]!);
  return (bits >> (4 - bitOffset % 6)) & 255;
}

function isIccProfileSegment(base64: string, offset: number, length: number): boolean {
  const signature = 'ICC_PROFILE\0';
  if (length <= 16) return false;
  for (let index = 0; index < signature.length; index++) {
    if (jpegByte(base64, offset + 2 + index) !== signature.charCodeAt(index)) return false;
  }
  const sequence = jpegByte(base64, offset + 14);
  const total = jpegByte(base64, offset + 15);
  return sequence > 0 && total > 0 && sequence <= total;
}

function jpegHeaderMatches(base64: string, bytes: number, width: number, height: number): boolean {
  const byte = (offset: number) => jpegByte(base64, offset);
  const word = (offset: number) => byte(offset) * 256 + byte(offset + 1);
  if (bytes < 12 || word(0) !== 0xffd8 || word(bytes - 2) !== 0xffd9) return false;
  let dimensionsMatch = false;
  let offset = 2;
  while (offset + 4 < bytes) {
    if (byte(offset++) !== 255) return false;
    while (offset < bytes && byte(offset) === 255) offset++;
    const marker = byte(offset++);
    if (marker === 0xda) return dimensionsMatch;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0 || marker === 0xfe) return false;
    const length = word(offset);
    if (length < 2 || offset + length > bytes - 2) return false;
    // Browser canvas can include an ICC colour profile in its freshly encoded JPEG.
    if (marker === 0xe2 && !isIccProfileSegment(base64, offset, length)) return false;
    if (marker >= 0xe1 && marker <= 0xef && marker !== 0xe2 && marker !== 0xee) return false;
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (length < 8 || dimensionsMatch) return false;
      dimensionsMatch = word(offset + 3) === height && word(offset + 5) === width;
      if (!dimensionsMatch) return false;
    }
    offset += length;
  }
  return false;
}

export function validateVisionPhoto(value: unknown): StorageResult<VisionPhoto> {
  const error = t('图片数据无效，请重新拍照或选择图片。');
  if (!value || typeof value !== 'object') return { data: null, error };
  const photo = value as Record<string, unknown>;
  if (photo.mimeType !== 'image/jpeg' || typeof photo.base64 !== 'string' || !positiveInteger(photo.width)
    || !positiveInteger(photo.height) || Math.max(photo.width, photo.height) > MAX_VISION_PHOTO_EDGE
    || !positiveInteger(photo.bytes) || photo.bytes > MAX_VISION_PHOTO_BYTES) return { data: null, error };
  const bytes = jpegBase64Bytes(photo.base64);
  if (bytes !== photo.bytes || photo.uri !== `data:image/jpeg;base64,${photo.base64}`
    || !jpegHeaderMatches(photo.base64, bytes, photo.width, photo.height)) return { data: null, error };
  return { data: { uri: photo.uri, base64: photo.base64, width: photo.width, height: photo.height, bytes,
    mimeType: 'image/jpeg' }, error: null };
}

export function isOwnedPhotoCacheUri(uri: string, cacheUri: string | null | undefined): boolean {
  if (!cacheUri || !cacheUri.startsWith('file://')) return false;
  const base = cacheUri.endsWith('/') ? cacheUri : `${cacheUri}/`;
  const folders = [`${base}ImagePicker/`, `${base}ImageManipulator/`];
  return folders.some(folder => {
    if (!uri.startsWith(folder)) return false;
    const name = uri.slice(folder.length);
    return /^[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp|heic|heif|avif|gif|bmp|svg)$/i.test(name);
  });
}
