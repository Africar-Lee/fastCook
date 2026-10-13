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
  const [selected, setSelected] = useState(initialSelection);
  const toggle = (id: Equipment) => setSelected(previous =>
    previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id]);
  return <Portal><Dialog visible onDismiss={onDismiss} style={styles.dialog}>
    <Dialog.Title>我有的厨具</Dialog.Title>
    <Dialog.ScrollArea style={styles.scroll}><ScrollView>
      {(Object.keys(equipmentLabels) as Equipment[]).map(id => <Checkbox.Item key={id}
        label={equipmentLabels[id]} status={selected.includes(id) ? 'checked' : 'unchecked'} onPress={() => toggle(id)} />)}
    </ScrollView></Dialog.ScrollArea>
    <Dialog.Actions><Button onPress={onDismiss}>取消</Button><Button onPress={() => onSave(selected)}>保存</Button></Dialog.Actions>
  </Dialog></Portal>;
}

const styles = StyleSheet.create({
  dialog: { maxWidth: 520, alignSelf: 'center', width: '90%' },
  scroll: { maxHeight: 300 },
});
