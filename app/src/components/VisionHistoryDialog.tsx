import { useI18n } from '../i18n/useI18n';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Card, Dialog, Portal, Text, useTheme } from 'react-native-paper';
import { historyStore } from '../byok/history';
import type { VisionCall, VisionHistory } from '../byok/types';
import { formatDate } from '../i18n/core';

const statusLabels = { pending: '未完成', succeeded: '成功', failed: '失败', cancelled: '已取消' } as const;

function CallRecord({ call }: Readonly<{ call: VisionCall }>) {
  const { t } = useI18n();
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  return <Card mode="outlined"><Card.Content style={styles.record}>
    <Text variant="titleSmall">{call.settings.providerName} · {t(statusLabels[call.status])}</Text>
    <Text variant="bodySmall">{formatDate(call.timestamp)} · {call.settings.model}</Text>
    {call.itemCount !== undefined && <Text>{t('识别出 {count} 项', { count: call.itemCount })}</Text>}
    {call.usage?.totalTokens !== undefined && <Text>{t('用量 {count} tokens', { count: call.usage.totalTokens })}</Text>}
    {call.error && <Text style={{ color: theme.colors.error }}>{t(call.error)}</Text>}
    <Button compact onPress={() => setExpanded(previous => !previous)}>{t(expanded ? '收起请求' : '查看请求')}</Button>
    {expanded && <View style={styles.record}>
      <Text selectable variant="bodySmall">POST {call.settings.endpoint}</Text>
      <Text variant="bodySmall">JPEG · {call.image.width} × {call.image.height} · {Math.ceil(call.image.bytes / 1024)} KB</Text>
      <Text selectable variant="bodySmall">{call.prompt}</Text>
      <Text variant="bodySmall">{t('输出上限 1200 tokens · Authorization 已隐藏 · 图片内容未留存')}</Text>
    </View>}
  </Card.Content></Card>;
}

export function VisionHistoryDialog({ onDismiss }: Readonly<{ onDismiss: () => void }>) {
  const { t } = useI18n();
  const theme = useTheme();
  const [history, setHistory] = useState<VisionHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmRepair, setConfirmRepair] = useState(false);
  const load = async () => {
    setBusy(true);
    const result = await historyStore.read();
    setHistory(result.data); setError(result.error); setBusy(false);
  };
  useEffect(() => { void load(); }, []);
  const clear = async () => {
    setBusy(true);
    const result = await historyStore.clear();
    setBusy(false); setConfirmClear(false);
    if (result.error !== null) { setError(result.error); return; }
    await load();
  };
  const repair = async () => {
    setBusy(true);
    const result = await historyStore.repair();
    setBusy(false); setConfirmRepair(false);
    if (result.error !== null) { setError(result.error); return; }
    await load();
  };
  return <Portal><Dialog visible onDismiss={() => { if (!busy) onDismiss(); }} style={styles.dialog}>
    <Dialog.Title>{t('识别记录')}</Dialog.Title>
    <Dialog.ScrollArea style={styles.scroll}><ScrollView contentContainerStyle={styles.content}>
      {busy && <ActivityIndicator />}
      {history && <Text>{t('今日已发起 {count} 次', { count: history.usedCalls })}</Text>}
      {history?.calls.length === 0 && <Text>{t('暂无识别记录')}</Text>}
      {history?.calls.map(call => <CallRecord key={call.id} call={call} />)}
      {error && <><Text accessibilityRole="alert" style={{ color: theme.colors.error }}>{t(error)}</Text><Button disabled={busy} onPress={() => void load()}>{t('重新读取')}</Button></>}
      {error && !history && <Button disabled={busy} onPress={() => setConfirmRepair(previous => !previous)}>{t(confirmRepair ? '保留记录' : '修复记录')}</Button>}
      {confirmRepair && <View style={styles.record}><Text>{t('修复会清除损坏的记录。无法确认调用次数时，识别将暂停至明天。')}</Text>
        <Button disabled={busy} onPress={() => void repair()}>{t('确认修复')}</Button></View>}
      {confirmClear && <View style={styles.record}><Text>{t('清空调用记录？今日调用次数仍保留。')}</Text>
        <Button disabled={busy} onPress={() => void clear()}>{t('确认清空')}</Button></View>}
    </ScrollView></Dialog.ScrollArea>
    <Dialog.Actions>
      {!!history?.calls.length && <Button disabled={busy} onPress={() => setConfirmClear(previous => !previous)}>{t(confirmClear ? '保留记录' : '清空记录')}</Button>}
      <Button disabled={busy} onPress={onDismiss}>{t('关闭')}</Button>
    </Dialog.Actions>
  </Dialog></Portal>;
}

const styles = StyleSheet.create({
  dialog: { width: '92%', maxWidth: 520, maxHeight: '90%', alignSelf: 'center' }, scroll: { maxHeight: 540, flexShrink: 1 },
  content: { paddingVertical: 12, gap: 14 }, record: { gap: 8 },
});
