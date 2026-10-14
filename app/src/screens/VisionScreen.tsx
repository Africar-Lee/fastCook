import { useI18n } from '../i18n/useI18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Appbar, Button, Card, Checkbox, Surface, Text, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { credentialStore } from '../byok/credentials';
import { historyStore } from '../byok/history';
import { mapVisionItems } from '../byok/mapping';
import type { MappedVisionItem } from '../byok/mapping';
import { pickVisionPhoto } from '../byok/photo';
import { recognizePhoto } from '../byok/recognition';
import { buildVisionRequest } from '../byok/request';
import type { VisionPhoto, VisionRequest, VisionSettings } from '../byok/types';
import { IngredientPicker } from '../components/IngredientPicker';
import { VisionHistoryDialog } from '../components/VisionHistoryDialog';
import { VisionSettingsDialog } from '../components/VisionSettingsDialog';
import { nameOf } from '../model/presentation';
import type { AppCatalog } from '../model/types';

type Props = Readonly<{ catalog: AppCatalog; onBack: () => void; onConfirm: (ids: readonly string[]) => string | null }>;
type Selection = Readonly<{ mapped: MappedVisionItem; ingredientId: string | null; included: boolean }>;

function RequestPreview({ request, usedCalls }: Readonly<{ request: VisionRequest; usedCalls: number }>) {
  const { locale, t } = useI18n();
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const previewBody = useMemo(() => JSON.stringify(JSON.parse(request.body.replace(request.photo.base64, t('[上方已预览的图片]', {}, locale))), null, 2), [request, locale, t]);
  return <Card mode="outlined"><Card.Content style={styles.content}>
    <Text variant="titleMedium">{request.settings.providerName} · {request.settings.model}</Text>
    <Text selectable variant="bodySmall">{request.settings.endpoint}</Text>
    <Text variant="bodySmall">JPEG · {request.photo.width} × {request.photo.height} · {Math.ceil(request.photo.bytes / 1024)} KB</Text>
    <Text variant="bodySmall">{t('今日 {used} / {limit} 次', { used: usedCalls, limit: request.settings.dailyLimit })}</Text>
    <Button compact onPress={() => setExpanded(previous => !previous)}>{t(expanded ? '收起请求内容' : '查看请求内容')}</Button>
    {expanded && <>
      <Text selectable variant="bodySmall">{t('POST · Content-Type: application/json\nAuthorization: Bearer [已隐藏]')}</Text>
      <Text selectable variant="bodySmall">{previewBody}</Text>
    </>}
    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{t('仅发送这张图片与识别指令，费用由服务商收取。')}</Text>
  </Card.Content></Card>;
}

function RecognitionResults({ catalog, selections, onToggle, onChange }: Readonly<{
  catalog: AppCatalog; selections: readonly Selection[]; onToggle: (index: number) => void; onChange: (index: number) => void;
}>) {
  const { t } = useI18n();
  const theme = useTheme();
  return <View style={styles.content}>
    <Text variant="titleLarge">{t('确认食材')}</Text>
    {selections.length === 0 && <Text>{t('没有识别出食材，可以重新选图或返回手动选择。')}</Text>}
    {selections.map((selection, index) => <Card key={index} mode="outlined"><Card.Content style={styles.result}>
      <View style={styles.row}>
        <Checkbox.Android status={selection.included ? 'checked' : 'unchecked'} disabled={!selection.ingredientId}
          accessibilityLabel={t(selection.included ? '{name}，已选' : '{name}，未选', {
            name: selection.ingredientId ? nameOf(catalog, selection.ingredientId) : selection.mapped.item.name,
          })} onPress={() => onToggle(index)} />
        <View style={styles.grow}>
          <Text variant="titleMedium">{selection.ingredientId ? nameOf(catalog, selection.ingredientId) : selection.mapped.item.name}</Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            {selection.mapped.item.quantity ? t('{quantity} · 置信度 {confidence}%', {
              quantity: selection.mapped.item.quantity, confidence: Math.round(selection.mapped.item.confidence * 100),
            }) : t('置信度 {confidence}%', { confidence: Math.round(selection.mapped.item.confidence * 100) })}
          </Text>
          {!selection.ingredientId && <Text variant="bodySmall" style={{ color: theme.colors.error }}>{t('请选择对应食材或忽略')}</Text>}
        </View>
        <Button compact onPress={() => onChange(index)}>{t('改选')}</Button>
      </View>
    </Card.Content></Card>)}
  </View>;
}

export function VisionScreen({ catalog, onBack, onConfirm }: Props) {
  const { t } = useI18n();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [settings, setSettings] = useState<VisionSettings | null>(null);
  const [usedCalls, setUsedCalls] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [photo, setPhoto] = useState<VisionPhoto | null>(null);
  const [selections, setSelections] = useState<readonly Selection[] | null>(null);
  const [busy, setBusy] = useState<'photo' | 'request' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [changing, setChanging] = useState<number | null>(null);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const request = useMemo(() => photo && settings ? buildVisionRequest(settings, photo) : null, [photo, settings]);
  const selectedIds = [...new Set(selections?.filter(item => item.included && item.ingredientId).map(item => item.ingredientId!) ?? [])];
  const load = async () => {
    const [credentials, history] = await Promise.all([credentialStore.read(), historyStore.read()]);
    if (!mounted.current) return;
    setSettings(credentials.data?.settings ?? null); setUsedCalls(history.data?.usedCalls ?? 0);
    setError(credentials.error ?? history.error); setLoaded(true);
  };
  useEffect(() => {
    mounted.current = true; void load();
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);
  const choose = async (source: 'camera' | 'library') => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy('photo'); setError(null);
    const result = await pickVisionPhoto(source);
    inFlight.current = false;
    if (!mounted.current) return;
    setBusy(null);
    if (result.status === 'failed') { setError(result.error); return; }
    if (result.status === 'selected') { setPhoto(result.photo); setSelections(null); }
  };
  const send = async () => {
    if (inFlight.current || !request?.data) return;
    inFlight.current = true; setBusy('request'); setError(null);
    const abort = new AbortController(); controller.current = abort;
    const result = await recognizePhoto(request.data, abort.signal);
    const history = await historyStore.read();
    inFlight.current = false; controller.current = null;
    if (!mounted.current) return;
    setBusy(null); setUsedCalls(history.data?.usedCalls ?? usedCalls);
    if (result.error !== null) { setError(result.error); return; }
    setError(result.data.historyError ?? history.error);
    setSelections(mapVisionItems(catalog, result.data.response.items).map(mapped => ({
      mapped, ingredientId: mapped.selectedId, included: mapped.selectedId !== null && mapped.item.confidence >= 0.7,
    })));
  };
  const toggle = (index: number) => setSelections(previous => previous?.map((item, position) =>
    position === index ? { ...item, included: !item.included } : item) ?? null);
  const change = (id: string) => {
    setSelections(previous => previous?.map((item, index) => index === changing ? { ...item, ingredientId: id, included: true } : item) ?? null);
    setChanging(null);
  };
  const confirm = () => {
    const failure = onConfirm(selectedIds);
    if (failure) setError(failure);
  };
  return <View style={styles.root}>
    <Appbar.Header statusBarHeight={0}><Appbar.BackAction accessibilityLabel={t('返回食材')} onPress={onBack} />
      <Appbar.Content title={t('拍照识别')} />
      <Appbar.Action icon="history" accessibilityLabel={t('识别记录')} disabled={busy !== null} onPress={() => setHistoryVisible(true)} />
      <Appbar.Action icon="cog-outline" accessibilityLabel={t('识别模型设置')} disabled={busy !== null} onPress={() => setSettingsVisible(true)} />
    </Appbar.Header>
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      {!loaded && <ActivityIndicator />}
      {loaded && !settings && <Button mode="contained-tonal" icon="key-outline" disabled={busy !== null} onPress={() => setSettingsVisible(true)}>{t('设置识别模型')}</Button>}
      {photo && <Image source={{ uri: photo.uri }} accessibilityLabel={t('待识别照片')} resizeMode="contain" style={styles.photo} />}
      {selections === null && <>
        <View style={styles.row}>
          <Button style={styles.grow} mode="contained-tonal" icon="camera" disabled={busy !== null} onPress={() => void choose('camera')}>{t('拍照')}</Button>
          <Button style={styles.grow} mode="outlined" icon="image-outline" disabled={busy !== null} onPress={() => void choose('library')}>{t('相册')}</Button>
        </View>
        {request?.data && <RequestPreview request={request.data} usedCalls={usedCalls} />}
      </>}
      {selections && <RecognitionResults catalog={catalog} selections={selections} onToggle={toggle} onChange={setChanging} />}
      {(error || request?.error) && <Text accessibilityRole="alert" style={{ color: theme.colors.error }}>{t(error ?? request?.error ?? '')}</Text>}
      {busy === 'photo' && <ActivityIndicator />}
      {selections && <Button onPress={() => { setSelections(null); setPhoto(null); setError(null); }}>{t('重新选图')}</Button>}
    </ScrollView>
    {(request?.data || selections) && <Surface elevation={1} style={[styles.footer, { paddingBottom: Math.max(16, insets.bottom) }]}>
      {selections ? <Button mode="contained" disabled={selectedIds.length === 0} onPress={confirm}>{t('加入当次食材 · {count} 种', { count: selectedIds.length })}</Button>
        : busy === 'request' ? <View style={styles.row}><ActivityIndicator size="small" /><Text style={styles.grow}>{t('正在识别')}</Text>
          <Button onPress={() => controller.current?.abort()}>{t('取消')}</Button></View>
          : <Button mode="contained" disabled={busy !== null || !request?.data || usedCalls >= (settings?.dailyLimit ?? 0)} onPress={() => void send()}>
            {t(usedCalls >= (settings?.dailyLimit ?? 0) ? '今日调用已达上限' : '发送并识别')}
          </Button>}
    </Surface>}
    {settingsVisible && <VisionSettingsDialog onDismiss={() => setSettingsVisible(false)} onSaved={() => { setSettingsVisible(false); void load(); }} />}
    {historyVisible && <VisionHistoryDialog onDismiss={() => { setHistoryVisible(false); void load(); }} />}
    {changing !== null && <IngredientPicker visible title={t('确认{name}', { name: selections?.[changing]?.mapped.item.name ?? t('食材') })} location="current"
      ingredients={catalog.ingredients} selectedIds={selections?.[changing]?.ingredientId ? [selections[changing]!.ingredientId!] : []}
      otherSelectedIds={[]} onToggle={change} onDismiss={() => setChanging(null)} />}
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 }, page: { padding: 20, gap: 16, paddingBottom: 32 }, content: { gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 }, grow: { flex: 1 },
  photo: { width: '100%', height: 220, borderRadius: 16 }, footer: { padding: 16, paddingBottom: 24 }, result: { paddingHorizontal: 8 },
});
