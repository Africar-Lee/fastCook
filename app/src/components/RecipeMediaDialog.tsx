import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Dialog, Portal, Text, useTheme } from 'react-native-paper';
import { useI18n } from '../i18n/useI18n';
import { textOf } from '../model/presentation';
import { MAX_IMAGES_PER_RECIPE, type RecipeImage, type RecipeMedia } from '../model/recipe-media';
import type { AppRecipe } from '../model/types';
import type { StorageResult } from '../storage/types';
import { RecipeImageEditor } from './RecipeImageEditor';

type Props = Readonly<{
  recipe: AppRecipe;
  media: RecipeMedia;
  onSave: (media: RecipeMedia) => Promise<StorageResult<void>>;
  onDismiss: () => void;
}>;

export function RecipeMediaDialog({ recipe, media, onSave, onDismiss }: Props) {
  const { t } = useI18n();
  const theme = useTheme();
  const [initial] = useState(media);
  const [draft, setDraft] = useState(media);
  const [saving, setSaving] = useState(false);
  const [imageProcessing, setImageProcessing] = useState(false);
  const [discardVisible, setDiscardVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const imagePending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const busy = saving || imageProcessing;
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const remaining = MAX_IMAGES_PER_RECIPE - draft.images.length - Object.values(draft.steps).reduce((count, images) => count + images.length, 0);
  const onImageBusyChange = (processing: boolean) => {
    imagePending.current = processing;
    if (mounted.current) setImageProcessing(processing);
  };
  const changeStepImages = (stepId: string, images: readonly RecipeImage[]) => setDraft(previous => {
    const steps = { ...previous.steps };
    if (images.length > 0) steps[stepId] = images;
    else delete steps[stepId];
    return { ...previous, steps };
  });
  const requestDismiss = () => {
    if (inFlight.current || imagePending.current) return;
    if (dirty) setDiscardVisible(true);
    else onDismiss();
  };
  const save = async () => {
    if (inFlight.current || imagePending.current) return;
    inFlight.current = true; setSaving(true); setError(null);
    const result = await onSave(draft);
    inFlight.current = false;
    if (!mounted.current) return;
    setSaving(false);
    if (result.error !== null) setError(result.error);
    else onDismiss();
  };
  return <Portal>
    <Dialog visible dismissable={!busy} dismissableBackButton={!busy} onDismiss={requestDismiss} style={styles.dialog}>
      <Dialog.Title>{t('编辑图片')}</Dialog.Title>
      <Dialog.ScrollArea style={styles.scroll}>
        <ScrollView contentContainerStyle={styles.content} pointerEvents={busy ? 'none' : 'auto'}>
          <Text variant="titleMedium">{textOf(recipe.name)}</Text>
          <RecipeImageEditor images={draft.images} label={t('菜谱图片')} cover disabled={busy} remaining={remaining}
            onBusyChange={onImageBusyChange} onChange={images => setDraft(previous => ({ ...previous, images }))} />
          {recipe.steps.map((step, index) => <View key={step.step_id} style={styles.step}>
            <Text variant="titleMedium">{t('步骤 {number}', { number: index + 1 })}</Text>
            <Text>{textOf(step.text)}</Text>
            <RecipeImageEditor images={draft.steps[step.step_id] ?? []} label={t('步骤图片')} disabled={busy} remaining={remaining}
              onBusyChange={onImageBusyChange} onChange={images => changeStepImages(step.step_id, images)} />
          </View>)}
        </ScrollView>
      </Dialog.ScrollArea>
      {error && <Dialog.Content style={styles.error}><Text accessibilityRole="alert" style={{ color: theme.colors.error }}>{t(error)}</Text></Dialog.Content>}
      <Dialog.Actions>
        <Button disabled={busy} onPress={requestDismiss}>{t('取消')}</Button>
        <Button disabled={busy || !dirty} loading={saving} onPress={() => void save()}>{t('保存')}</Button>
      </Dialog.Actions>
    </Dialog>
    <Dialog visible={discardVisible} dismissable={!busy} dismissableBackButton={!busy}
      onDismiss={() => { if (!busy) setDiscardVisible(false); }} style={styles.confirm}>
      <Dialog.Title>{t('放弃修改？')}</Dialog.Title>
      <Dialog.Content><Text>{t('未保存的内容将丢失。')}</Text></Dialog.Content>
      <Dialog.Actions>
        <Button disabled={busy} onPress={() => setDiscardVisible(false)}>{t('继续编辑')}</Button>
        <Button disabled={busy} onPress={() => { if (!inFlight.current && !imagePending.current) onDismiss(); }}>{t('放弃修改')}</Button>
      </Dialog.Actions>
    </Dialog>
  </Portal>;
}

const styles = StyleSheet.create({
  dialog: { width: '94%', maxWidth: 680, maxHeight: '90%', alignSelf: 'center', marginHorizontal: 0 },
  scroll: { flexShrink: 1 }, content: { gap: 24, paddingVertical: 16 }, step: { gap: 12 },
  error: { paddingTop: 12, paddingBottom: 0 },
  confirm: { width: '90%', maxWidth: 520, alignSelf: 'center', marginHorizontal: 0 },
});
