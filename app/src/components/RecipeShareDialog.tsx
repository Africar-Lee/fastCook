import { useI18n } from '../i18n/useI18n';
import { useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Dialog, Portal, Text, useTheme } from 'react-native-paper';
import type { PrivateRecipe } from '../model/private-recipes';
import { createRecipePackage, encodeRecipePackage, encodeRecipeQr } from '../model/recipe-transfer';
import type { AppCatalog } from '../model/types';
import { exportRecipeFile, shareRecipeFile } from '../storage/recipe-file';
import { RecipeQrCode } from './RecipeQrCode';

type Props = Readonly<{
  catalog: AppCatalog;
  recipes: readonly PrivateRecipe[];
  onDismiss: () => void;
}>;

export function RecipeShareDialog({ catalog, recipes, onDismiss }: Props) {
  const { t } = useI18n();
  const theme = useTheme();
  const prepared = useMemo(() => {
    const result = createRecipePackage(recipes, catalog);
    return result.error !== null ? result : encodeRecipePackage(result.data, catalog);
  }, [recipes, catalog]);
  const qr = useMemo(() => {
    const result = createRecipePackage(recipes, catalog);
    return result.error !== null ? result : encodeRecipeQr(result.data, catalog);
  }, [recipes, catalog]);
  const [showQr, setShowQr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const run = async (mode: 'share' | 'export') => {
    if (inFlight.current || prepared.error !== null) return;
    inFlight.current = true; setBusy(true); setMessage(null); setError(null);
    if (mode === 'export') {
      const result = await exportRecipeFile(prepared.data);
      if (result.status === 'failed') setError(result.error);
      if (result.status === 'saved') setMessage('菜谱文件已保存');
      if (result.status === 'download_started') setMessage('已开始下载菜谱文件');
    } else {
      const result = await shareRecipeFile(prepared.data);
      if (result.status === 'failed') setError([result.error, result.cleanupError].filter((item): item is string => Boolean(item)).map(item => t(item)).join(' '));
      if (result.status === 'unsupported') setMessage('请导出文件后分享');
      if (result.status !== 'failed' && result.cleanupError) setError(result.cleanupError);
    }
    inFlight.current = false; setBusy(false);
  };
  return <Portal><Dialog visible onDismiss={() => { if (!inFlight.current) onDismiss(); }} style={styles.dialog}>
    <Dialog.Title>{t(recipes.length === 1 ? '分享菜谱' : '导出我的菜谱')}</Dialog.Title>
    <Dialog.ScrollArea style={styles.scroll}><ScrollView contentContainerStyle={styles.content}>
      <Text variant="titleMedium">{recipes.length === 1 ? recipes[0]!.name : t('{count} 道菜谱', { count: recipes.length })}</Text>
      <Button mode="contained" icon="share-variant" disabled={busy || prepared.error !== null} loading={busy}
        onPress={() => void run('share')}>{t('分享文件')}</Button>
      <Button mode="outlined" icon="download-outline" disabled={busy || prepared.error !== null}
        onPress={() => void run('export')}>{t('导出文件')}</Button>
      {recipes.length === 1 && <Button icon="qrcode" disabled={busy || prepared.error !== null}
        onPress={() => setShowQr(previous => !previous)}>{t(showQr ? '收起二维码' : '显示二维码')}</Button>}
      {showQr && <View style={styles.qr}>
        {qr.error !== null ? <Text>{t(qr.error)}</Text> : <><RecipeQrCode value={qr.data} /><Text>{t('用 FastCook 扫码导入')}</Text></>}
      </View>}
      {(prepared.error || error) && <Text accessibilityRole="alert" style={{ color: theme.colors.error }}>{t(prepared.error ?? error ?? '')}</Text>}
      {message && <Text accessibilityLiveRegion="polite">{t(message)}</Text>}
    </ScrollView></Dialog.ScrollArea>
    <Dialog.Actions><Button disabled={busy} onPress={onDismiss}>{t('关闭')}</Button></Dialog.Actions>
  </Dialog></Portal>;
}

const styles = StyleSheet.create({
  dialog: { maxWidth: 520, width: '90%', maxHeight: '90%', alignSelf: 'center', marginHorizontal: 0 },
  scroll: { flexShrink: 1, maxHeight: 620 }, content: { gap: 16, paddingVertical: 16 }, qr: { gap: 12, alignItems: 'center' },
});
