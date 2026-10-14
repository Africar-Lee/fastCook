import { useEffect, useRef, useState } from 'react';
import { BackHandler, ScrollView, StyleSheet, View } from 'react-native';
import { Appbar, Button, Card, Dialog, IconButton, Portal, Searchbar, Snackbar, Text, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MAX_PRIVATE_RECIPES } from '../model/private-recipes';
import type { PrivateRecipe } from '../model/private-recipes';
import { courseLabels } from '../model/presentation';
import type { StorageResult } from '../storage/types';
import type { AppCatalog, KitchenState } from '../model/types';
import type { RecipeImportSummary, RecipePackage } from '../model/recipe-transfer';
import { RecipeImportDialog } from '../components/RecipeImportDialog';
import { RecipeShareDialog } from '../components/RecipeShareDialog';
import { useI18n } from '../i18n/useI18n';

type Props = Readonly<{
  recipes: readonly PrivateRecipe[];
  catalog: AppCatalog;
  state: KitchenState;
  active: boolean;
  onBack: () => void;
  onCreate: () => void;
  onEdit: (recipe: PrivateRecipe) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => Promise<StorageResult<void>>;
  onImport: (value: RecipePackage) => Promise<StorageResult<RecipeImportSummary>>;
}>;

export function PrivateRecipesScreen({ recipes, catalog, state, active, onBack, onCreate, onEdit, onOpen, onDelete, onImport }: Props) {
  const { t } = useI18n();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [deleting, setDeleting] = useState<PrivateRecipe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [sharing, setSharing] = useState<readonly PrivateRecipe[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const inFlight = useRef(false);
  const matches = recipes.filter(recipe => recipe.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  useEffect(() => {
    if (!active || importing || sharing) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (inFlight.current) return true;
      if (deleting) setDeleting(null);
      else onBack();
      return true;
    });
    return () => listener.remove();
  }, [active, importing, sharing, deleting, onBack]);
  const remove = async () => {
    if (!deleting || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    const result = await onDelete(deleting.id);
    inFlight.current = false; setBusy(false);
    if (result.error !== null) { setError(result.error); return; }
    setDeleting(null);
  };
  return <View style={styles.root}>
    <Appbar.Header statusBarHeight={0}><Appbar.BackAction onPress={onBack} disabled={busy} accessibilityLabel={t('返回设置')} />
      <Appbar.Content title={t('我的菜谱')} />
      <Appbar.Action icon="export-variant" accessibilityLabel={t('导出全部菜谱')} disabled={busy || recipes.length === 0}
        onPress={() => setSharing(recipes)} />
    </Appbar.Header>
    <ScrollView contentContainerStyle={[styles.page, { paddingBottom: 20 + insets.bottom }]} keyboardShouldPersistTaps="handled">
      <Button mode="contained" icon="plus" disabled={busy || recipes.length >= MAX_PRIVATE_RECIPES} onPress={onCreate}>{t('新建菜谱')}</Button>
      <Button mode="outlined" icon="import" disabled={busy} onPress={() => setImporting(true)}>{t('导入菜谱')}</Button>
      {recipes.length > 0 && <Searchbar placeholder={t('搜索我的菜谱')} accessibilityLabel={t('搜索我的菜谱')}
        searchAccessibilityLabel={t('搜索我的菜谱')} clearAccessibilityLabel={t('清空搜索')}
        value={query} onChangeText={setQuery} maxLength={80} />}
      {matches.length === 0 && <Text style={{ color: theme.colors.onSurfaceVariant }}>{t(recipes.length === 0 ? '还没有菜谱' : '没有找到菜谱')}</Text>}
      {recipes.length >= MAX_PRIVATE_RECIPES && <Text>{t('已保存 {count} 道菜谱', { count: MAX_PRIVATE_RECIPES })}</Text>}
      {matches.map(recipe => <Card key={recipe.id} mode="contained" style={{ backgroundColor: theme.colors.surface }}>
        <Card.Content style={styles.content}>
          <Text variant="titleLarge">{recipe.name}</Text>
          <Text style={{ color: theme.colors.onSurfaceVariant }}>{t('{course} · {minutes} 分钟 · {servings} 人份', {
            course: courseLabels[recipe.course], minutes: recipe.timeMinutes, servings: recipe.servings,
          })}</Text>
        </Card.Content>
        <Card.Actions style={styles.actions}>
          <IconButton icon="share-variant" accessibilityLabel={t('分享{name}', { name: recipe.name })} disabled={busy} onPress={() => setSharing([recipe])} />
          <Button disabled={busy} onPress={() => { setError(null); setDeleting(recipe); }}>{t('删除')}</Button>
          <Button disabled={busy} onPress={() => onEdit(recipe)}>{t('编辑')}</Button>
          <Button mode="contained-tonal" disabled={busy} onPress={() => onOpen(recipe.id)}>{t('看做法')}</Button>
        </Card.Actions>
      </Card>)}
    </ScrollView>
    <Portal><Dialog visible={deleting !== null} onDismiss={() => { if (!busy) setDeleting(null); }}>
      <Dialog.Title>{t('删除这道菜谱？')}</Dialog.Title>
      <Dialog.Content style={styles.content}><Text>{t('{name}将从我的菜谱和菜篮中移除。', { name: deleting?.name ?? '' })}</Text>
        {error && <Text accessibilityRole="alert" style={{ color: theme.colors.error }}>{t(error)}</Text>}
      </Dialog.Content>
      <Dialog.Actions><Button disabled={busy} onPress={() => setDeleting(null)}>{t('保留')}</Button>
        <Button disabled={busy} loading={busy} onPress={() => void remove()}>{t('删除')}</Button></Dialog.Actions>
    </Dialog></Portal>
    {importing && <RecipeImportDialog catalog={catalog} state={state} onImport={onImport} onDismiss={() => setImporting(false)}
      onCompleted={summary => {
        setImporting(false); setQuery('');
        setMessage(summary.skipped > 0 ? t('已导入 {added} 道菜谱，跳过重复 {skipped} 道', summary)
          : t('已导入 {added} 道菜谱', summary));
      }} />}
    {sharing && <RecipeShareDialog catalog={catalog} recipes={sharing} onDismiss={() => setSharing(null)} />}
    <Snackbar visible={message !== null} onDismiss={() => setMessage(null)} duration={5000}>{message ?? ''}</Snackbar>
  </View>;
}

const styles = StyleSheet.create({ root: { flex: 1 }, page: { padding: 20, gap: 16 }, content: { gap: 8 }, actions: { flexWrap: 'wrap' } });
