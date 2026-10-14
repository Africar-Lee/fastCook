import { useI18n } from '../i18n/useI18n';
import type { LanguagePreference } from '../i18n/useLanguagePreference';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Chip, Dialog, Portal, SegmentedButtons, Snackbar, Text, useTheme } from 'react-native-paper';
import type { Equipment } from '../../../packages/engine/src/types';
import { BackupDialog } from '../components/BackupDialog';
import { CountStepper } from '../components/CountStepper';
import { NetworkInfoDialog } from '../components/NetworkInfoDialog';
import { VisionSettingsDialog } from '../components/VisionSettingsDialog';
import { VisionHistoryDialog } from '../components/VisionHistoryDialog';
import { equipmentLabels } from '../model/presentation';
import type { AppCatalog, KitchenState, UpdateKitchen } from '../model/types';
import type { StorageResult } from '../storage/types';

type Props = Readonly<{
  language: LanguagePreference;
  catalog: AppCatalog;
  state: KitchenState;
  update: UpdateKitchen;
  onReset: () => void;
  onRestore: (state: KitchenState) => Promise<StorageResult<void>>;
  onOpenPrivateRecipes: () => void;
  disabled?: boolean;
}>;

export function SettingsScreen({ language, catalog, state, update, onReset, onRestore, onOpenPrivateRecipes, disabled = false }: Props) {
  const { t } = useI18n();
  const theme = useTheme();
  const [selected, setSelected] = useState<readonly Equipment[]>(state.equipmentConfigured ? state.equipment : ['wok', 'pot']);
  const [saved, setSaved] = useState(false);
  const [resetVisible, setResetVisible] = useState(false);
  const [networkInfoVisible, setNetworkInfoVisible] = useState(false);
  const [backupVisible, setBackupVisible] = useState(false);
  const [visionSettingsVisible, setVisionSettingsVisible] = useState(false);
  const [visionHistoryVisible, setVisionHistoryVisible] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const equipmentKey = state.equipment.join('|');
  useEffect(() => {
    setSelected(state.equipmentConfigured ? state.equipment : ['wok', 'pot']);
  }, [equipmentKey, state.equipmentConfigured]);
  const toggleEquipment = (id: Equipment) => {
    setSaved(false);
    setSelected(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id]);
  };
  const restore = async (restored: KitchenState): Promise<StorageResult<void>> => {
    const result = await onRestore(restored);
    if (result.error === null) {
      setSelected(restored.equipmentConfigured ? restored.equipment : ['wok', 'pot']);
      setSaved(false);
    }
    return result;
  };
  return <>
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.heading}>
        <Text variant="headlineLarge" style={styles.title}>{t('设置')}</Text>
      </View>
      <Card mode="contained" style={{ backgroundColor: theme.colors.surface }}>
        <Card.Content style={styles.content}>
          <Text variant="titleLarge">{t('语言')}</Text>
          <SegmentedButtons value={language.locale} onValueChange={value => { void language.change(value); }}
            buttons={[{ value: 'zh-CN', label: '简体中文', disabled: language.saving },
              { value: 'en', label: 'English', disabled: language.saving }]} />
          {language.error && <View style={{ gap: 8 }}>
            <Text style={{ color: theme.colors.error }}>{t(language.error)}</Text>
            <Button onPress={() => { void language.retry(); }} disabled={language.saving}>{t('重新读取')}</Button>
          </View>}
        </Card.Content>
      </Card>
      <Card mode="contained" style={{ backgroundColor: theme.colors.surface }}>
        <Card.Content style={styles.preferences}>
          <CountStepper label={t('默认用餐人数')} value={state.defaultPeople} min={1} max={12}
            onChange={defaultPeople => update(previous => ({
              ...previous, defaultPeople, mealPeople: previous.mealRecipeIds.length === 0 ? defaultPeople : previous.mealPeople,
            }))} />
          <CountStepper label={t('灶眼数')} value={state.burnerCount} min={1} max={6}
            onChange={burnerCount => update(previous => ({ ...previous, burnerCount }))} />
        </Card.Content>
      </Card>
      <Card mode="contained" style={{ backgroundColor: theme.colors.surface }}>
        <Card.Content style={styles.content}>
          <Text variant="titleLarge">{t('我有的厨具')}</Text>
          {!state.equipmentConfigured && <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>{t('取消家里没有的')}</Text>}
          <View style={styles.chips}>{(Object.keys(equipmentLabels) as Equipment[]).map(id =>
            <Chip key={id} selected={selected.includes(id)} onPress={() => toggleEquipment(id)} showSelectedCheck mode="outlined"
              accessibilityLabel={t('{name}，{state}', { name: equipmentLabels[id], state: t(selected.includes(id) ? '已选' : '未选') })}>{equipmentLabels[id]}</Chip>)}</View>
          <Button mode="contained" buttonColor={theme.colors.primaryContainer} textColor={theme.colors.onPrimaryContainer}
            onPress={() => { update(previous => ({ ...previous, equipment: selected, equipmentConfigured: true })); setSaved(true); }}>
            {t(saved ? '已保存' : '保存厨具')}
          </Button>
        </Card.Content>
      </Card>
      <Button mode="outlined" icon="book-open-page-variant-outline" disabled={disabled} onPress={onOpenPrivateRecipes}>{t('我的菜谱 · {count}', { count: state.privateRecipes.length })}</Button>
      <Button mode="outlined" icon="camera-outline" onPress={() => setVisionSettingsVisible(true)}>{t('识别模型')}</Button>
      <Button mode="outlined" icon="history" onPress={() => setVisionHistoryVisible(true)}>{t('识别记录')}</Button>
      <Button mode="outlined" icon="backup-restore" disabled={disabled} onPress={() => setBackupVisible(true)}>{t('备份与恢复')}</Button>
      <Button mode="outlined" disabled={disabled} onPress={() => setResetVisible(true)}>{t('清除厨房记录')}</Button>
      <Button icon="shield-outline" onPress={() => setNetworkInfoVisible(true)}>{t('隐私与网络')}</Button>
      <Text variant="bodySmall" style={[styles.footer, { color: theme.colors.onSurfaceVariant }]}>{t('{count} 道菜谱 · 数据版本 {version}', { count: catalog.recipes.length, version: catalog.dataset_version })}</Text>
    </ScrollView>
    <Portal><Dialog visible={resetVisible} onDismiss={() => setResetVisible(false)}>
      <Dialog.Title>{t('清除厨房记录？')}</Dialog.Title>
      <Dialog.Content><Text variant="bodyMedium">{t('将清除已选食材、调料柜、菜篮、我的菜谱，以及人数和厨具设置。')}</Text></Dialog.Content>
      <Dialog.Actions><Button onPress={() => setResetVisible(false)}>{t('保留')}</Button><Button onPress={() => { setResetVisible(false); setSaved(false); onReset(); }}>{t('确认清除')}</Button></Dialog.Actions>
    </Dialog></Portal>
    {networkInfoVisible && <NetworkInfoDialog onDismiss={() => setNetworkInfoVisible(false)} />}
    {visionSettingsVisible && <VisionSettingsDialog onDismiss={() => setVisionSettingsVisible(false)}
      onSaved={() => { setVisionSettingsVisible(false); setNotice('模型配置已更新'); }} />}
    {visionHistoryVisible && <VisionHistoryDialog onDismiss={() => setVisionHistoryVisible(false)} />}
    {backupVisible && <BackupDialog catalog={catalog} state={state} onRestore={restore}
      onDismiss={() => setBackupVisible(false)} onCompleted={message => { setBackupVisible(false); setSaved(false); setNotice(message); }} />}
    <Snackbar visible={notice !== null} onDismiss={() => setNotice(null)} duration={3500}>{t(notice ?? '')}</Snackbar>
  </>;
}

const styles = StyleSheet.create({
  page: { padding: 20, gap: 20, paddingBottom: 32 }, heading: { paddingTop: 12, paddingBottom: 6 },
  title: { fontWeight: '700' }, content: { gap: 16, paddingVertical: 20 },
  preferences: { gap: 8, paddingVertical: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, footer: { textAlign: 'center', paddingVertical: 12 },
});
