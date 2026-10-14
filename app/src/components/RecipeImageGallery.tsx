import { useEffect, useState, type ReactNode } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, IconButton, Text, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '../i18n/useI18n';
import type { RecipeImage } from '../model/recipe-media';
import { imageStore } from '../storage/recipe-images';

type Props = Readonly<{
  images: readonly RecipeImage[];
  label: string;
  compact?: boolean;
  cover?: boolean;
  renderFooter?: (image: RecipeImage, index: number) => ReactNode;
}>;

function StoredImage({ image, label, expanded = false }: Readonly<{ image: RecipeImage; label: string; expanded?: boolean }>) {
  const { t } = useI18n();
  const theme = useTheme();
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setUri(null); setError(null);
    void imageStore.resolve(image).then(result => {
      if (!active) return;
      if (result.error !== null) setError(result.error);
      else setUri(result.data);
    });
    return () => { active = false; };
  }, [image.id, retry]);
  if (error) return <View style={styles.imageStatus}>
    <Text accessibilityRole="alert" variant={expanded ? 'bodyMedium' : 'bodySmall'} numberOfLines={expanded ? undefined : 3}
      style={{ color: expanded ? '#fff' : theme.colors.error, textAlign: 'center' }}>{t(error)}</Text>
    <Button textColor={expanded ? '#fff' : undefined} onPress={event => { event.stopPropagation(); setRetry(previous => previous + 1); }}>{t('重试')}</Button>
  </View>;
  if (!uri) return <View style={styles.imageStatus} accessibilityLabel={t('正在加载图片')}><ActivityIndicator color={expanded ? '#fff' : undefined} /></View>;
  return <Image source={{ uri }} accessibilityLabel={label} style={styles.image} resizeMode={expanded ? 'contain' : 'cover'}
    onError={() => setError('图片加载失败，请重试。')} />;
}

export function RecipeImageGallery({ images, label, compact = false, cover = false, renderFooter }: Props) {
  const { t } = useI18n();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIndex = images.findIndex(image => image.id === selectedId);
  const selected = images[selectedIndex];
  const close = () => setSelectedId(null);
  if (images.length === 0) return null;
  const fullLabel = t('{label}，第{number}张，共{count}张', { label, number: selectedIndex + 1, count: images.length });
  return <>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
      {images.map((image, index) => <View key={image.id} style={{ width: compact ? 144 : 216 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('查看{label}第{number}张图片', { label, number: index + 1 })}
          onPress={() => setSelectedId(image.id)} style={[styles.thumbnail, { backgroundColor: theme.colors.surfaceVariant }]}>
          <StoredImage image={image} label={t('查看{label}第{number}张图片', { label, number: index + 1 })} />
          {cover && index === 0 && <View style={[styles.cover, { backgroundColor: theme.colors.inverseSurface }]}>
            <Text variant="labelSmall" style={{ color: theme.colors.inverseOnSurface }}>{t('封面')}</Text>
          </View>}
        </Pressable>
        {renderFooter?.(image, index)}
      </View>)}
    </ScrollView>
    <Modal visible={Boolean(selected)} transparent animationType="fade" onRequestClose={close}>
      <View style={[styles.viewer, { paddingTop: insets.top, paddingBottom: insets.bottom }]} accessibilityViewIsModal>
        <View style={styles.viewerHeader}>
          <Text numberOfLines={2} style={styles.viewerTitle}>{fullLabel}</Text>
          <IconButton icon="close" iconColor="#fff" accessibilityLabel={t('关闭')} onPress={close} />
        </View>
        <View style={styles.fullImage}>{selected && <StoredImage key={selected.id} image={selected} label={fullLabel} expanded />}</View>
        {images.length > 1 && <View style={styles.navigation}>
          <IconButton icon="chevron-left" iconColor="#fff" size={32} disabled={selectedIndex <= 0} accessibilityLabel={t('上一张图片')}
            onPress={() => setSelectedId(images[selectedIndex - 1]!.id)} />
          <Text style={styles.viewerCount}>{selectedIndex + 1} / {images.length}</Text>
          <IconButton icon="chevron-right" iconColor="#fff" size={32} disabled={selectedIndex >= images.length - 1} accessibilityLabel={t('下一张图片')}
            onPress={() => setSelectedId(images[selectedIndex + 1]!.id)} />
        </View>}
      </View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  strip: { gap: 12 }, thumbnail: { aspectRatio: 1, borderRadius: 12, overflow: 'hidden' },
  image: { width: '100%', height: '100%' }, imageStatus: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 8, gap: 8 },
  cover: { position: 'absolute', left: 8, bottom: 8, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  viewer: { flex: 1, backgroundColor: '#111' }, viewerHeader: { flexDirection: 'row', alignItems: 'center', paddingLeft: 20 },
  viewerTitle: { color: '#fff', flex: 1 }, fullImage: { flex: 1, minHeight: 0 },
  navigation: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24 }, viewerCount: { color: '#fff' },
});
