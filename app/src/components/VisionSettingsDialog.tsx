import { useI18n } from '../i18n/useI18n';
import { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Dialog, Portal, SegmentedButtons, Text, TextInput, useTheme } from 'react-native-paper';
import { credentialStore } from '../byok/credentials';
import { DEFAULT_VISION_SETTINGS, OPENAI_ENDPOINT } from '../byok/config';
import type { VisionSettings } from '../byok/types';

export function VisionSettingsDialog({ onDismiss, onSaved }: Readonly<{ onDismiss: () => void; onSaved: () => void }>) {
  const { t } = useI18n();
  const theme = useTheme();
  const [settings, setSettings] = useState<VisionSettings>(DEFAULT_VISION_SETTINGS);
  const [limit, setLimit] = useState(String(DEFAULT_VISION_SETTINGS.dailyLimit));
  const [apiKey, setApiKey] = useState('');
  const [storedSettings, setStoredSettings] = useState<VisionSettings | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const load = async () => {
    setLoaded(false);
    const result = await credentialStore.read();
    if (!mounted.current) return;
    setError(result.error);
    setReadFailed(result.error !== null);
    if (result.data) {
      setSettings(result.data.settings); setLimit(String(result.data.settings.dailyLimit)); setStoredSettings(result.data.settings);
    }
    setLoaded(true);
  };
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, []);
  const save = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    const result = await credentialStore.save({ ...settings, dailyLimit: /^\d+$/.test(limit) ? Number(limit) : NaN }, apiKey);
    inFlight.current = false; setBusy(false);
    if (result.error !== null) { setError(result.error); return; }
    setApiKey(''); onSaved();
  };
  const remove = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    const result = await credentialStore.remove();
    inFlight.current = false; setBusy(false); setDeleting(false);
    if (result.error !== null) { setError(result.error); return; }
    setApiKey(''); setStoredSettings(null); onSaved();
  };
  const changeProtocol = (protocol: string) => {
    if (protocol !== 'openai' && protocol !== 'openai-compatible') return;
    setSettings(previous => ({ ...previous, protocol,
      providerName: protocol === 'openai' ? 'OpenAI' : '', endpoint: protocol === 'openai' ? OPENAI_ENDPOINT : '', model: '',
    }));
    setApiKey('');
  };
  const dismiss = () => { if (!inFlight.current) { setApiKey(''); onDismiss(); } };
  return <Portal><Dialog visible onDismiss={dismiss} style={styles.dialog}>
    <Dialog.Title>{t('识别模型')}</Dialog.Title>
    <Dialog.ScrollArea style={styles.scroll}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {!loaded ? <ActivityIndicator /> : <>
        <SegmentedButtons value={settings.protocol} onValueChange={changeProtocol} buttons={[
          { value: 'openai', label: 'OpenAI', disabled: busy }, { value: 'openai-compatible', label: t('兼容服务'), disabled: busy },
        ]} />
        {settings.protocol === 'openai-compatible' && <>
          <TextInput label={t('服务商名称')} mode="outlined" value={settings.providerName} maxLength={48} disabled={busy}
            onChangeText={providerName => setSettings(previous => ({ ...previous, providerName }))} />
          <TextInput label={t('完整请求地址')} mode="outlined" value={settings.endpoint} maxLength={512} disabled={busy}
            autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://…/v1/chat/completions"
            onChangeText={endpoint => setSettings(previous => ({ ...previous, endpoint }))} />
        </>}
        <TextInput label={t('视觉模型名称')} mode="outlined" value={settings.model} maxLength={128} disabled={busy}
          autoCapitalize="none" autoCorrect={false} onChangeText={model => setSettings(previous => ({ ...previous, model }))} />
        <TextInput label={storedSettings?.endpoint === settings.endpoint && storedSettings?.protocol === settings.protocol ? t('API Key（已保存，留空保留）') : 'API Key'} mode="outlined"
          value={apiKey} onChangeText={setApiKey} secureTextEntry autoCapitalize="none" autoCorrect={false}
          autoComplete="off" textContentType="none" maxLength={1024} disabled={busy} />
        <TextInput label={t('每日调用上限')} mode="outlined" value={limit} onChangeText={setLimit} maxLength={3}
          keyboardType="number-pad" disabled={busy} />
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
          {t(Platform.OS === 'web' ? '密钥仅保留在本次页面会话。请同时在服务商控制台设置预算。'
            : '密钥加密保存在本机，不进入厨房备份。请同时在服务商控制台设置预算。')}
        </Text>
        {(storedSettings || readFailed) && <Button icon="key-remove" disabled={busy} onPress={() => setDeleting(true)}>{t('删除模型配置与密钥')}</Button>}
      </>}
      {error && <Text accessibilityRole="alert" style={{ color: theme.colors.error }}>{t(error)}</Text>}
      {deleting && <View style={styles.content}><Text>{t('删除后，拍照识别需要重新配置。')}</Text>
        <View style={styles.row}><Button disabled={busy} onPress={() => setDeleting(false)}>{t('保留')}</Button>
          <Button disabled={busy} onPress={() => void remove()}>{t('确认删除')}</Button></View></View>}
    </ScrollView></Dialog.ScrollArea>
    <Dialog.Actions><Button disabled={busy} onPress={dismiss}>{t('关闭')}</Button>
      <Button mode="contained" disabled={!loaded || busy || deleting} loading={busy} onPress={() => void save()}>{t('保存')}</Button></Dialog.Actions>
  </Dialog></Portal>;
}

const styles = StyleSheet.create({
  dialog: { width: '92%', maxWidth: 520, maxHeight: '90%', alignSelf: 'center' }, scroll: { maxHeight: 520, flexShrink: 1 },
  content: { paddingVertical: 12, gap: 14 }, row: { flexDirection: 'row', justifyContent: 'flex-end' },
});
