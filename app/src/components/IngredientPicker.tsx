import { useMemo, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Button, Chip, Dialog, Icon, Portal, Searchbar, Text, TouchableRipple, useTheme } from 'react-native-paper';
import { getCommonIngredients } from '../model/common-ingredients';
import { createIngredientSearchIndex, ingredientCategoryLabels, searchIngredients } from '../model/ingredient-search';
import type { AppIngredient } from '../model/types';

type Props = Readonly<{
  visible: boolean;
  title: string;
  location: 'current' | 'pantry';
  ingredients: readonly AppIngredient[];
  selectedIds: readonly string[];
  otherSelectedIds: readonly string[];
  onToggle: (id: string) => void;
  onDismiss: () => void;
}>;

type ChoiceProps = Readonly<{
  ingredient: AppIngredient;
  active: boolean;
  grid: boolean;
  moveLabel: string | null;
  onToggle: Props['onToggle'];
}>;

function IngredientChoice({ ingredient, active, grid, moveLabel, onToggle }: ChoiceProps) {
  const theme = useTheme();
  const name = ingredient.names['zh-CN'] ?? ingredient.ingredient_id;
  const aliases = ingredient.aliases['zh-CN']?.map(alias => alias.text).slice(0, 2).join('、');
  return <TouchableRipple
    onPress={() => onToggle(ingredient.ingredient_id)}
    accessibilityRole="checkbox"
    accessibilityState={{ checked: active }}
    accessibilityLabel={name}
    accessibilityHint={moveLabel ?? (active ? '点按取消选择' : '点按加入食材')}
    style={[styles.choice, grid && styles.gridChoice, { backgroundColor: active ? theme.colors.secondaryContainer : theme.colors.surface }]}
  >
    <View style={grid ? styles.gridContent : styles.rowContent}>
      <View style={grid ? styles.gridText : styles.rowText}>
        <Text variant={grid ? 'bodyMedium' : 'titleMedium'} style={grid && styles.centered}>{name}</Text>
        {grid ? <Text variant="labelSmall" style={{ color: theme.colors.onSurfaceVariant }}>{active ? '已选' : '点击添加'}</Text>
          : <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{ingredientCategoryLabels[ingredient.category] ?? ingredient.category}{aliases ? ` · ${aliases}` : ''}</Text>}
        {moveLabel && <Text variant="bodySmall" style={{ color: theme.colors.primary }}>{moveLabel}</Text>}
      </View>
      {!grid && <Icon source={active ? 'check-circle' : 'plus-circle-outline'} size={24} color={active ? theme.colors.onSecondaryContainer : theme.colors.onSurfaceVariant} />}
    </View>
  </TouchableRipple>;
}

export function IngredientPicker({ visible, title, location, ingredients, selectedIds, otherSelectedIds, onToggle, onDismiss }: Props) {
  const theme = useTheme();
  const { height } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>('common');
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const otherSelected = useMemo(() => new Set(otherSelectedIds), [otherSelectedIds]);
  const index = useMemo(() => createIngredientSearchIndex(ingredients), [ingredients]);
  const common = useMemo(() => getCommonIngredients(ingredients, location), [ingredients, location]);
  const categories = useMemo(() => [...new Set(ingredients.filter(item => item.selectable).map(item => item.category))], [ingredients]);
  const grid = category === 'common';
  const matches = grid ? common.filter(item => !otherSelected.has(item.ingredient_id)) : searchIngredients(index, query, category);
  const categoryStyle = (active: boolean) => ({ backgroundColor: active ? theme.colors.secondaryContainer : theme.colors.surfaceVariant });
  const moveLabel = location === 'current' ? '调料柜已有，点按移到当次食材' : '当次食材已有，点按移到调料柜';
  const dismiss = () => { onDismiss(); setQuery(''); setCategory('common'); };
  const changeQuery = (value: string) => {
    setQuery(value);
    if (category === 'common' && value.trim().length > 0) setCategory(null);
  };

  return <Portal>
    <Dialog visible={visible} onDismiss={dismiss} style={[styles.dialog, { maxHeight: height * 0.88 }]}>
      <Dialog.Title>{title}</Dialog.Title>
      <View style={styles.searchArea}>
        <Searchbar placeholder="搜索名称、拼音或首字母" accessibilityLabel="搜索食材" value={query} onChangeText={changeQuery} maxLength={64}
          autoCorrect={false} autoCapitalize="none" style={styles.search} inputStyle={styles.searchInput} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categories}>
          <Chip selected={grid} style={categoryStyle(grid)} showSelectedCheck={false} onPress={() => { setCategory('common'); setQuery(''); }}>常用</Chip>
          <Chip selected={category === null} style={categoryStyle(category === null)} showSelectedCheck={false} onPress={() => setCategory(null)}>全部</Chip>
          {categories.map(value => <Chip key={value} selected={category === value} style={categoryStyle(category === value)} showSelectedCheck={false} onPress={() => setCategory(value)}>{ingredientCategoryLabels[value] ?? value}</Chip>)}
        </ScrollView>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{grid ? '点选家里有的食材，再点一次取消。' : `${matches.length} 项结果 · 相近名称请选具体食材。`}</Text>
      </View>
      <FlatList
        key={grid ? 'common-grid' : 'search-list'}
        numColumns={grid ? 3 : 1}
        columnWrapperStyle={grid ? styles.gridRow : undefined}
        style={[styles.list, { maxHeight: height * 0.44 }]}
        data={matches}
        keyExtractor={item => item.ingredient_id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<View style={styles.empty}>
          <Text style={styles.centered}>{grid ? '常用项已在另一份清单中，可切换“全部”查看。' : '没有找到相关食材，试试其他名称。'}</Text>
          {category !== null && !grid && <Button onPress={() => setCategory(null)}>在全部分类中搜索</Button>}
        </View>}
        renderItem={({ item }) => <IngredientChoice ingredient={item} active={selected.has(item.ingredient_id)} grid={grid}
          moveLabel={otherSelected.has(item.ingredient_id) ? moveLabel : null} onToggle={onToggle} />}
      />
      <Dialog.Actions>
        <Button mode="contained" buttonColor={theme.colors.primaryContainer} textColor={theme.colors.onPrimaryContainer} onPress={dismiss}>完成 · 已选 {selectedIds.length} 种</Button>
      </Dialog.Actions>
    </Dialog>
  </Portal>;
}

const styles = StyleSheet.create({
  dialog: { alignSelf: 'center', width: '92%', maxWidth: 540, marginHorizontal: 0 },
  searchArea: { paddingHorizontal: 20, gap: 12 },
  search: { borderRadius: 16 },
  searchInput: { fontSize: 14 },
  categories: { gap: 8 },
  list: { flexGrow: 0, flexShrink: 1, marginTop: 12 },
  listContent: { paddingHorizontal: 20, gap: 8 },
  choice: { borderRadius: 14, overflow: 'hidden' },
  rowContent: { padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { flex: 1, gap: 4 },
  gridRow: { gap: 8 },
  gridChoice: { width: '31.5%' },
  gridContent: { minHeight: 76, padding: 8, justifyContent: 'center' },
  gridText: { alignItems: 'center', gap: 6 },
  centered: { textAlign: 'center' },
  empty: { paddingVertical: 24, gap: 8 },
});
