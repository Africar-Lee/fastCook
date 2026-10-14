import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Chip, Text, useTheme } from 'react-native-paper';
import type { Equipment } from '../../../packages/engine/src/types';
import { IngredientPicker } from '../components/IngredientPicker';
import { addIngredient, markUnavailable } from '../model/inventory-actions';
import { completePantrySetup, excludeUnavailableSelections, initialPantrySelection, pantrySetupChoices } from '../model/pantry-setup';
import type { AppCatalog, KitchenState, UpdateKitchen } from '../model/types';

type Props = Readonly<{
  catalog: AppCatalog;
  state: KitchenState;
  update: UpdateKitchen;
  onSetupComplete: () => void;
  onSkipSetup: () => void;
}>;

const equipmentOptions: readonly Readonly<{ id: Equipment; label: string }>[] = [
  { id: 'wok', label: '炒锅' }, { id: 'pot', label: '汤锅' }, { id: 'frying_pan', label: '平底锅' }, { id: 'steamer', label: '蒸锅' },
];

export function PantryScreen({ catalog, state, update, onSetupComplete, onSkipSetup }: Props) {
  const theme = useTheme();
  const [pickerVisible, setPickerVisible] = useState(false);
  const [manualSelection, setManualSelection] = useState(false);
  const [draftIds, setDraftIds] = useState<readonly string[]>(() => initialPantrySelection(catalog, state));
  const [draftEquipment, setDraftEquipment] = useState<readonly Equipment[]>(['wok', 'pot']);
  const choiceIds = manualSelection ? draftIds : pantrySetupChoices(catalog, state);
  const names = new Map(catalog.ingredients.map((item) => [item.ingredient_id, item.names['zh-CN'] ?? item.ingredient_id]));
  const staples = catalog.ingredients.filter((item) => item.implicit_staple);

  const toggleDraft = (id: string) => setDraftIds((previous) => previous.includes(id) ? previous.filter((value) => value !== id) : [...previous, id]);
  const togglePantry = (id: string) => update((previous) => {
    if (previous.pantryIds.includes(id)) return { ...previous, pantryIds: previous.pantryIds.filter((value) => value !== id) };
    return addIngredient(previous, catalog, id, 'pantry');
  });
  const saveSetup = () => {
    update((previous) => completePantrySetup(previous, catalog, draftIds, draftEquipment));
    onSetupComplete();
  };
  const openManualSelection = () => {
    if (!manualSelection) {
      setDraftIds(state.pantryIds);
      setManualSelection(true);
    }
    setPickerVisible(true);
  };
  const toggleStaple = (id: string) => {
    if (!state.pantryConfigured && !state.unavailableIds.includes(id)) {
      setDraftIds(previous => excludeUnavailableSelections(catalog, previous, [id]));
    }
    update((previous) => {
      if (previous.unavailableIds.includes(id)) return { ...previous, unavailableIds: previous.unavailableIds.filter((value) => value !== id) };
      return markUnavailable(previous, catalog, id);
    });
  };

  return (
    <>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.heading}>
          <Text variant="headlineLarge" style={styles.title}>我的调料柜</Text>
        </View>

        {!state.pantryConfigured ? <Card mode="contained" style={{ backgroundColor: theme.colors.surface }}>
          <Card.Content style={styles.cardContent}>
            <View style={styles.sectionRow}><Text variant="titleMedium" style={styles.bold}>常备调料</Text><Text variant="labelMedium">{draftIds.length} 种</Text></View>
            {!manualSelection && <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>取消家里没有的</Text>}
            {choiceIds.length > 0 && <View style={styles.chips}>
              {choiceIds.map((id) => <Chip key={id} selected={draftIds.includes(id)} onPress={() => toggleDraft(id)} style={draftIds.includes(id) ? { backgroundColor: theme.colors.secondaryContainer } : undefined}>{names.get(id) ?? id}</Chip>)}
            </View>}
            {manualSelection && draftIds.length === 0 && <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>暂无常备食材</Text>}
            {!state.equipmentConfigured && <View style={styles.equipment}>
              <View style={styles.sectionRow}><Text variant="titleSmall">常用厨具</Text><Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>取消没有的</Text></View>
              <View style={styles.chips}>{equipmentOptions.map((item) => <Chip key={item.id} selected={draftEquipment.includes(item.id)} onPress={() => setDraftEquipment((previous) => previous.includes(item.id) ? previous.filter((value) => value !== item.id) : [...previous, item.id])} style={draftEquipment.includes(item.id) ? { backgroundColor: theme.colors.secondaryContainer } : undefined}>{item.label}</Chip>)}</View>
            </View>}
            <Button mode="contained" onPress={saveSetup} buttonColor={theme.colors.primaryContainer} textColor={theme.colors.onPrimaryContainer} contentStyle={styles.primaryButton}>保存调料柜</Button>
            <Button mode="text" onPress={openManualSelection}>{manualSelection ? '添加常备食材' : '手动选择'}</Button>
            <Button mode="text" onPress={onSkipSetup}>稍后设置</Button>
          </Card.Content>
        </Card> : <Card mode="contained" style={{ backgroundColor: theme.colors.surface }}>
          <Card.Content style={styles.cardContent}>
            <View style={styles.sectionRow}><Text variant="titleMedium" style={styles.bold}>常备调料</Text><Text variant="labelMedium">{state.pantryIds.length} 种</Text></View>
            {state.pantryIds.length > 0 ? <View style={styles.chips}>{state.pantryIds.map((id) => <Chip key={id} onClose={() => togglePantry(id)} closeIcon="close" style={{ backgroundColor: theme.colors.primaryContainer }}>{names.get(id) ?? id}</Chip>)}</View> : <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>暂无常备食材</Text>}
            <Button mode="contained" icon="plus" contentStyle={styles.primaryButton} onPress={() => setPickerVisible(true)}>添加常备食材</Button>
          </Card.Content>
        </Card>}

        <Card mode="outlined" style={styles.staplesCard}>
          <Card.Content style={styles.cardContent}>
            <View style={styles.sectionRow}><Text variant="titleMedium" style={styles.bold}>基础食材</Text><Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>默认已有</Text></View>
            <View style={styles.chips}>{staples.map((item) => {
              const missing = state.unavailableIds.includes(item.ingredient_id);
              return <Chip key={item.ingredient_id} selected={!missing} onPress={() => toggleStaple(item.ingredient_id)} accessibilityLabel={`${item.names['zh-CN']}，${missing ? '缺少，点按设为有' : '有，点按设为缺少'}`}>{item.names['zh-CN']}{missing ? ' · 缺少' : ''}</Chip>;
            })}</View>
          </Card.Content>
        </Card>
      </ScrollView>
      <IngredientPicker visible={pickerVisible} title="添加常备食材" location="pantry" ingredients={catalog.ingredients} selectedIds={state.pantryConfigured ? state.pantryIds : draftIds} otherSelectedIds={state.currentIds} onToggle={state.pantryConfigured ? togglePantry : toggleDraft} onDismiss={() => setPickerVisible(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, paddingBottom: 36, gap: 24 },
  heading: { paddingTop: 12 },
  title: { fontWeight: '700', letterSpacing: -0.6 },
  bold: { fontWeight: '700' },
  cardContent: { gap: 16, paddingVertical: 20 },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  equipment: { gap: 12, marginTop: 4 },
  primaryButton: { minHeight: 48 },
  staplesCard: { borderRadius: 20 },
});
