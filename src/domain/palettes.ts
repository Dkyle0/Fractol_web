export interface Palette { id: string; name: string; colors: string[] }
export const palettes: Palette[] = [
  { id: 'aurora', name: 'Аврора', colors: ['#091b2c', '#214659', '#438d91', '#9bdbc1', '#ecedc7', '#638d94'] },
  { id: 'nebula', name: 'Туманность', colors: ['#15132d', '#403877', '#8972ba', '#dcb3e2', '#f2d9f2', '#7b74c6'] },
  { id: 'ember', name: 'Тлеющий огонь', colors: ['#220e1a', '#652842', '#b55742', '#efa75c', '#f9e1a1', '#9c4233'] },
  { id: 'ocean', name: 'Глубина', colors: ['#06142c', '#123a68', '#247ca4', '#64c6d0', '#d1eff3', '#3c91b5'] },
  { id: 'rose', name: 'Розовый кварц', colors: ['#24142d', '#643b62', '#af7490', '#e8b8b8', '#f8e8d7', '#a77793'] },
  { id: 'mono', name: 'Серебро', colors: ['#0c1420', '#344151', '#788696', '#c2cbd2', '#f4f3eb', '#7e8b98'] },
  { id: 'spectrum', name: 'Спектр', colors: ['#ff536e', '#ffc857', '#70e69c', '#50d8ef', '#6789ff', '#d779ee'] },
];
export function hexRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
}
export const paletteGradient = (p: Palette) => `linear-gradient(110deg, ${p.colors.join(',')})`;
