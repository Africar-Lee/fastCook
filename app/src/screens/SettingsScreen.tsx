import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Chip, Dialog, Portal, Text, useTheme } from 'react-native-paper';
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
        <Text variant="headlineLarge" style={styles.title}>设置</Text>
      </View>
      <Card mode="contained" style={{ backgroundColor: theme.colors.surface }}>
        <Card.Content style={styles.content}>
          <Text variant="titleLarge">我有的厨具</Text>
          {!state.equipmentConfigured && <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>取消家里没有的</Text>}
          <View style={styles.chips}>{(Object.keys(equipmentLabels) as Equipment[]).map(id =>
            <Chip key={id} selected={selected.includes(id)} onPress={() => toggleEquipment(id)} showSelectedCheck mode="outlined"
              accessibilityLabel={`${equipmentLabels[id]}，${selected.includes(id) ? '已选' : '未选'}`}>{equipmentLabels[id]}</Chip>)}</View>
          <Button mode="contained" buttonColor={theme.colors.primaryContainer} textColor={theme.colors.onPrimaryContainer}
            onPress={() => { update(previous => ({ ...previous, equipment: selected, equipmentConfigured: true })); setSaved(true); }}>
            {saved ? '已保存' : '保存厨具'}
          </Button>
        </Card.Content>
      </Card>
      <Button mode="outlined" onPress={() => setResetVisible(true)}>清除本机记录</Button>
      <Text variant="bodySmall" style={[styles.footer, { color: theme.colors.onSurfaceVariant }]}>{catalog.recipes.length} 道菜谱 · 数据版本 {catalog.dataset_version}</Text>
    </ScrollView>
    <Portal><Dialog visible={resetVisible} onDismiss={() => setResetVisible(false)}>
      <Dialog.Title>清除本机记录？</Dialog.Title>
      <Dialog.Content><Text variant="bodyMedium">将清除已选食材、调料柜和厨具设置。</Text></Dialog.Content>
      <Dialog.Actions><Button onPress={() => setResetVisible(false)}>保留</Button><Button onPress={() => { setResetVisible(false); onReset(); }}>确认清除</Button></Dialog.Actions>
    </Dialog></Portal>
  </>;
}

const styles = StyleSheet.create({
  page: { padding: 20, gap: 20, paddingBottom: 32 }, heading: { paddingTop: 12, paddingBottom: 6 },
  title: { fontWeight: '700' }, content: { gap: 16, paddingVertical: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, footer: { textAlign: 'center', paddingVertical: 12 },
});
