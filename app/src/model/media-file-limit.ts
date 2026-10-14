import { MAX_MEDIA_PACKAGE_BYTES } from './recipe-media.ts';

export function withinMediaPackageLimit(value: string): boolean {
  return value.length <= MAX_MEDIA_PACKAGE_BYTES && new TextEncoder().encode(value).byteLength <= MAX_MEDIA_PACKAGE_BYTES;
}
