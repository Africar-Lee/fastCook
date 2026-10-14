import { formatList, t } from '../i18n/core';
import { useI18n } from '../i18n/useI18n';
import { useMemo, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Button, Chip, Dialog, Icon, Portal, Searchbar, Text, TouchableRipple, useTheme } from 'react-native-paper';
import { getCommonIngredients } from '../model/common-ingredients';
import { createIngredientSearchIndex, ingredientCategoryLabels, searchIngredients } from '../model/ingredient-search';
import { ingredientName } from '../model/presentation';
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
  const { locale } = useI18n();
  const theme = useTheme();
  const name = ingredientName(ingredient);
  const aliases = formatList(ingredient.aliases[locale]?.map(alias => alias.text).slice(0, 2) ?? []);
  return <TouchableRipple
    onPress={() => onToggle(ingredient.ingredient_id)}
    accessibilityRole="checkbox"
    accessibilityState={{ checked: active }}
    accessibilityLabel={name}
    accessibilityHint={moveLabel ?? t(active ? '点按取消选择' : '点按加入食材')}
    style={[styles.choice, grid && styles.gridChoice, { backgroundColor: active ? theme.colors.secondaryContainer : theme.colors.surface }]}
  >
    <View style={grid ? styles.gridContent : styles.rowContent}>
      <View style={grid ? styles.gridText : styles.rowText}>
        <Text variant={grid ? 'bodyMedium' : 'titleMedium'} style={grid && styles.centered}>{name}</Text>
        {!grid && <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{t(ingredientCategoryLabels[ingredient.category] ?? ingredient.category)}{aliases ? ` · ${aliases}` : ''}</Text>}
        {moveLabel && <Text variant="bodySmall" style={{ color: theme.colors.primary }}>{moveLabel}</Text>}
      </View>
      {grid && active && <View style={styles.gridSelected}><Icon source="check" size={16} color={theme.colors.onSecondaryContainer} /></View>}
      {!grid && <Icon source={active ? 'check-circle' : 'plus-circle-outline'} size={24} color={active ? theme.colors.onSecondaryContainer : theme.colors.onSurfaceVariant} />}
    </View>
  </TouchableRipple>;
}

export function IngredientPicker({ visible, title, location, ingredients, selectedIds, otherSelectedIds, onToggle, onDismiss }: Props) {
  useI18n();
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
  const moveLabel = t(location === 'current' ? '移到当次食材' : '移到调料柜');
  const dismiss = () => { onDismiss(); setQuery(''); setCategory('common'); };
  const changeQuery = (value: string) => {
    setQuery(value);
    if (category === 'common' && value.trim().length > 0) setCategory(null);
  };

  return <Portal>
    <Dialog visible={visible} onDismiss={dismiss} style={[styles.dialog, { maxHeight: height * 0.88 }]}>
      <Dialog.Title>{t(title)}</Dialog.Title>
      <View style={styles.searchArea}>
        <Searchbar placeholder={t('搜索食材 / 拼音')} accessibilityLabel={t('搜索食材')} searchAccessibilityLabel={t('搜索食材')}
          clearAccessibilityLabel={t('清空搜索')} value={query} onChangeText={changeQuery} maxLength={64}
          autoCorrect={false} autoCapitalize="none" style={styles.search} inputStyle={styles.searchInput} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categories}>
          <Chip selected={grid} style={categoryStyle(grid)} showSelectedCheck={false} onPress={() => { setCategory('common'); setQuery(''); }}>{t('常用')}</Chip>
          <Chip selected={category === null} style={categoryStyle(category === null)} showSelectedCheck={false} onPress={() => setCategory(null)}>{t('全部')}</Chip>
          {categories.map(value => <Chip key={value} selected={category === value} style={categoryStyle(category === value)} showSelectedCheck={false} onPress={() => setCategory(value)}>{t(ingredientCategoryLabels[value] ?? value)}</Chip>)}
        </ScrollView>
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
          <Text style={styles.centered}>{t(grid ? '暂无常用食材' : '未找到食材')}</Text>
          {category !== null && <Button onPress={() => setCategory(null)}>{t(grid ? '查看全部食材' : '搜索全部分类')}</Button>}
        </View>}
        renderItem={({ item }) => <IngredientChoice ingredient={item} active={selected.has(item.ingredient_id)} grid={grid}
          moveLabel={otherSelected.has(item.ingredient_id) ? moveLabel : null} onToggle={onToggle} />}
      />
      <Dialog.Actions>
        <Button mode="contained" buttonColor={theme.colors.primaryContainer} textColor={theme.colors.onPrimaryContainer} onPress={dismiss}>{t('完成 · 已选 {count} 种', { count: selectedIds.length })}</Button>
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
  gridContent: { minHeight: 64, padding: 8, justifyContent: 'center' },
  gridText: { alignItems: 'center', gap: 6 },
  gridSelected: { position: 'absolute', top: 4, right: 4 },
  centered: { textAlign: 'center' },
  empty: { paddingVertical: 24, gap: 8 },
});
