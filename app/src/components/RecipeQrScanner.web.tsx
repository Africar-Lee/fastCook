import { useI18n } from '../i18n/useI18n';
import { StyleSheet } from 'react-native';
import { Button, Dialog, Portal, Text } from 'react-native-paper';

type Props = Readonly<{ onScan: (value: string) => void; onDismiss: () => void }>;

export function RecipeQrScanner({ onDismiss }: Props) {
  const { t } = useI18n();
  return <Portal><Dialog visible onDismiss={onDismiss} style={styles.dialog}>
    <Dialog.Title>{t('导入菜谱')}</Dialog.Title>
    <Dialog.Content><Text>{t('网页版请使用文件导入，手机应用支持扫描二维码。')}</Text></Dialog.Content>
    <Dialog.Actions><Button onPress={onDismiss}>{t('关闭')}</Button></Dialog.Actions>
  </Dialog></Portal>;
}

const styles = StyleSheet.create({ dialog: { alignSelf: 'center', width: '92%', maxWidth: 520, marginHorizontal: 0 } });
