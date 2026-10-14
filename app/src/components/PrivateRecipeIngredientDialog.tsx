import { useI18n } from '../i18n/useI18n';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Button, Dialog, Portal, Switch, Text, TextInput, useTheme } from 'react-native-paper';
import type { Importance, Quantity, Requirement } from '../../../packages/engine/src/types';
import { importanceLabels, nameOf } from '../model/presentation';
import type { PrivateRecipe, PrivateRecipeIngredient, PrivateRecipeStep, PrivateRecipeStepChange } from '../model/private-recipes';
import type { AppCatalog } from '../model/types';
import { PrivateRecipeChoices } from './PrivateRecipeChoices';

type Props = Readonly<{
  catalog: AppCatalog;
  recipe: PrivateRecipe;
  ingredient: PrivateRecipeIngredient;
  onDismiss: () => void;
  onSave: (ingredient: PrivateRecipeIngredient) => void;
}>;

const unitLabels = { to_taste: '适量', g: '克', ml: '毫升', piece: '个', tbsp: '大匙', tsp: '小匙' } as const;
type Unit = keyof typeof unitLabels;
const roleLabels: Readonly<Record<Requirement['role'], string>> = { main: '主料', secondary: '辅料', seasoning: '调料', garnish: '点缀' };

function QuantityFields({ unit, value, minimum, maximum, range, onUnit, onValue, onMinimum, onMaximum, onRange }: Readonly<{
  unit: Unit; value: string; minimum: string; maximum: string; range: boolean;
  onUnit: (value: Unit) => void; onValue: (value: string) => void; onMinimum: (value: string) => void;
  onMaximum: (value: string) => void; onRange: (value: boolean) => void;
}>) {
  const { t } = useI18n();
  return <View style={styles.section}>
    <PrivateRecipeChoices label={t('用量')} values={unitLabels} selected={[unit]} onSelect={onUnit} />
    {unit !== 'to_taste' && <>
      <View style={styles.row}>
        {range ? <>
          <TextInput mode="outlined" label={t('最少')} value={minimum} onChangeText={onMinimum} keyboardType="decimal-pad" maxLength={12} style={styles.grow} />
          <TextInput mode="outlined" label={t('最多')} value={maximum} onChangeText={onMaximum} keyboardType="decimal-pad" maxLength={12} style={styles.grow} />
        </> : <TextInput mode="outlined" label={t('数量')} value={value} onChangeText={onValue} keyboardType="decimal-pad" maxLength={12} style={styles.grow} />}
      </View>
      <View style={styles.row}><Text style={styles.grow}>{t('数量区间')}</Text><Switch value={range} onValueChange={onRange} accessibilityLabel={t('数量区间')} /></View>
    </>}
    {(unit === 'tbsp' || unit === 'tsp') && <Text variant="bodySmall">{t(unit === 'tbsp' ? '每大匙 15 毫升' : '每小匙 5 毫升')}</Text>}
  </View>;
}

function OmissionStep({ catalog, ingredients, step, index, change, onChange }: Readonly<{
  catalog: AppCatalog; ingredients: readonly PrivateRecipeIngredient[]; step: PrivateRecipeStep;
  index: number; change: PrivateRecipeStepChange | undefined; onChange: (change: PrivateRecipeStepChange) => void;
}>) {
  const { t } = useI18n();
  const chooseAction = (action: 'skip' | 'replace') => {
    if (change?.action === action) return;
    onChange(action === 'skip' ? { stepId: step.id, action }
      : { stepId: step.id, action, text: '', ingredientIds: step.ingredientIds.filter(id => ingredients.some(item => item.ingredientId === id)) });
  };
  const replacement = change?.action === 'replace' ? change : null;
  const names = Object.fromEntries(ingredients.map(item => [item.ingredientId, nameOf(catalog, item.ingredientId)]));
  const toggle = (id: string) => {
    if (!replacement) return;
    onChange({ ...replacement, ingredientIds: replacement.ingredientIds.includes(id)
      ? replacement.ingredientIds.filter(value => value !== id) : [...replacement.ingredientIds, id] });
  };
  return <View style={styles.omissionStep}>
    <Text variant="titleSmall">{t('步骤 {number}', { number: index + 1 })}</Text><Text numberOfLines={2}>{step.text || t('未填写步骤')}</Text>
    <PrivateRecipeChoices values={{ skip: '跳过这步', replace: '改写这步' }} selected={change ? [change.action] : []} onSelect={chooseAction} />
    {replacement && <>
      <TextInput mode="outlined" label={t('省略后的做法')} multiline value={replacement.text}
        onChangeText={text => onChange({ ...replacement, text })} maxLength={1000} style={styles.stepInput} />
      {ingredients.length > 0 && <PrivateRecipeChoices label={t('使用食材')} values={names} selected={replacement.ingredientIds} onSelect={toggle} />}
    </>}
  </View>;
}

function quantityError(quantity: Quantity): string | null {
  if (quantity.unit === 'to_taste') return null;
  const values = quantity.value === undefined ? [quantity.min, quantity.max] : [quantity.value];
  if (values.some(value => value === undefined || !Number.isFinite(value) || value <= 0 || value > 100000)) return '用量需大于 0，且不超过 100000。';
  if (quantity.min !== undefined && quantity.max !== undefined && quantity.min > quantity.max) return '最多用量不能小于最少用量。';
  return null;
}

export function PrivateRecipeIngredientDialog({ catalog, recipe, ingredient, onDismiss, onSave }: Props) {
  const { t } = useI18n();
  const theme = useTheme();
  const { height } = useWindowDimensions();
  const [unit, setUnit] = useState<Unit>(ingredient.quantity.unit as Unit);
  const [value, setValue] = useState(String(ingredient.quantity.value ?? ''));
  const [minimum, setMinimum] = useState(String(ingredient.quantity.min ?? ''));
  const [maximum, setMaximum] = useState(String(ingredient.quantity.max ?? ''));
  const [range, setRange] = useState(ingredient.quantity.min !== undefined);
  const [importance, setImportance] = useState<Importance>(ingredient.importance);
  const [role, setRole] = useState(ingredient.role);
  const [consumes, setConsumes] = useState(ingredient.consumes);
  const [note, setNote] = useState(ingredient.omission?.note ?? '');
  const [changes, setChanges] = useState<readonly PrivateRecipeStepChange[]>(ingredient.omission?.stepChanges ?? []);
  const [error, setError] = useState<string | null>(null);
  const relatedSteps = recipe.steps.filter(step => step.ingredientIds.includes(ingredient.ingredientId));
  const remainingIngredients = recipe.ingredients.filter(item => item.ingredientId !== ingredient.ingredientId);
  const setChange = (change: PrivateRecipeStepChange) => setChanges(previous => [...previous.filter(item => item.stepId !== change.stepId), change]);
  const save = () => {
    const quantity: Quantity = unit === 'to_taste' ? { unit } : {
      unit, ...(range ? { min: Number(minimum), max: Number(maximum) } : { value: Number(value) }),
      ...((unit === 'tbsp' || unit === 'tsp') ? { spoon_standard: 'metric_15ml_5ml' } : {}),
    };
    const invalidQuantity = quantityError(quantity);
    if (invalidQuantity) { setError(invalidQuantity); return; }
    if (importance !== 'required' && !note.trim()) { setError('请填写省略这项食材后的影响。'); return; }
    const stepChanges = changes.filter(change => relatedSteps.some(step => step.id === change.stepId));
    if (importance !== 'required' && relatedSteps.some(step => !stepChanges.some(change => change.stepId === step.id))) {
      setError('请选择省略食材后各步骤的处理方式。'); return;
    }
    if (importance !== 'required' && stepChanges.some(change => change.action === 'replace' && !change.text.trim())) {
      setError('请填写省略食材后的做法。'); return;
    }
    const { omission: previousOmission, ...base } = ingredient;
    onSave({ ...base, quantity, importance, role, consumes,
      ...(importance === 'required' ? {} : { omission: { note: note.trim(), stepChanges } }) });
  };
  return <Portal><Dialog visible onDismiss={onDismiss} style={[styles.dialog, { maxHeight: height * 0.92 }]}>
    <Dialog.Title>{nameOf(catalog, ingredient.ingredientId)}</Dialog.Title>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.shrink}>
      <Dialog.ScrollArea style={styles.shrink}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <QuantityFields unit={unit} value={value} minimum={minimum} maximum={maximum} range={range}
          onUnit={setUnit} onValue={setValue} onMinimum={setMinimum} onMaximum={setMaximum} onRange={setRange} />
        <PrivateRecipeChoices label={t('必要性')} values={importanceLabels} selected={[importance]} onSelect={setImportance} />
        <PrivateRecipeChoices label={t('用途')} values={roleLabels} selected={[role]} onSelect={setRole} />
        <View style={styles.row}><Text style={styles.grow}>{t('配餐时单独分配')}</Text><Switch value={consumes} onValueChange={setConsumes} accessibilityLabel={t('配餐时单独分配')} /></View>
        {importance !== 'required' && <View style={styles.section}>
          <TextInput mode="outlined" label={t('省略后的影响')} value={note} onChangeText={setNote} multiline maxLength={500} />
          {relatedSteps.map(step => <OmissionStep key={step.id} catalog={catalog} ingredients={remainingIngredients} step={step}
            index={recipe.steps.indexOf(step)} change={changes.find(change => change.stepId === step.id)} onChange={setChange} />)}
        </View>}
        {error && <Text accessibilityRole="alert" style={{ color: theme.colors.error }}>{t(error)}</Text>}
      </ScrollView></Dialog.ScrollArea>
    </KeyboardAvoidingView>
    <Dialog.Actions><Button onPress={onDismiss}>{t('取消')}</Button><Button onPress={save}>{t('保存')}</Button></Dialog.Actions>
  </Dialog></Portal>;
}

const styles = StyleSheet.create({
  dialog: { alignSelf: 'center', width: '92%', maxWidth: 600, marginHorizontal: 0 },
  content: { paddingVertical: 16, gap: 20 }, section: { gap: 12 }, shrink: { flexShrink: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 }, grow: { flex: 1 },
  omissionStep: { gap: 10, paddingVertical: 8 }, stepInput: { minHeight: 92 },
});
