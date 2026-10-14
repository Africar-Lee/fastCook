import { useI18n } from '../i18n/useI18n';
import { useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Dialog, Portal, Text, useTheme } from 'react-native-paper';
import { courseLabels, formatQuantity, nameOf } from '../model/presentation';
import { decodeRecipePackage, decodeRecipeQr, prepareRecipeImport } from '../model/recipe-transfer';
import type { RecipeImportSummary, RecipePackage } from '../model/recipe-transfer';
import type { AppCatalog, KitchenState } from '../model/types';
import { importRecipeFile } from '../storage/recipe-file';
import type { StorageResult } from '../storage/types';
import { RecipeQrScanner } from './RecipeQrScanner';

type Props = Readonly<{
  catalog: AppCatalog;
  state: KitchenState;
  onImport: (value: RecipePackage) => Promise<StorageResult<RecipeImportSummary>>;
  onDismiss: () => void;
  onCompleted: (summary: RecipeImportSummary) => void;
}>;

function RecipePreview({ value, catalog }: Readonly<{ value: RecipePackage; catalog: AppCatalog }>) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState<string | null>(value.recipes.length === 1 ? value.recipes[0]!.id : null);
  return <View style={styles.content}>{value.recipes.map(recipe => <View key={recipe.id} style={styles.recipe}>
    <Text variant="titleMedium">{recipe.name}</Text>
    <Text>{t('{course} · {minutes} 分钟 · {servings} 人份', {
      course: courseLabels[recipe.course], minutes: recipe.timeMinutes, servings: recipe.servings,
    })}</Text>
    <Button onPress={() => setExpanded(previous => previous === recipe.id ? null : recipe.id)}>
      {t(expanded === recipe.id ? '收起做法' : '查看做法')}</Button>
    {expanded === recipe.id && <>
      {recipe.ingredients.map(ingredient => <Text key={ingredient.ingredientId}>
        {nameOf(catalog, ingredient.ingredientId)} · {formatQuantity(ingredient.quantity)}
      </Text>)}
      {recipe.steps.map((step, index) => <Text key={step.id}>{index + 1}. {step.text}</Text>)}
    </>}
  </View>)}</View>;
}

export function RecipeImportDialog({ catalog, state, onImport, onDismiss, onCompleted }: Props) {
  const { t } = useI18n();
  const theme = useTheme();
  const [preview, setPreview] = useState<RecipePackage | null>(null);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const planned = useMemo(() => preview ? prepareRecipeImport(state, catalog, preview) : null, [preview, state, catalog]);
  const select = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    const selected = await importRecipeFile();
    if (selected.status === 'failed') setError(selected.error);
    if (selected.status === 'selected') {
      const decoded = decodeRecipePackage(selected.content, catalog);
      setError(decoded.error); setPreview(decoded.data);
    }
    inFlight.current = false; setBusy(false);
  };
  const confirm = async () => {
    if (inFlight.current || !preview || !planned?.data?.added) return;
    inFlight.current = true; setBusy(true); setError(null);
    const result = await onImport(preview);
    inFlight.current = false; setBusy(false);
    if (result.error !== null) { setError(result.error); return; }
    onCompleted(result.data);
  };
  if (scanning) return <RecipeQrScanner onDismiss={() => setScanning(false)} onScan={value => {
    setScanning(false);
    const decoded = decodeRecipeQr(value, catalog);
    setError(decoded.error); setPreview(decoded.data);
  }} />;
  return <Portal><Dialog visible onDismiss={() => { if (!inFlight.current) onDismiss(); }} style={styles.dialog}>
    <Dialog.Title>{t(preview ? '确认导入' : '导入菜谱')}</Dialog.Title>
    <Dialog.ScrollArea style={styles.scroll}><ScrollView contentContainerStyle={styles.content}>
      {preview ? <>
        <RecipePreview value={preview} catalog={catalog} />
        {!!preview.assets?.length && <Text>{t('图片 {count} 张', { count: preview.assets.length })}</Text>}
        {planned?.data && <>
          <Text>{planned.data.skipped > 0
            ? t('新增 {added} 道 · 跳过重复 {skipped} 道', { added: planned.data.added, skipped: planned.data.skipped })
            : t('新增 {count} 道', { count: planned.data.added })}</Text>
          {planned.data.sameNameCount > 0 && <Text>{t('{count} 道同名菜谱将另存', { count: planned.data.sameNameCount })}</Text>}
          {planned.data.added > 0 && <Text>{t('导入后参与推荐和配餐')}</Text>}
        </>}
      </> : <>
        <Button mode="contained" icon="file-upload-outline" disabled={busy} loading={busy} onPress={() => void select()}>{t('选择菜谱文件')}</Button>
        <Button mode="outlined" icon="qrcode-scan" disabled={busy} onPress={() => { setError(null); setScanning(true); }}>{t('扫描二维码')}</Button>
      </>}
      {(error || planned?.error) && <Text accessibilityRole="alert" style={{ color: theme.colors.error }}>{t(error ?? planned?.error ?? '')}</Text>}
    </ScrollView></Dialog.ScrollArea>
    <Dialog.Actions>
      <Button disabled={busy} onPress={preview ? () => { setPreview(null); setError(null); } : onDismiss}>{t(preview ? '返回' : '关闭')}</Button>
      {preview && <Button mode="contained" disabled={busy || !planned?.data?.added} loading={busy} onPress={() => void confirm()}>{t('导入菜谱')}</Button>}
    </Dialog.Actions>
  </Dialog></Portal>;
}

const styles = StyleSheet.create({
  dialog: { maxWidth: 520, width: '90%', maxHeight: '90%', alignSelf: 'center', marginHorizontal: 0 },
  scroll: { maxHeight: 560, flexShrink: 1 }, content: { gap: 16, paddingVertical: 12 }, recipe: { gap: 8 },
});
