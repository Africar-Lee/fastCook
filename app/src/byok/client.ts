import { t } from '../i18n/core.ts';
import { fetch as expoFetch } from 'expo/fetch';
import { failure, success } from '../storage/types.ts';
import type { StorageResult } from '../storage/types';
import { buildVisionRequest, parseVisionResponse, VISION_CLIENT_ERRORS } from './request.ts';
import type { VisionRequest, VisionResponse } from './types';

export const MAX_VISION_RESPONSE_BYTES = 65_536;
export const VISION_TIMEOUT_MS = 45_000;
type FetchResponse = Pick<Response, 'status' | 'headers' | 'body' | 'redirected' | 'url'>;
type FetchOptions = Readonly<{
  method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal;
  redirect: 'error'; credentials: 'omit'; cache: 'no-store';
}>;
export type VisionFetch = (url: string, options: FetchOptions) => Promise<FetchResponse>;
type ClientOptions = Readonly<{ fetch?: VisionFetch; timeoutMs?: number }>;

function transportError(error: unknown): Readonly<{ data: null; error: string }> {
  return { data: null, error: error instanceof Error && error.message.includes("Redirect is not allowed when redirect mode is 'error'")
    ? t(VISION_CLIENT_ERRORS.redirect) : t(VISION_CLIENT_ERRORS.network) };
}

function differentResponseUrl(responseUrl: string, endpoint: string): boolean {
  if (responseUrl === '') return false;
  let received: URL;
  try { received = new URL(responseUrl); }
  catch (error: unknown) {
    if (!(error instanceof TypeError)) throw error;
    return true;
  }
  return received.href !== new URL(endpoint).href;
}

function statusError(status: number): string | null {
  if (status >= 200 && status < 300) return null;
  if (status >= 300 && status < 400) return t(VISION_CLIENT_ERRORS.redirect);
  if (status === 401) return t(VISION_CLIENT_ERRORS.auth);
  if (status === 403) return t(VISION_CLIENT_ERRORS.forbidden);
  if (status === 429) return t(VISION_CLIENT_ERRORS.rate);
  if ([400, 404, 405, 413, 415, 422].includes(status)) return t(VISION_CLIENT_ERRORS.model);
  return t(VISION_CLIENT_ERRORS.network);
}

async function readBoundedResponse(response: FetchResponse, signal: AbortSignal): Promise<StorageResult<Uint8Array>> {
  const length = response.headers.get('content-length');
  if (length !== null && Number(length) > MAX_VISION_RESPONSE_BYTES) return failure(t(VISION_CLIENT_ERRORS.oversize));
  if (response.body === null) return failure(t(VISION_CLIENT_ERRORS.badResponse));
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (!signal.aborted) {
      const chunk = await reader.read().then(success, () => failure<ReadableStreamReadResult<Uint8Array>>(t(VISION_CLIENT_ERRORS.network)));
      if (chunk.error !== null) return failure(chunk.error);
      if (chunk.data.done) break;
      byteLength += chunk.data.value.byteLength;
      if (byteLength > MAX_VISION_RESPONSE_BYTES) return failure(t(VISION_CLIENT_ERRORS.oversize));
      chunks.push(chunk.data.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (signal.aborted) return failure(t(VISION_CLIENT_ERRORS.cancelled));
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return success(bytes);
}

function decodeResponse(bytes: Uint8Array): StorageResult<VisionResponse> {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch (error: unknown) {
    if (!(error instanceof TypeError)) throw error;
    return failure(t(VISION_CLIENT_ERRORS.badResponse));
  }
  let value: unknown;
  try { value = JSON.parse(text); }
  catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error;
    return failure(t(VISION_CLIENT_ERRORS.badResponse));
  }
  return parseVisionResponse(value);
}

async function performRequest(request: VisionRequest, apiKey: string, signal: AbortSignal, fetcher: VisionFetch): Promise<StorageResult<VisionResponse>> {
  const options: FetchOptions = {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: request.body, signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
  };
  let pending: Promise<FetchResponse>;
  try { pending = fetcher(request.settings.endpoint, options); }
  catch (error: unknown) { return transportError(error); }
  const fetched = await pending.then(success, transportError);
  if (fetched.error !== null) return failure(fetched.error);
  const response = fetched.data;
  if (response.redirected || differentResponseUrl(response.url, request.settings.endpoint)) return failure(t(VISION_CLIENT_ERRORS.redirect));
  const error = statusError(response.status);
  if (error !== null) return failure(error);
  const bytes = await readBoundedResponse(response, signal);
  return bytes.error !== null ? failure(bytes.error) : decodeResponse(bytes.data);
}

export async function sendVisionRequest(request: VisionRequest, apiKey: string, signal?: AbortSignal, options: ClientOptions = {}): Promise<StorageResult<VisionResponse>> {
  if (signal?.aborted) return failure(t(VISION_CLIENT_ERRORS.cancelled));
  if (typeof apiKey !== 'string' || !/^[\x21-\x7e]{1,1024}$/u.test(apiKey)) return failure(t(VISION_CLIENT_ERRORS.key));
  if (!request || typeof request !== 'object') return failure(t(VISION_CLIENT_ERRORS.changedRequest));
  const checked = buildVisionRequest(request.settings, request.photo);
  if (checked.error !== null || checked.data.body !== request.body || checked.data.prompt !== request.prompt) return failure(t(VISION_CLIENT_ERRORS.changedRequest));
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  const stopped = new Promise<StorageResult<VisionResponse>>(resolve => {
    cancel = () => { resolve(failure(t(VISION_CLIENT_ERRORS.cancelled))); controller.abort(); };
    signal?.addEventListener('abort', cancel, { once: true });
    const timeoutMs = options.timeoutMs === undefined ? VISION_TIMEOUT_MS : Math.max(1, Math.min(VISION_TIMEOUT_MS, options.timeoutMs));
    timeout = setTimeout(() => { resolve(failure(t(VISION_CLIENT_ERRORS.timeout))); controller.abort(); }, timeoutMs);
  });
  try {
    return await Promise.race([performRequest(checked.data, apiKey, controller.signal, options.fetch ?? expoFetch), stopped]);
  } finally {
    clearTimeout(timeout);
    if (cancel) signal?.removeEventListener('abort', cancel);
    controller.abort();
  }
}
