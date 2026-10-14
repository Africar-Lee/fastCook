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
  const { kitchen } = backup;
  const recipeNames = kitchen.mealRecipeIds.map(id => catalog.recipes.find(recipe => recipe.recipe_id === id)?.name['zh-CN'] ?? id);
  return <View style={styles.content}>
    <Text>导出于 {new Date(backup.exportedAt).toLocaleString('zh-CN')}</Text>
    <Text>当次食材 {kitchen.currentIds.length} 种 · 调料 {kitchen.pantryIds.length} 种</Text>
    <Text>明确缺少 {kitchen.unavailableIds.length} 种 · 厨具 {kitchen.equipment.length} 件</Text>
    <Text>默认 {kitchen.defaultPeople} 人 · {kitchen.burnerCount} 个灶眼</Text>
    <Text>菜篮 {kitchen.mealRecipeIds.length} 道 · {kitchen.mealPeople} 人</Text>
    {recipeNames.length > 0 && <Text>{recipeNames.join('、')}</Text>}
    <Text variant="bodySmall">数据版本 {backup.datasetVersion}</Text>
    <Text>恢复后将覆盖本机食材、调料柜、菜篮和设置。</Text>
  </View>;
}

export function BackupDialog({ catalog, state, onRestore, onDismiss, onCompleted }: Props) {
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
    onCompleted(exported.status === 'saved' ? '备份已保存到所选文件夹' : '已开始下载备份');
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
    if (result.error !== null) { setError(`恢复未完成，原记录已保留。${result.error}`); return; }
    onCompleted('厨房记录已恢复');
  });
  return <Portal><Dialog visible onDismiss={() => { if (!inFlight.current) onDismiss(); }} style={styles.dialog}>
    <Dialog.Title>{preview ? '恢复备份' : '备份与恢复'}</Dialog.Title>
    <Dialog.ScrollArea style={styles.scroll}><ScrollView contentContainerStyle={styles.content}>
      {preview ? <BackupPreview backup={preview} catalog={catalog} /> : <View style={styles.content}>
        <Button icon="download-outline" mode="contained" disabled={busy} loading={busy} onPress={() => void save()}>导出备份</Button>
        <Button icon="upload-outline" mode="outlined" disabled={busy} onPress={() => void select()}>选择备份文件</Button>
      </View>}
      {error && <Text accessibilityRole="alert" style={{ color: theme.colors.error }}>{error}</Text>}
    </ScrollView></Dialog.ScrollArea>
    <Dialog.Actions>
      <Button disabled={busy} onPress={preview ? () => { setPreview(null); setError(null); } : onDismiss}>{preview ? '返回' : '关闭'}</Button>
      {preview && <Button mode="contained" disabled={busy} loading={busy} onPress={() => void restore()}>确认覆盖并恢复</Button>}
    </Dialog.Actions>
  </Dialog></Portal>;
}

const styles = StyleSheet.create({
  dialog: { maxWidth: 520, width: '90%', maxHeight: '90%', alignSelf: 'center' },
  scroll: { maxHeight: 440, flexShrink: 1 }, content: { gap: 16, paddingVertical: 12 },
});
