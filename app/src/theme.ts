import { MD3DarkTheme, MD3LightTheme } from 'react-native-paper';

export const lightTheme = {
  ...MD3LightTheme,
  roundness: 5,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#745B00', onPrimary: '#FFFFFF',
    primaryContainer: '#FFD54F', onPrimaryContainer: '#3A2E00',
    secondary: '#655D43', secondaryContainer: '#FFF2C2', onSecondaryContainer: '#3A2E00',
    background: '#FAF9F6', surface: '#FFFFFF', onSurface: '#1C1B18',
    surfaceVariant: '#F0EEE6', onSurfaceVariant: '#625E52',
    outline: '#8C887C', outlineVariant: '#DFDCD3',
    elevation: { level0: 'transparent', level1: '#FAF9F6', level2: '#F6F5F0', level3: '#F3F1EA', level4: '#F0EEE6', level5: '#EDEAE0' },
  },
};

export const darkTheme = {
  ...MD3DarkTheme,
  roundness: 5,
  colors: {
    ...MD3DarkTheme.colors,
    primary: '#E8C65C', onPrimary: '#3A2E00',
    primaryContainer: '#D4B04A', onPrimaryContainer: '#2A2100',
    secondary: '#D0C7AA', secondaryContainer: '#3A3218', onSecondaryContainer: '#FFF0C2',
    background: '#141412', surface: '#1C1C19', onSurface: '#E7E4DC',
    surfaceVariant: '#302F29', onSurfaceVariant: '#C9C5BA',
    outline: '#918D80', outlineVariant: '#4A4840',
    elevation: { level0: 'transparent', level1: '#1E1D1A', level2: '#24231E', level3: '#29281F', level4: '#2D2B21', level5: '#302E22' },
  },
};
