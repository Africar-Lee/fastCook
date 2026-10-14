import { t } from '../i18n/core';
import { useI18n } from '../i18n/useI18n';
import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Button, Checkbox, Dialog, Portal } from 'react-native-paper';
import type { Equipment } from '../../../packages/engine/src/types';
import { equipmentLabels } from '../model/presentation';

type Props = Readonly<{
  initialSelection: readonly Equipment[];
  onDismiss: () => void;
  onSave: (equipment: readonly Equipment[]) => void;
}>;

export function EquipmentDialog({ initialSelection, onDismiss, onSave }: Props) {
  useI18n();
  const [selected, setSelected] = useState(initialSelection);
  const toggle = (id: Equipment) => setSelected(previous =>
    previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id]);
  return <Portal><Dialog visible onDismiss={onDismiss} style={styles.dialog}>
    <Dialog.Title>{t('我有的厨具')}</Dialog.Title>
    <Dialog.ScrollArea style={styles.scroll}><ScrollView>
      {(Object.keys(equipmentLabels) as Equipment[]).map(id => <Checkbox.Item key={id}
        label={equipmentLabels[id]} status={selected.includes(id) ? 'checked' : 'unchecked'} onPress={() => toggle(id)} />)}
    </ScrollView></Dialog.ScrollArea>
    <Dialog.Actions><Button onPress={onDismiss}>{t('取消')}</Button><Button onPress={() => onSave(selected)}>{t('保存')}</Button></Dialog.Actions>
  </Dialog></Portal>;
}

const styles = StyleSheet.create({
  dialog: { maxWidth: 520, alignSelf: 'center', width: '90%' },
  scroll: { maxHeight: 300 },
});
