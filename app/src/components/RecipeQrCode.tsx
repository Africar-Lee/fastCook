import { useI18n } from '../i18n/useI18n';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, useTheme } from 'react-native-paper';
import Svg, { Path, Rect } from 'react-native-svg';
import { createRecipeQrMatrix } from '../model/recipe-qr';
import type { RecipeQrMatrix } from '../model/recipe-qr';

function matrixPath(matrix: RecipeQrMatrix): string {
  return matrix.map((row, rowIndex) => {
    const segments: string[] = [];
    for (let column = 0; column < row.length; column += 1) {
      if (!row[column]) continue;
      const start = column;
      while (row[column + 1]) column += 1;
      const width = column - start + 1;
      segments.push(`M${start},${rowIndex}h${width}v1h-${width}z`);
    }
    return segments.join('');
  }).join('');
}

export function RecipeQrCode({ value }: Readonly<{ value: string }>) {
  const { t } = useI18n();
  const theme = useTheme();
  const code = useMemo(() => createRecipeQrMatrix(value), [value]);
  const path = useMemo(() => code.data ? matrixPath(code.data) : '', [code]);
  if (code.error !== null) return <Text accessibilityRole="alert" style={{ color: theme.colors.error }}>{t(code.error)}</Text>;
  const size = code.data.length;
  return <View style={styles.container} accessibilityRole="image" accessibilityLabel={t('菜谱分享二维码')}>
    <Svg width="100%" height="100%" viewBox={`0 0 ${size} ${size}`} preserveAspectRatio="xMidYMid meet">
      <Rect width={size} height={size} fill="#ffffff" />
      <Path d={path} fill="#000000" />
    </Svg>
  </View>;
}

const styles = StyleSheet.create({
  container: { width: '100%', maxWidth: 360, aspectRatio: 1, alignSelf: 'center', backgroundColor: '#ffffff' },
});
