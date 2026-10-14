import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { collectRecipeImages } from './recipe-media';
import type { RecipeMediaMap } from './recipe-media';
import { imageStore } from '../storage/recipe-images';

export function useRecipeMediaMaintenance(media: RecipeMediaMap | undefined, enabled: boolean) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const references = useMemo(() => media ? collectRecipeImages(media) : null, [media]);
  const signature = references?.data?.map(image => image.id).sort().join(',') ?? '';
  const validationError = references?.error ?? null;
  const cleanup = useCallback(async () => {
    if (validationError) { setError(validationError); setReady(true); return; }
    // Other browser tabs can hold unsaved images in the shared database.
    if (Platform.OS === 'web') { setError(null); setReady(true); return; }
    const result = await imageStore.prune(signature ? signature.split(',') : []);
    setError(result.error); setReady(true);
  }, [signature, validationError]);
  useEffect(() => { if (media && enabled) void cleanup(); }, [Boolean(media), enabled, cleanup]);
  const retry = useCallback(async () => { if (media && enabled) await cleanup(); }, [media, enabled, cleanup]);
  return { ready, error, retry };
}
