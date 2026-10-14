import { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Text, useTheme } from 'react-native-paper';
import { useI18n } from '../i18n/useI18n';
import type { RecipeImage } from '../model/recipe-media';
import { imageStore } from '../storage/recipe-images';

export function RecipeCover({ image, label }: Readonly<{ image: RecipeImage; label: string }>) {
  const { t } = useI18n();
  const theme = useTheme();
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setSource(null); setError(null);
    void imageStore.resolve(image).then(result => {
      if (active) { setSource(result.data); setError(result.error); }
    });
    return () => { active = false; };
  }, [image.id, image.width, image.height, image.bytes]);
  return <View style={[styles.cover, { backgroundColor: theme.colors.surfaceVariant }]}>
    {error ? <Text style={styles.error}>{t('图片无法显示，请重新添加。')}</Text>
      : source ? <Image source={{ uri: source }} accessibilityLabel={label} style={styles.image} resizeMode="cover"
        onError={() => setError(t('图片无法显示，请重新添加。'))} /> : <ActivityIndicator />}
  </View>;
}

const styles = StyleSheet.create({
  cover: { width: '100%', aspectRatio: 16 / 9, justifyContent: 'center', alignItems: 'center', overflow: 'hidden', borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  image: { width: '100%', height: '100%' }, error: { padding: 20 },
});
