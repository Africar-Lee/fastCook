import { t } from '../i18n/core';
import { useI18n } from '../i18n/useI18n';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Dialog, Portal, Text } from 'react-native-paper';

export function NetworkInfoDialog({ onDismiss }: Readonly<{ onDismiss: () => void }>) {
  useI18n();
  return <Portal><Dialog visible onDismiss={onDismiss} style={styles.dialog}>
    <Dialog.Title>{t('隐私与网络')}</Dialog.Title>
    <Dialog.ScrollArea style={styles.scroll}><ScrollView contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text variant="titleSmall">{t('本机使用')}</Text>
        <Text>{t('内置菜谱随应用提供，我的菜谱、食材、调料柜、菜篮和设置保存在本机，推荐离线计算。')}</Text>
      </View>
      <View style={styles.section}>
        <Text variant="titleSmall">{t('拍照识别')}</Text>
        <Text>{t('确认发送后，设备直接向所选服务商发送处理后的图片和识别指令。食材库存、调料柜和历史记录不会附加。')}</Text>
        <Text>{t(Platform.OS === 'web' ? 'API Key 仅保留在本次页面会话。' : 'API Key 加密保存在本机。')}{' '}{t('识别记录保留请求摘要、状态和用量，不保存图片或密钥，可随时清空。')}</Text>
      </View>
      <View style={styles.section}>
        <Text variant="titleSmall">{t('外部链接')}</Text>
        <Text>{t('点击菜谱原文或许可时，所选链接交给浏览器访问 github.com 或 raw.githubusercontent.com。')}</Text>
      </View>
      <View style={styles.section}>
        <Text variant="titleSmall">{t('备份与恢复')}</Text>
        <Text>{t('由你选择本地文件导入或导出，包含我的菜谱、食材、调料柜、菜篮和厨房设置，不包含模型配置、密钥和识别记录。')}</Text>
      </View>
      <View style={styles.section}>
        <Text variant="titleSmall">{t('菜谱分享')}</Text>
        <Text>{t('文件和二维码仅包含选中的菜谱。扫码在本机完成，分享文件由你选择的应用发送。')}</Text>
      </View>
      <View style={styles.section}>
        <Text variant="titleSmall">{t('问题报告')}</Text>
        <Text>{t('报告由你预览并导出，包含问题描述、菜谱标识和版本信息。食材库存、调料柜和厨具记录不会自动附加。')}</Text>
      </View>
      <Text>{t('应用不主动上传数据，不收集使用统计，也不自动上报崩溃。')}</Text>
    </ScrollView></Dialog.ScrollArea>
    <Dialog.Actions><Button onPress={onDismiss}>{t('关闭')}</Button></Dialog.Actions>
  </Dialog></Portal>;
}

const styles = StyleSheet.create({
  dialog: { maxWidth: 520, width: '90%', maxHeight: '90%', alignSelf: 'center' },
  scroll: { maxHeight: 420, flexShrink: 1 },
  content: { paddingVertical: 16, gap: 20 }, section: { gap: 6 },
});
