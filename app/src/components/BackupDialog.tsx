import { formatDate, formatList, t } from '../i18n/core';
import { useI18n } from '../i18n/useI18n';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Dialog, Portal, Text, useTheme } from 'react-native-paper';
import type { AppCatalog, KitchenState } from '../model/types';
import { createKitchenBackup, decodeKitchenBackup } from '../storage/backup';
import type { KitchenBackup } from '../storage/backup';
import { exportKitchenBackup, importKitchenBackup } from '../storage/backup-file';
import type { StorageResult } from '../storage/types';

type Props = Readonly<{
  catalog: AppCatalog;
  state: KitchenState;
  onRestore: (state: KitchenState) => Promise<StorageResult<void>>;
  onDismiss: () => void;
  onCompleted: (message: string) => void;
}>;

function BackupPreview({ backup, catalog }: Readonly<{ backup: KitchenBackup; catalog: AppCatalog }>) {
  useI18n();
  const { kitchen } = backup;
  const recipeNames = kitchen.mealRecipeIds.map(id => kitchen.privateRecipes.find(recipe => recipe.id === id)?.name
    ?? catalog.recipes.find(recipe => recipe.recipe_id === id)?.name['zh-CN'] ?? id);
  return <View style={styles.content}>
    <Text>{t('导出于 {date}', { date: formatDate(backup.exportedAt) })}</Text>
    <Text>{t('当次食材 {current} 种 · 调料 {pantry} 种', { current: kitchen.currentIds.length, pantry: kitchen.pantryIds.length })}</Text>
    <Text>{t('明确缺少 {missing} 种 · 厨具 {equipment} 件', { missing: kitchen.unavailableIds.length, equipment: kitchen.equipment.length })}</Text>
    <Text>{t('默认 {people} 人 · {burners} 个灶眼', { people: kitchen.defaultPeople, burners: kitchen.burnerCount })}</Text>
    <Text>{t('菜篮 {recipes} 道 · {people} 人', { recipes: kitchen.mealRecipeIds.length, people: kitchen.mealPeople })}</Text>
    <Text>{t('我的菜谱 {count} 道', { count: kitchen.privateRecipes.length })}</Text>
    {recipeNames.length > 0 && <Text>{formatList(recipeNames)}</Text>}
    <Text variant="bodySmall">{t('数据版本 {version}', { version: backup.datasetVersion })}</Text>
    <Text>{t('恢复后将覆盖本机食材、调料柜、菜篮、我的菜谱和设置。')}</Text>
  </View>;
}

export function BackupDialog({ catalog, state, onRestore, onDismiss, onCompleted }: Props) {
  useI18n();
  const theme = useTheme();
  const [preview, setPreview] = useState<KitchenBackup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const run = async (operation: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    await operation();
    inFlight.current = false;
    setBusy(false);
  };
  const save = () => run(async () => {
    const result = createKitchenBackup(state, catalog);
    if (result.error !== null) { setError(result.error); return; }
    const exported = await exportKitchenBackup(result.data);
    if (exported.status === 'failed') { setError(exported.error); return; }
    if (exported.status === 'cancelled') return;
    onCompleted(t(exported.status === 'saved' ? '备份已保存到所选文件夹' : '已开始下载备份'));
  });
  const select = () => run(async () => {
    const selected = await importKitchenBackup();
    if (selected.status === 'failed') { setError(selected.error); return; }
    if (selected.status === 'cancelled') return;
    const result = decodeKitchenBackup(selected.content, catalog);
    setError(result.error);
    setPreview(result.data);
  });
  const restore = () => run(async () => {
    if (!preview) return;
    const result = await onRestore(preview.kitchen);
    if (result.error !== null) { setError(t('恢复未完成，原记录已保留。{error}', { error: t(result.error) })); return; }
    onCompleted(t('厨房记录已恢复'));
  });
  return <Portal><Dialog visible onDismiss={() => { if (!inFlight.current) onDismiss(); }} style={styles.dialog}>
    <Dialog.Title>{t(preview ? '恢复备份' : '备份与恢复')}</Dialog.Title>
    <Dialog.ScrollArea style={styles.scroll}><ScrollView contentContainerStyle={styles.content}>
      {preview ? <BackupPreview backup={preview} catalog={catalog} /> : <View style={styles.content}>
        <Button icon="download-outline" mode="contained" disabled={busy} loading={busy} onPress={() => void save()}>{t('导出备份')}</Button>
        <Button icon="upload-outline" mode="outlined" disabled={busy} onPress={() => void select()}>{t('选择备份文件')}</Button>
      </View>}
      {error && <Text accessibilityRole="alert" style={{ color: theme.colors.error }}>{t(error)}</Text>}
    </ScrollView></Dialog.ScrollArea>
    <Dialog.Actions>
      <Button disabled={busy} onPress={preview ? () => { setPreview(null); setError(null); } : onDismiss}>{t(preview ? '返回' : '关闭')}</Button>
      {preview && <Button mode="contained" disabled={busy} loading={busy} onPress={() => void restore()}>{t('确认覆盖并恢复')}</Button>}
    </Dialog.Actions>
  </Dialog></Portal>;
}

const styles = StyleSheet.create({
  dialog: { maxWidth: 520, width: '90%', maxHeight: '90%', alignSelf: 'center' },
  scroll: { maxHeight: 440, flexShrink: 1 }, content: { gap: 16, paddingVertical: 12 },
});
