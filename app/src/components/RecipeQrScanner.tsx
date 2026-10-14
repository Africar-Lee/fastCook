import { useI18n } from '../i18n/useI18n';
import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, StyleSheet, View, useWindowDimensions } from 'react-native';
import { ActivityIndicator, Button, Dialog, Portal, Text, useTheme } from 'react-native-paper';
import { Camera, CameraView } from 'expo-camera';
import type { BarcodeScanningResult, PermissionResponse } from 'expo-camera';
import { failure, success } from '../storage/types';

type Props = Readonly<{ onScan: (value: string) => void; onDismiss: () => void }>;

export function RecipeQrScanner({ onScan, onDismiss }: Props) {
  const { t } = useI18n();
  const theme = useTheme();
  const { height } = useWindowDimensions();
  const [permission, setPermission] = useState<PermissionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState(false);
  const mounted = useRef(true);
  const scanningStopped = useRef(false);
  const activeRef = useRef(active);
  const permissionPending = useRef(false);

  const checkPermission = async (request: boolean) => {
    if (permissionPending.current || scanningStopped.current) return;
    permissionPending.current = true; setLoading(true); setError(null);
    const result = await (request ? Camera.requestCameraPermissionsAsync() : Camera.getCameraPermissionsAsync()).then(
      success, () => failure<PermissionResponse>('无法读取相机权限，请重试。'),
    );
    permissionPending.current = false;
    if (!mounted.current || scanningStopped.current) return;
    setLoading(false);
    if (result.error !== null) { setPermission(null); setError(result.error); return; }
    setPermission(result.data);
    if (request && !result.data.granted) setError('相机权限未开启，请允许访问相机后重试。');
  };

  useEffect(() => {
    mounted.current = true; scanningStopped.current = false;
    void checkPermission(false);
    const subscription = AppState.addEventListener('change', state => {
      activeRef.current = state === 'active'; setActive(activeRef.current);
      if (activeRef.current) void checkPermission(false);
    });
    return () => { mounted.current = false; scanningStopped.current = true; subscription.remove(); };
  }, []);

  const dismiss = () => {
    scanningStopped.current = true; setCompleted(true); onDismiss();
  };
  const scan = (result: BarcodeScanningResult) => {
    if (!mounted.current || !activeRef.current || scanningStopped.current || permissionPending.current || result.type !== 'qr'
      || typeof result.data !== 'string' || result.data.length === 0) return;
    scanningStopped.current = true; setCompleted(true); onScan(result.data);
  };
  const openSettings = async () => {
    const result = await Linking.openSettings().then(() => success(undefined), () => failure('无法打开系统设置，请手动开启相机权限。'));
    if (mounted.current && !scanningStopped.current) setError(result.error);
  };
  const retryCamera = () => { setCameraError(false); setError(null); };
  const canScan = permission?.granted && !loading && active && !completed && !cameraError;

  return <Portal><Dialog visible onDismiss={dismiss} dismissableBackButton style={[styles.dialog, { maxHeight: height * 0.9 }]}>
    <Dialog.Title>{t('扫描菜谱二维码')}</Dialog.Title>
    <Dialog.Content style={styles.content}>
      {loading && <ActivityIndicator accessibilityLabel={t('读取相机权限')} />}
      {canScan && <View style={[styles.preview, { maxHeight: height * 0.5 }]}>
        <CameraView style={StyleSheet.absoluteFill} facing="back" autofocus="on" mute
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={scan}
          onMountError={() => {
            if (!mounted.current || scanningStopped.current) return;
            setCameraError(true); setError('相机无法启动，请关闭其他相机应用后重试。');
          }} />
      </View>}
      {!loading && !permission?.granted && <>
        <Text>{t('允许使用相机扫描菜谱二维码')}</Text>
        {permission?.canAskAgain === false
          ? <Button mode="contained" onPress={() => void openSettings()}>{t('打开系统设置')}</Button>
          : <Button mode="contained" onPress={() => void checkPermission(true)}>{t('开启相机')}</Button>}
      </>}
      {!loading && permission?.granted && !active && <Text>{t('返回应用后继续扫描')}</Text>}
      {cameraError && <Button mode="outlined" onPress={retryCamera}>{t('重试相机')}</Button>}
      {error && <Text accessibilityRole="alert" style={{ color: theme.colors.error }}>{t(error)}</Text>}
    </Dialog.Content>
    <Dialog.Actions><Button onPress={dismiss}>{t('取消')}</Button></Dialog.Actions>
  </Dialog></Portal>;
}

const styles = StyleSheet.create({
  dialog: { alignSelf: 'center', width: '92%', maxWidth: 520, marginHorizontal: 0 },
  content: { gap: 16 }, preview: { width: '100%', aspectRatio: 1, borderRadius: 12, overflow: 'hidden' },
});
