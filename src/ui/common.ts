import { allThemes, swatchesOf, type CustomThemes } from '../themes/index.ts';
import type { PickerOption } from './theme-picker.ts';

export const MY_THEMES = 'My themes';

/** Every theme as a picker option, built-ins grouped by family, custom ones under "My themes". */
export function themeOptions(custom: CustomThemes): PickerOption[] {
  return allThemes(custom).map((theme) => ({
    value: theme.id,
    label: theme.name,
    group: custom[theme.id] ? MY_THEMES : (theme.family ?? 'Themes'),
    swatches: swatchesOf(theme),
    keywords: `${theme.mode} ${theme.id}`,
  }));
}

export const OFF_OPTION: PickerOption = { value: 'off', label: 'Off', keywords: 'none disable original' };
