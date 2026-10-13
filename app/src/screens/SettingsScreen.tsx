import { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Chip, Dialog, Divider, Portal, Text, useTheme } from 'react-native-paper';
import type { Equipment } from '../../../packages/engine/src/types';
import { equipmentLabels } from '../model/presentation';
import type { AppCatalog, KitchenState, UpdateKitchen } from '../model/types';

type Props = { catalog: AppCatalog; state: KitchenState; update: UpdateKitchen; onReset: () => void };

export function SettingsScreen({ catalog, state, update, onReset }: Props) {
  const theme = useTheme();
  const [selected, setSelected] = useState<readonly Equipment[]>(state.equipmentConfigured ? state.equipment : ['wok', 'pot']);
  const [saved, setSaved] = useState(false);
  const [resetVisible, setResetVisible] = useState(false);
  useEffect(() => { if (state.equipmentConfigured) setSelected(state.equipment); }, [state.equipment, state.equipmentConfigured]);
  const toggleEquipment = (id: Equipment) => {
    setSaved(false);
    setSelected(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id]);
  };
  return <>
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.heading}>
        <Text variant="labelLarge" style={{ color: theme.colors.primary }}>我的厨房</Text>
        <Text variant="headlineLarge" style={styles.title}>设置</Text>
        <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>把厨房记在这里，选菜时少想一步。</Text>
      </View>
      <Card mode="contained" style={{ backgroundColor: theme.colors.surface }}>
        <Card.Content style={styles.content}>
          <Text variant="titleLarge">我有的厨具</Text>
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>
            {state.equipmentConfigured ? '推荐会检查厨具是否齐全。选完后记得保存。' : '先选了常见的炒锅和汤锅，请取消没有的，再保存。'}
          </Text>
          <View style={styles.chips}>{(Object.keys(equipmentLabels) as Equipment[]).map(id =>
            <Chip key={id} selected={selected.includes(id)} onPress={() => toggleEquipment(id)} showSelectedCheck mode="outlined"
              accessibilityLabel={`${equipmentLabels[id]}，${selected.includes(id) ? '已选' : '未选'}`}>{equipmentLabels[id]}</Chip>)}</View>
          <Button mode="contained" buttonColor={theme.colors.primaryContainer} textColor={theme.colors.onPrimaryContainer}
            onPress={() => { update(previous => ({ ...previous, equipment: selected, equipmentConfigured: true })); setSaved(true); }}>
            {saved ? '厨具已更新' : '保存厨具'}
          </Button>
        </Card.Content>
      </Card>
      <Card mode="contained" style={{ backgroundColor: theme.colors.surface }}>
        <Card.Content style={styles.content}>
          <Text variant="titleLarge">关于这份菜谱库</Text>
          <Text variant="bodyMedium">已内置 {catalog.recipes.length} 个中式家常做法，供体验食材匹配与操作流程。菜谱和替代用法仍待人工审核。</Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>数据版本 {catalog.dataset_version}</Text>
          <Divider />
          <Text variant="bodyMedium">匹配只确认原料种类。实际下厨前，请核对所需用量与食材状态。</Text>
        </Card.Content>
      </Card>
      <Card mode="contained" style={{ backgroundColor: theme.colors.surface }}>
        <Card.Content style={styles.content}>
          <Text variant="titleLarge">保存在本机</Text>
          <Text variant="bodyMedium">食材、调料柜和厨具记录会自动保存。推荐使用内置菜谱，在本机计算，无需模型账号。</Text>
          {Platform.OS === 'web' && <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>这是浏览器预览，记录保存在当前浏览器；手机 App 使用独立的本地数据库。</Text>}
          <Button mode="outlined" onPress={() => setResetVisible(true)}>清除本机记录</Button>
        </Card.Content>
      </Card>
      <Text variant="labelMedium" style={[styles.footer, { color: theme.colors.onSurfaceVariant }]}>FastCook · 从手头食材开始</Text>
    </ScrollView>
    <Portal><Dialog visible={resetVisible} onDismiss={() => setResetVisible(false)}>
      <Dialog.Title>清除本机记录？</Dialog.Title>
      <Dialog.Content><Text variant="bodyMedium">将清除已选食材、调料柜和厨具设置，需要重新选择。</Text></Dialog.Content>
      <Dialog.Actions><Button onPress={() => setResetVisible(false)}>保留</Button><Button onPress={() => { setResetVisible(false); onReset(); }}>确认清除</Button></Dialog.Actions>
    </Dialog></Portal>
  </>;
}

const styles = StyleSheet.create({
  page: { padding: 20, gap: 20, paddingBottom: 32 }, heading: { gap: 8, paddingTop: 12, paddingBottom: 6 },
  title: { fontWeight: '700' }, content: { gap: 16, paddingVertical: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, footer: { textAlign: 'center', paddingVertical: 12 },
});
