import { useEffect, useRef, useState } from 'react';
import { BackHandler, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Appbar, Button, Card, Dialog, IconButton, Portal, Surface, Text, TextInput, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { CookingMethod, Equipment } from '../../../packages/engine/src/types';
import { IngredientPicker } from '../components/IngredientPicker';
import { PrivateRecipeChoices } from '../components/PrivateRecipeChoices';
import { PrivateRecipeIngredientDialog } from '../components/PrivateRecipeIngredientDialog';
import { RecipeImageEditor } from '../components/RecipeImageEditor';
import { courseLabels, equipmentLabels, formatQuantity, importanceLabels, nameOf } from '../model/presentation';
import { createPrivateRecipeId, createPrivateRecipeStepId, validatePrivateRecipe } from '../model/private-recipes';
import type { PrivateRecipe, PrivateRecipeIngredient, PrivateRecipeStep } from '../model/private-recipes';
import { EMPTY_RECIPE_MEDIA, MAX_IMAGES_PER_RECIPE, type RecipeImage, type RecipeMedia } from '../model/recipe-media';
import type { AppCatalog } from '../model/types';
import type { StorageResult } from '../storage/types';
import { useI18n } from '../i18n/useI18n';

type Props = Readonly<{
  catalog: AppCatalog;
  recipe: PrivateRecipe | null;
  media?: RecipeMedia;
  defaultServings: number;
  onBack: () => void;
  onSave: (recipe: PrivateRecipe, media: RecipeMedia) => Promise<StorageResult<void>>;
}>;

const methodLabels: Readonly<Record<CookingMethod, string>> = {
  stir_fry: '炒', pan_fry: '煎', deep_fry: '炸', boil: '煮', steam: '蒸', braise: '炖焖', roast: '烤', cold_mix: '凉拌', mixed: '综合',
};
const spiceLabels = { '0': '不辣', '1': '微辣', '2': '中辣', '3': '重辣' } as const;

function newRecipe(defaultServings: number): PrivateRecipe {
  return {
    id: createPrivateRecipeId(), name: '', course: 'veg', cookingMethod: 'stir_fry', timeMinutes: 20,
    servings: defaultServings, spicyLevel: 0, equipment: ['wok'], ingredients: [],
    steps: [{ id: createPrivateRecipeStepId(), text: '', ingredientIds: [] }],
  };
}

function removeIngredient(recipe: PrivateRecipe, ingredientId: string): PrivateRecipe {
  return {
    ...recipe,
    ingredients: recipe.ingredients.filter(item => item.ingredientId !== ingredientId).map(item => !item.omission ? item : {
      ...item, omission: { ...item.omission, stepChanges: item.omission.stepChanges.map(change => change.action === 'skip' ? change : {
        ...change, ingredientIds: change.ingredientIds.filter(id => id !== ingredientId),
      }) },
    }),
    steps: recipe.steps.map(step => ({ ...step, ingredientIds: step.ingredientIds.filter(id => id !== ingredientId) })),
  };
}

function removeStep(recipe: PrivateRecipe, stepId: string): PrivateRecipe {
  return {
    ...recipe, steps: recipe.steps.filter(step => step.id !== stepId),
    ingredients: recipe.ingredients.map(item => !item.omission ? item : {
      ...item, omission: { ...item.omission, stepChanges: item.omission.stepChanges.filter(change => change.stepId !== stepId) },
    }),
  };
}

function RecipeDetails({ recipe, onChange }: Readonly<{ recipe: PrivateRecipe; onChange: (recipe: PrivateRecipe) => void }>) {
  const { t } = useI18n();
  const toggleEquipment = (equipment: Equipment) => onChange({ ...recipe, equipment: recipe.equipment.includes(equipment)
    ? recipe.equipment.filter(value => value !== equipment) : [...recipe.equipment, equipment] });
  return <View style={styles.section}>
    <PrivateRecipeChoices label={t('类别')} values={courseLabels} selected={[recipe.course]} onSelect={course => onChange({ ...recipe, course })} />
    <PrivateRecipeChoices label={t('做法')} values={methodLabels} selected={[recipe.cookingMethod]} onSelect={cookingMethod => onChange({ ...recipe, cookingMethod })} />
    <PrivateRecipeChoices label={t('辣度')} values={spiceLabels} selected={[String(recipe.spicyLevel) as keyof typeof spiceLabels]}
      onSelect={spice => onChange({ ...recipe, spicyLevel: Number(spice) })} />
    <PrivateRecipeChoices label={t('所需厨具')} values={equipmentLabels} selected={recipe.equipment} onSelect={toggleEquipment} />
  </View>;
}

function RecipeIngredients({ catalog, ingredients, onAdd, onEdit, onRemove }: Readonly<{
  catalog: AppCatalog; ingredients: readonly PrivateRecipeIngredient[]; onAdd: () => void;
  onEdit: (ingredientId: string) => void; onRemove: (ingredientId: string) => void;
}>) {
  const { t } = useI18n();
  const theme = useTheme();
  return <View style={styles.section}>
    <View style={styles.row}><Text variant="titleLarge" style={styles.grow}>{t('食材')}</Text>
      <Button icon="plus" onPress={onAdd}>{t('添加食材')}</Button></View>
    {ingredients.length === 0 && <Text style={{ color: theme.colors.onSurfaceVariant }}>{t('选择这道菜需要的食材和调料')}</Text>}
    {ingredients.map(ingredient => <Card key={ingredient.ingredientId} mode="outlined" onPress={() => onEdit(ingredient.ingredientId)}>
      <View style={styles.ingredientRow}>
        <View style={styles.grow}><Text variant="titleMedium">{nameOf(catalog, ingredient.ingredientId)}</Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{formatQuantity(ingredient.quantity)} · {importanceLabels[ingredient.importance]}</Text></View>
        <IconButton icon="pencil-outline" accessibilityLabel={t('编辑{name}', { name: nameOf(catalog, ingredient.ingredientId) })} onPress={() => onEdit(ingredient.ingredientId)} />
        <IconButton icon="close" accessibilityLabel={t('移除{name}', { name: nameOf(catalog, ingredient.ingredientId) })} onPress={() => onRemove(ingredient.ingredientId)} />
      </View>
    </Card>)}
  </View>;
}

function RecipeStepEditor({ catalog, ingredients, step, index, count, disabled, images, remaining,
  onChange, onMove, onRemove, onImagesChange, onImageBusyChange }: Readonly<{
  catalog: AppCatalog; ingredients: readonly PrivateRecipeIngredient[]; step: PrivateRecipeStep; index: number; count: number;
  disabled: boolean; images: readonly RecipeImage[]; remaining: number;
  onChange: (step: PrivateRecipeStep) => void; onMove: (direction: -1 | 1) => void; onRemove: () => void;
  onImagesChange: (images: readonly RecipeImage[]) => void; onImageBusyChange: (busy: boolean) => void;
}>) {
  const { t } = useI18n();
  const labels = Object.fromEntries(ingredients.map(item => [item.ingredientId, nameOf(catalog, item.ingredientId)]));
  const toggle = (id: string) => onChange({ ...step, ingredientIds: step.ingredientIds.includes(id)
    ? step.ingredientIds.filter(value => value !== id) : [...step.ingredientIds, id] });
  return <Card mode="outlined"><Card.Content style={styles.step}>
    <View style={styles.row}><Text variant="titleMedium" style={styles.grow}>{t('步骤 {number}', { number: index + 1 })}</Text>
      <IconButton icon="arrow-up" size={20} disabled={disabled || index === 0} accessibilityLabel={t('上移步骤 {number}', { number: index + 1 })} onPress={() => onMove(-1)} />
      <IconButton icon="arrow-down" size={20} disabled={disabled || index === count - 1} accessibilityLabel={t('下移步骤 {number}', { number: index + 1 })} onPress={() => onMove(1)} />
      <IconButton icon="close" size={20} disabled={disabled || count <= 1} accessibilityLabel={t('删除步骤 {number}', { number: index + 1 })} onPress={onRemove} />
    </View>
    <TextInput mode="outlined" label={t('步骤 {number} 做法', { number: index + 1 })} multiline value={step.text} editable={!disabled}
      onChangeText={text => onChange({ ...step, text })} maxLength={1000} style={styles.stepInput} />
    {ingredients.length > 0 && <PrivateRecipeChoices label={t('使用食材')} values={labels} selected={step.ingredientIds} onSelect={toggle} />}
    <RecipeImageEditor images={images} label={t('步骤图片')} disabled={disabled} remaining={remaining}
      onChange={onImagesChange} onBusyChange={onImageBusyChange} />
  </Card.Content></Card>;
}

export function PrivateRecipeEditorScreen({ catalog, recipe, media = EMPTY_RECIPE_MEDIA, defaultServings, onBack, onSave }: Props) {
  const { t } = useI18n();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [initial] = useState(() => recipe ?? newRecipe(defaultServings));
  const [draft, setDraftState] = useState(initial);
  const [initialMedia] = useState(media);
  const [draftMedia, setDraftMedia] = useState(media);
  const [minutes, setMinutes] = useState(String(initial.timeMinutes));
  const [servings, setServings] = useState(String(initial.servings));
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [editingIngredient, setEditingIngredient] = useState<string | null>(null);
  const [discardVisible, setDiscardVisible] = useState(false);
  const [removingStep, setRemovingStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [imageProcessing, setImageProcessing] = useState(false);
  const inFlight = useRef(false);
  const imagePending = useRef(false);
  const mounted = useRef(true);
  const busy = saving || imageProcessing;
  const remainingImages = MAX_IMAGES_PER_RECIPE - draftMedia.images.length - Object.values(draftMedia.steps).reduce((count, images) => count + images.length, 0);
  const onImageBusyChange = (processing: boolean) => {
    imagePending.current = processing;
    if (mounted.current) setImageProcessing(processing);
  };
  const setDraft = (update: PrivateRecipe | ((previous: PrivateRecipe) => PrivateRecipe)) => {
    if (!inFlight.current && !imagePending.current) setDraftState(update);
  };
  const openIngredients = () => { if (!inFlight.current && !imagePending.current) setPickerVisible(true); };
  const editIngredient = (ingredientId: string) => { if (!inFlight.current && !imagePending.current) setEditingIngredient(ingredientId); };
  const removeStepAndImages = (stepId: string) => {
    if (inFlight.current || imagePending.current) return;
    setDraft(previous => removeStep(previous, stepId));
    setDraftMedia(previous => {
      const steps = { ...previous.steps };
      delete steps[stepId];
      return { ...previous, steps };
    });
  };
  const changeStepImages = (stepId: string, images: readonly RecipeImage[]) => setDraftMedia(previous => {
    const steps = { ...previous.steps };
    if (images.length > 0) steps[stepId] = images;
    else delete steps[stepId];
    return { ...previous, steps };
  });
  const requestRemoveStep = (step: PrivateRecipeStep) => {
    if (inFlight.current || imagePending.current) return;
    if (step.text.trim() || draftMedia.steps[step.id]?.length) setRemovingStep(step.id);
    else removeStepAndImages(step.id);
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial) || JSON.stringify(draftMedia) !== JSON.stringify(initialMedia)
    || minutes !== String(initial.timeMinutes) || servings !== String(initial.servings);
  const selectedIngredient = draft.ingredients.find(item => item.ingredientId === editingIngredient);
  const requestBack = () => {
    if (inFlight.current || imagePending.current) return;
    if (dirty) setDiscardVisible(true);
    else onBack();
  };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (inFlight.current || imagePending.current) return true;
      if (pickerVisible) setPickerVisible(false);
      else if (editingIngredient) setEditingIngredient(null);
      else if (removingStep) setRemovingStep(null);
      else if (discardVisible) setDiscardVisible(false);
      else requestBack();
      return true;
    });
    return () => listener.remove();
  }, [dirty, pickerVisible, editingIngredient, removingStep, discardVisible, onBack]);
  const toggleIngredient = (ingredientId: string) => {
    if (inFlight.current || imagePending.current) return;
    const ingredient = catalog.ingredients.find(item => item.ingredient_id === ingredientId && item.selectable);
    if (!ingredient) return;
    if (draft.ingredients.some(item => item.ingredientId === ingredientId)) { setDraft(previous => removeIngredient(previous, ingredientId)); return; }
    if (draft.ingredients.length >= 30) { setError('最多添加 30 种食材。'); return; }
    const seasoning = ingredient.category === 'seasoning';
    setDraft(previous => ({ ...previous, ingredients: [...previous.ingredients, {
      ingredientId, quantity: { unit: 'to_taste' }, importance: 'required', role: seasoning ? 'seasoning' : 'main', consumes: !seasoning,
    }] }));
  };
  const changeStep = (step: PrivateRecipeStep) => setDraft(previous => ({ ...previous,
    steps: previous.steps.map(item => item.id === step.id ? step : item) }));
  const moveStep = (stepId: string, direction: -1 | 1) => setDraft(previous => {
    const index = previous.steps.findIndex(step => step.id === stepId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= previous.steps.length) return previous;
    const steps = [...previous.steps];
    [steps[index], steps[target]] = [steps[target]!, steps[index]!];
    return { ...previous, steps };
  });
  const save = async () => {
    if (inFlight.current || imagePending.current) return;
    if (!/^\d+$/.test(minutes) || !/^\d+$/.test(servings)) { setError('耗时和人数请填写整数。'); return; }
    const validation = validatePrivateRecipe({ ...draft, timeMinutes: Number(minutes), servings: Number(servings) }, catalog);
    if (validation.error !== null) { setError(validation.error); return; }
    inFlight.current = true; Keyboard.dismiss(); setSaving(true); setError(null);
    const result = await onSave(validation.data, draftMedia);
    inFlight.current = false;
    if (!mounted.current) return;
    setSaving(false); setError(result.error);
  };
  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.root, { backgroundColor: theme.colors.background }]}>
    <Appbar.Header statusBarHeight={0}><Appbar.BackAction onPress={requestBack} disabled={busy} accessibilityLabel={t('返回我的菜谱')} />
      <Appbar.Content title={t(recipe ? '编辑菜谱' : '新建菜谱')} /></Appbar.Header>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page} pointerEvents={busy ? 'none' : 'auto'}>
      <TextInput mode="outlined" label={t('菜名')} value={draft.name} editable={!busy} onChangeText={name => setDraft(previous => ({ ...previous, name }))} maxLength={80} />
      <RecipeImageEditor images={draftMedia.images} label={t('菜谱图片')} cover disabled={busy} remaining={remainingImages}
        onBusyChange={onImageBusyChange} onChange={images => setDraftMedia(previous => ({ ...previous, images }))} />
      <View style={styles.row}>
        <TextInput mode="outlined" label={t('耗时（分钟）')} value={minutes} editable={!busy}
          onChangeText={value => { if (!inFlight.current && !imagePending.current) setMinutes(value); }} keyboardType="number-pad" maxLength={4} style={styles.grow} />
        <TextInput mode="outlined" label={t('人数')} value={servings} editable={!busy}
          onChangeText={value => { if (!inFlight.current && !imagePending.current) setServings(value); }} keyboardType="number-pad" maxLength={2} style={styles.grow} />
      </View>
      <Button icon={detailsVisible ? 'chevron-up' : 'chevron-down'} disabled={busy} onPress={() => { if (!inFlight.current && !imagePending.current) setDetailsVisible(previous => !previous); }}
        accessibilityState={{ expanded: detailsVisible }}>{t('{course} · {method} · 分类与厨具', {
          course: courseLabels[draft.course], method: t(methodLabels[draft.cookingMethod]),
        })}</Button>
      {detailsVisible && <RecipeDetails recipe={draft} onChange={setDraft} />}
      <RecipeIngredients catalog={catalog} ingredients={draft.ingredients} onAdd={openIngredients} onEdit={editIngredient}
        onRemove={ingredientId => setDraft(previous => removeIngredient(previous, ingredientId))} />
      <Text variant="titleLarge">{t('做法')}</Text>
      {draft.steps.map((step, index) => <RecipeStepEditor key={step.id} catalog={catalog} ingredients={draft.ingredients}
        step={step} index={index} count={draft.steps.length} disabled={busy} onChange={changeStep} onMove={direction => moveStep(step.id, direction)}
        onRemove={() => requestRemoveStep(step)} images={draftMedia.steps[step.id] ?? []} remaining={remainingImages}
        onImagesChange={images => changeStepImages(step.id, images)} onImageBusyChange={onImageBusyChange} />)}
      <Button icon="plus" disabled={busy || draft.steps.length >= 30} onPress={() => setDraft(previous => ({ ...previous,
        steps: [...previous.steps, { id: createPrivateRecipeStepId(), text: '', ingredientIds: [] }],
      }))}>{t('添加步骤')}</Button>
    </ScrollView>
    <Surface elevation={1} style={[styles.footer, { paddingBottom: Math.max(16, insets.bottom) }]}>
      {error && <Text accessibilityRole="alert" style={{ color: theme.colors.error }}>{t(error)}</Text>}
      <Button mode="contained" loading={saving} disabled={busy} onPress={() => void save()}>{t('保存菜谱')}</Button>
    </Surface>
    {pickerVisible && <IngredientPicker visible title={t('菜谱食材')} location="current" ingredients={catalog.ingredients}
      selectedIds={draft.ingredients.map(item => item.ingredientId)} otherSelectedIds={[]} onToggle={toggleIngredient} onDismiss={() => setPickerVisible(false)} />}
    {selectedIngredient && <PrivateRecipeIngredientDialog catalog={catalog} recipe={draft} ingredient={selectedIngredient}
      onDismiss={() => setEditingIngredient(null)} onSave={ingredient => {
        setDraft(previous => ({ ...previous, ingredients: previous.ingredients.map(item => item.ingredientId === ingredient.ingredientId ? ingredient : item) }));
        setEditingIngredient(null);
      }} />}
    <Portal>
      <Dialog visible={discardVisible} dismissable={!busy} dismissableBackButton={!busy} onDismiss={() => { if (!busy) setDiscardVisible(false); }} style={styles.dialog}>
        <Dialog.Title>{t('放弃修改？')}</Dialog.Title><Dialog.Content><Text>{t('未保存的内容将丢失。')}</Text></Dialog.Content>
        <Dialog.Actions><Button disabled={busy} onPress={() => setDiscardVisible(false)}>{t('继续编辑')}</Button>
          <Button disabled={busy} onPress={() => { if (!inFlight.current && !imagePending.current) onBack(); }}>{t('放弃修改')}</Button></Dialog.Actions>
      </Dialog>
      <Dialog visible={removingStep !== null} dismissable={!busy} dismissableBackButton={!busy} onDismiss={() => { if (!busy) setRemovingStep(null); }} style={styles.dialog}>
        <Dialog.Title>{t('删除这一步？')}</Dialog.Title>
        <Dialog.Actions><Button disabled={busy} onPress={() => setRemovingStep(null)}>{t('取消')}</Button><Button disabled={busy} onPress={() => {
          if (inFlight.current || imagePending.current) return;
          if (removingStep) removeStepAndImages(removingStep);
          setRemovingStep(null);
        }}>{t('删除')}</Button></Dialog.Actions>
      </Dialog>
    </Portal>
  </KeyboardAvoidingView>;
}

const styles = StyleSheet.create({
  root: { flex: 1 }, page: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: 20, gap: 20, paddingBottom: 36 },
  section: { gap: 12 }, row: { flexDirection: 'row', alignItems: 'center', gap: 8 }, grow: { flex: 1 },
  ingredientRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 16, paddingVertical: 6 },
  step: { gap: 12 }, stepInput: { minHeight: 110 }, footer: { paddingHorizontal: 20, paddingTop: 12, gap: 8 },
  dialog: { width: '90%', maxWidth: 520, alignSelf: 'center', marginHorizontal: 0 },
});
