import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, IconButton, Text, useTheme } from 'react-native-paper';
import { useI18n } from '../i18n/useI18n';
import { pickRecipeImage } from '../model/pick-recipe-image';
import { MAX_IMAGES_PER_GROUP, MAX_IMAGES_PER_RECIPE, type RecipeImage } from '../model/recipe-media';
import { RecipeImageGallery } from './RecipeImageGallery';

type Props = Readonly<{
  images: readonly RecipeImage[];
  onChange: (images: readonly RecipeImage[]) => void;
  label: string;
  disabled?: boolean;
  remaining?: number;
  cover?: boolean;
  onBusyChange?: (busy: boolean) => void;
}>;

export function RecipeImageEditor({ images, onChange, label, disabled = false, remaining = MAX_IMAGES_PER_RECIPE,
  cover = false, onBusyChange }: Props) {
  const { t } = useI18n();
  const theme = useTheme();
  const [processing, setProcessing] = useState<'camera' | 'library' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const atGroupLimit = images.length >= MAX_IMAGES_PER_GROUP;
  const atRecipeLimit = remaining <= 0;
  const busy = disabled || processing !== null;
  const add = async (source: 'camera' | 'library') => {
    if (disabled || inFlight.current || atGroupLimit || atRecipeLimit) return;
    inFlight.current = true; onBusyChange?.(true); setProcessing(source); setError(null);
    const result = await pickRecipeImage(source);
    if (mounted.current) {
      if (result.status === 'selected') onChange([...images, result.image]);
      if (result.status === 'failed') setError(result.error);
      setProcessing(null);
    }
    inFlight.current = false; onBusyChange?.(false);
  };
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (disabled || inFlight.current || target < 0 || target >= images.length) return;
    const reordered = [...images];
    [reordered[index], reordered[target]] = [reordered[target]!, reordered[index]!];
    onChange(reordered);
  };
  return <View style={styles.section}>
    <View style={styles.heading}><Text variant="titleMedium" style={styles.title}>{label}</Text>
      <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>{images.length} / {MAX_IMAGES_PER_GROUP}</Text></View>
    <RecipeImageGallery images={images} label={label} compact cover={cover} renderFooter={(_image, index) => <View style={styles.actions}>
      <IconButton icon="chevron-left" size={20} disabled={busy || index === 0} accessibilityLabel={t('前移第{number}张图片', { number: index + 1 })}
        onPress={() => move(index, -1)} style={styles.icon} />
      <IconButton icon="chevron-right" size={20} disabled={busy || index === images.length - 1} accessibilityLabel={t('后移第{number}张图片', { number: index + 1 })}
        onPress={() => move(index, 1)} style={styles.icon} />
      <IconButton icon="delete-outline" size={20} disabled={busy} accessibilityLabel={t('删除第{number}张图片', { number: index + 1 })}
        onPress={() => { if (!disabled && !inFlight.current) onChange(images.filter((_, itemIndex) => itemIndex !== index)); }} style={styles.icon} />
    </View>} />
    <View style={styles.buttons}>
      <Button icon="image-plus" mode="outlined" disabled={busy || atGroupLimit || atRecipeLimit} loading={processing === 'library'}
        onPress={() => void add('library')}>{t('相册')}</Button>
      <Button icon="camera-outline" mode="outlined" disabled={busy || atGroupLimit || atRecipeLimit} loading={processing === 'camera'}
        onPress={() => void add('camera')}>{t('拍照')}</Button>
    </View>
    {processing && <Text accessibilityLiveRegion="polite">{t('正在处理图片')}</Text>}
    {!processing && (atGroupLimit || atRecipeLimit) && <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
      {t(atRecipeLimit ? '每道菜谱最多 {count} 张图片。' : '每组最多 {count} 张图片。', { count: atRecipeLimit ? MAX_IMAGES_PER_RECIPE : MAX_IMAGES_PER_GROUP })}
    </Text>}
    {error && <Text accessibilityRole="alert" style={{ color: theme.colors.error }}>{t(error)}</Text>}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 12 }, heading: { flexDirection: 'row', alignItems: 'center', gap: 12 }, title: { flex: 1 },
  actions: { flexDirection: 'row', justifyContent: 'center' }, icon: { margin: 0 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
