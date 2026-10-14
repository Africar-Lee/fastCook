import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Dialog, Portal, Text } from 'react-native-paper';

export function NetworkInfoDialog({ onDismiss }: Readonly<{ onDismiss: () => void }>) {
  return <Portal><Dialog visible onDismiss={onDismiss} style={styles.dialog}>
    <Dialog.Title>隐私与网络</Dialog.Title>
    <Dialog.ScrollArea style={styles.scroll}><ScrollView contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text variant="titleSmall">本机使用</Text>
        <Text>菜谱随应用提供，食材、调料柜、菜篮和设置保存在本机，推荐离线计算。</Text>
      </View>
      <View style={styles.section}>
        <Text variant="titleSmall">外部链接</Text>
        <Text>点击菜谱原文或许可时，所选链接交给浏览器访问 github.com 或 raw.githubusercontent.com。</Text>
      </View>
      <View style={styles.section}>
        <Text variant="titleSmall">备份与恢复</Text>
        <Text>由你选择本地文件导入或导出，包含食材、调料柜、菜篮和设置。</Text>
      </View>
      <View style={styles.section}>
        <Text variant="titleSmall">问题报告</Text>
        <Text>报告由你预览并导出，包含问题描述、菜谱标识和版本信息。食材库存、调料柜和厨具记录不会自动附加。</Text>
      </View>
      <Text>应用不主动上传数据，不收集使用统计，也不自动上报崩溃。</Text>
    </ScrollView></Dialog.ScrollArea>
    <Dialog.Actions><Button onPress={onDismiss}>关闭</Button></Dialog.Actions>
  </Dialog></Portal>;
}

const styles = StyleSheet.create({
  dialog: { maxWidth: 520, width: '90%', maxHeight: '90%', alignSelf: 'center' },
  scroll: { maxHeight: 420, flexShrink: 1 },
  content: { paddingVertical: 16, gap: 20 }, section: { gap: 6 },
});
