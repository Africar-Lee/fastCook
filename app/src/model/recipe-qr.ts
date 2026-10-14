import { t } from '../i18n/core.ts';
import qrcode from 'qrcode-generator';
import { failure, success } from '../storage/types.ts';
import type { StorageResult } from '../storage/types';
import { MAX_RECIPE_QR_BYTES } from './recipe-transfer.ts';

export const RECIPE_QR_MARGIN = 4;
export type RecipeQrMatrix = readonly (readonly boolean[])[];

const encoder = new TextEncoder();
// The library defaults to truncating each UTF-16 code unit to one byte.
qrcode.stringToBytes = value => Array.from(encoder.encode(value));

export function createRecipeQrMatrix(value: unknown): StorageResult<RecipeQrMatrix> {
  if (typeof value !== 'string' || value.length === 0) return failure(t('二维码内容为空，请重新选择菜谱。'));
  if (value.length > MAX_RECIPE_QR_BYTES || encoder.encode(value).byteLength > MAX_RECIPE_QR_BYTES) {
    return failure(t('菜谱内容较长，请使用文件分享。'));
  }
  const code = qrcode(0, 'M');
  code.addData(value, 'Byte');
  try {
    code.make();
  } catch (error: unknown) {
    if (typeof error !== 'string' || !error.startsWith('code length overflow.')) throw error;
    return failure(t('菜谱内容较长，请使用文件分享。'));
  }
  const modules = code.getModuleCount();
  const size = modules + RECIPE_QR_MARGIN * 2;
  return success(Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => {
    const inside = row >= RECIPE_QR_MARGIN && row < size - RECIPE_QR_MARGIN
      && column >= RECIPE_QR_MARGIN && column < size - RECIPE_QR_MARGIN;
    return inside && code.isDark(row - RECIPE_QR_MARGIN, column - RECIPE_QR_MARGIN);
  })));
}
