import { t } from '../i18n/core.ts';
import type { VisionPhoto } from './types';
import { jpegBase64Bytes, MAX_PHOTO_INPUT_BYTES, MAX_VISION_PHOTO_EDGE,
  readPhotoHeaderDimensions, validatePhotoInput, validateVisionPhoto } from './photo-validation.ts';

type PhotoResult = { status: 'selected'; photo: VisionPhoto } | { status: 'cancelled' } | { status: 'failed'; error: string };
let picking = false;

async function validateFile(file: File): Promise<string | null> {
  if (file.size > MAX_PHOTO_INPUT_BYTES) return t('图片超过 20 MB，请选择较小的图片。');
  let header: ArrayBuffer;
  try {
    header = await file.slice(0, 262_144).arrayBuffer();
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return t('无法读取所选图片，请重新选择。');
  }
  const dimensions = readPhotoHeaderDimensions(new Uint8Array(header));
  if (!dimensions) return t('请使用 JPEG、PNG 或 WebP 图片。');
  return validatePhotoInput(dimensions.width, dimensions.height, file.size);
}

function encodePhoto(image: HTMLImageElement, bytes: number): PhotoResult {
  const inputError = validatePhotoInput(image.naturalWidth, image.naturalHeight, bytes);
  if (inputError) return { status: 'failed', error: inputError };
  const ratio = Math.min(1, MAX_VISION_PHOTO_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  let canvas: HTMLCanvasElement;
  let context: CanvasRenderingContext2D | null;
  try {
    canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    context = canvas.getContext('2d');
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return { status: 'failed', error: t('浏览器无法处理图片，请换一个浏览器重试。') };
  }
  if (!context) return { status: 'failed', error: t('浏览器无法处理图片，请换一个浏览器重试。') };
  let uri: string;
  try {
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    uri = canvas.toDataURL('image/jpeg', 0.75);
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return { status: 'failed', error: t('图片处理失败，请缩小图片或换一个浏览器重试。') };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
  const base64 = uri.slice('data:image/jpeg;base64,'.length);
  const photo = validateVisionPhoto({ uri, base64, width: Math.max(1, Math.round(image.naturalWidth * ratio)),
    height: Math.max(1, Math.round(image.naturalHeight * ratio)), mimeType: 'image/jpeg', bytes: jpegBase64Bytes(base64) });
  return photo.error ? { status: 'failed', error: photo.error } : { status: 'selected', photo: photo.data! };
}

async function processFile(file: File): Promise<PhotoResult> {
  const error = await validateFile(file);
  if (error) return { status: 'failed', error };
  let uri: string;
  try {
    uri = URL.createObjectURL(file);
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return { status: 'failed', error: t('无法打开所选图片，请重新选择。') };
  }
  return new Promise(resolve => {
    const image = new Image();
    const finish = (result: PhotoResult) => {
      image.onload = null;
      image.onerror = null;
      image.src = '';
      URL.revokeObjectURL(uri);
      resolve(result);
    };
    image.onload = () => finish(encodePhoto(image, file.size));
    image.onerror = () => finish({ status: 'failed', error: t('浏览器无法解码这张图片，请换一张 JPEG、PNG 或 WebP 图片。') });
    image.src = uri;
  });
}

export async function pickVisionPhoto(source: 'camera' | 'library'): Promise<PhotoResult> {
  if (picking) return { status: 'failed', error: t('图片正在处理，请稍候。') };
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return { status: 'failed', error: t('浏览器不支持选择图片，请换一个浏览器重试。') };
  }
  let input: HTMLInputElement;
  try {
    input = document.createElement('input');
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    return { status: 'failed', error: t('无法准备图片选择器，请重新打开页面后重试。') };
  }
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/webp';
  input.multiple = false;
  if (source === 'camera') input.capture = 'environment';
  input.style.display = 'none';
  picking = true;
  return new Promise(resolve => {
    const finish = (result: PhotoResult) => { input.remove(); picking = false; resolve(result); };
    input.addEventListener('cancel', () => finish({ status: 'cancelled' }), { once: true });
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) { finish({ status: 'cancelled' }); return; }
      void processFile(file).then(finish);
    }, { once: true });
    try {
      document.body.appendChild(input);
      input.click();
    } catch (error: unknown) {
      if (!(error instanceof Error)) throw error;
      finish({ status: 'failed', error: t('无法打开图片选择器，请允许访问文件后重试。') });
    }
  });
}
