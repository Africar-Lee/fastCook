import { t } from '../i18n/core.ts';
import { credentialStore } from './credentials';
import { historyStore } from './history';
import { sendVisionRequest } from './client';
import { failure, success } from '../storage/types';
import type { StorageResult } from '../storage/types';
import type { VisionRequest, VisionResponse } from './types';

export type RecognitionResult = Readonly<{ response: VisionResponse; historyError: string | null }>;

export async function recognizePhoto(request: VisionRequest, signal: AbortSignal): Promise<StorageResult<RecognitionResult>> {
  if (signal.aborted) return failure(t('识别已取消。'));
  const credentials = await credentialStore.read();
  if (credentials.error !== null) return failure(credentials.error);
  if (!credentials.data) return failure(t('请先设置识别模型和 API Key。'));
  if (JSON.stringify(credentials.data.settings) !== JSON.stringify(request.settings)) return failure(t('模型配置已更改，请重新预览请求。'));
  if (signal.aborted) return failure(t('识别已取消。'));
  const reserved = await historyStore.reserve(request);
  if (reserved.error !== null) return failure(reserved.error);
  const result = await sendVisionRequest(request, credentials.data.apiKey, signal);
  const recorded = await historyStore.finish(reserved.data.id, result.error === null
    ? { status: 'succeeded', itemCount: result.data.items.length, usage: result.data.usage }
    : { status: signal.aborted ? 'cancelled' : 'failed', error: result.error });
  if (result.error !== null) return failure(recorded.error === null ? result.error : t('{error} 调用记录未能更新，请检查存储空间。', { error: result.error }));
  return success({ response: result.data, historyError: recorded.error });
}
