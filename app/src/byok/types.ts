import type { StorageResult } from '../storage/types';

export type VisionSettings = Readonly<{
  protocol: 'openai' | 'openai-compatible';
  providerName: string;
  endpoint: string;
  model: string;
  dailyLimit: number;
}>;
export type VisionCredentials = Readonly<{ schemaVersion: 1; settings: VisionSettings; apiKey: string }>;
export type VisionPhoto = Readonly<{ uri: string; base64: string; width: number; height: number; mimeType: 'image/jpeg'; bytes: number }>;
export type VisionItem = Readonly<{ name: string; confidence: number; quantity?: string }>;
export type VisionUsage = Readonly<{ inputTokens?: number; outputTokens?: number; totalTokens?: number }>;
export type VisionResponse = Readonly<{ items: readonly VisionItem[]; usage: VisionUsage }>;
export type VisionRequest = Readonly<{ settings: VisionSettings; photo: VisionPhoto; prompt: string; body: string }>;
export type VisionCallStatus = 'pending' | 'succeeded' | 'failed' | 'cancelled';
export type VisionCall = Readonly<{
  id: string;
  timestamp: string;
  settings: VisionSettings;
  prompt: string;
  image: Readonly<{ width: number; height: number; bytes: number; mimeType: 'image/jpeg' }>;
  status: VisionCallStatus;
  itemCount?: number;
  usage?: VisionUsage;
  error?: string;
}>;
export type VisionHistory = Readonly<{ schemaVersion: 1; quotaDate: string; usedCalls: number; calls: readonly VisionCall[] }>;
export type CredentialStore = Readonly<{
  read: () => Promise<StorageResult<VisionCredentials | null>>;
  save: (settings: unknown, apiKey: string) => Promise<StorageResult<VisionSettings>>;
  remove: () => Promise<StorageResult<void>>;
}>;
