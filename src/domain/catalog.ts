import type { FractalDefinition, FractalId, ParameterDefinition, Parameters, SceneState } from './types';

const juliaRe: ParameterDefinition = { key: 'juliaRe', type: 'real', label: 'Действительная часть Julia', min: -2, max: 2, step: .001, default: -.74543 };
const juliaIm: ParameterDefinition = { key: 'juliaIm', type: 'real', label: 'Мнимая часть Julia', min: -2, max: 2, step: .001, default: .11301 };
const power: ParameterDefinition = { key: 'power', type: 'integer', label: 'Степень Multibrot', min: 2, max: 8, step: 1, default: 3 };

export const fractals: FractalDefinition[] = [
  { id: 'mandelbrot', version: 1, resultKind: 'escape', shaderKind: 0, name: 'Мандельброт', subtitle: 'Начало бесконечности', category: 'Классика', formula: 'zₙ₊₁ = zₙ² + c', description: 'Самое известное множество. Каждый пиксель — своя константа c, а граница скрывает бесконечное разнообразие форм.', parameters: [], presets: [
    { name: 'Первое знакомство', camera: { x: -0.65, y: 0, height: 3.8 } },
    { name: 'Долина морских коньков', camera: { x: -0.745, y: 0.186, height: 0.045 } },
    { name: 'Спутник', camera: { x: -1.25, y: 0, height: 0.58 } },
  ] },
  { id: 'julia', version: 1, resultKind: 'escape', shaderKind: 1, name: 'Жюлиа', subtitle: 'Мир одной константы', category: 'Классика', formula: 'zₙ₊₁ = zₙ² + c, c = const', description: 'Одна константа определяет целый мир. Изменяйте её действительную и мнимую части, чтобы находить новые острова и спирали.', parameters: [juliaRe, juliaIm], presets: [
    { name: 'Дендрит', camera: { x: 0, y: 0, height: 3.8 }, parameters: { juliaRe: -0.74543, juliaIm: 0.11301 } },
    { name: 'Спиральная галактика', camera: { x: 0, y: 0, height: 3.5 }, parameters: { juliaRe: -0.8, juliaIm: 0.156 } },
  ] },
  { id: 'burning-ship', version: 1, resultKind: 'escape', shaderKind: 2, name: 'Горящий корабль', subtitle: 'Огонь в деталях', category: 'Классика', formula: 'zₙ₊₁ = (|Re zₙ| + i|Im zₙ|)² + c', description: 'Модули координат превращают округлые формы в корабли, башни и языки пламени. Ищите детали в нижней части множества.', parameters: [], presets: [
    { name: 'Корабль целиком', camera: { x: -0.45, y: -0.45, height: 3.8 } },
    { name: 'Пылающие мачты', camera: { x: -1.755, y: -0.035, height: 0.12 } },
  ] },
  { id: 'tricorn', version: 1, resultKind: 'escape', shaderKind: 3, name: 'Трикорн', subtitle: 'Тройная симметрия', category: 'Классика', formula: 'zₙ₊₁ = conjugate(zₙ)² + c', description: 'Комплексное сопряжение меняет направление вращения. Получается характерная трёхлучевая фигура с тонкими связями между островами.', parameters: [], presets: [
    { name: 'Три луча', camera: { x: -0.2, y: 0, height: 4.5 } },
    { name: 'Западный луч', camera: { x: -1.6, y: 0, height: 0.65 } },
  ] },
  { id: 'multibrot', version: 1, resultKind: 'escape', shaderKind: 4, name: 'Мультиброт', subtitle: 'Симметрия в степени', category: 'Вариации', formula: 'zₙ₊₁ = zₙᵖ + c', description: 'Обобщение множества Мандельброта. Целая степень от 2 до 8 управляет количеством лепестков и симметрией.', parameters: [power], presets: [
    { name: 'Третий порядок', camera: { x: 0, y: 0, height: 3.8 }, parameters: { power: 3 } },
    { name: 'Семь лепестков', camera: { x: 0, y: 0, height: 3.5 }, parameters: { power: 8 } },
  ] },
  { id: 'celtic', version: 1, resultKind: 'escape', shaderKind: 5, name: 'Кельтский', subtitle: 'Переплетение узоров', category: 'Вариации', formula: 'zₙ₊₁ = |Re(zₙ²)| + i Im(zₙ²) + c', description: 'Модуль действительной части квадрата создаёт переплетения и резкие складки. Здесь используется модуль до прибавления c.', parameters: [], presets: [
    { name: 'Кельтский узел', camera: { x: -0.5, y: 0, height: 3.8 } },
    { name: 'Переплетение', camera: { x: -1.35, y: 0.12, height: 0.5 } },
  ] },
  { id: 'buffalo', version: 1, resultKind: 'escape', shaderKind: 6, name: 'Буффало', subtitle: 'Другая геометрия', category: 'Вариации', formula: 'zₙ₊₁ = |Re(zₙ²)| + i|Im(zₙ²)| + c', description: 'Обе части квадрата отражаются в положительную область перед прибавлением c. Складки рождают строгие, почти архитектурные формы.', parameters: [], presets: [
    { name: 'Силуэт', camera: { x: -0.5, y: -0.4, height: 3.8 } },
    { name: 'Складки', camera: { x: -1.6, y: -0.1, height: 0.5 } },
  ] },
  { id: 'perpendicular', version: 1, resultKind: 'escape', shaderKind: 7, name: 'Перпендикуляр', subtitle: 'Отражённая реальность', category: 'Вариации', formula: '(x, y) → (x² − y², −2|x|y) + c', description: 'Асимметричное отражение мнимой части превращает знакомое множество в новую систему тонких складок.', parameters: [], presets: [
    { name: 'Отражение', camera: { x: -0.4, y: 0, height: 3.8 } },
    { name: 'Граница', camera: { x: -1.65, y: 0, height: 0.55 } },
  ] },
  { id: 'legacy-ship', version: 1, resultKind: 'legacy-escape', shaderKind: 8, name: 'Корабль · 2019', subtitle: 'Из оригинального Fractol', category: 'Наследие', formula: '(x, y) → (|x² − y² + cₓ|, 2|xy| + cᵧ)', description: 'Авторский вариант из C-проекта: начало z = c, а модуль действительной части применяется после прибавления c. Порядок сохранён.', parameters: [], presets: [
    { name: 'Оригинал', camera: { x: -0.5, y: -0.4, height: 3.8 } },
    { name: 'По следам прошлого', camera: { x: -1.7, y: -0.05, height: 0.35 } },
  ] },
  { id: 'legacy-something', version: 1, resultKind: 'legacy-escape', shaderKind: 9, name: 'Something', subtitle: 'С чего всё началось', category: 'Наследие', formula: 'x′ = x² − y² + a; y′ = 2x′y + b; c′ = c/2 + z′', description: 'Экспериментальная формула оригинального Fractol. Мнимая часть использует уже обновлённую действительную; затем изменяется сама константа.', parameters: [], presets: [
    { name: 'Эксперимент', camera: { x: 0, y: 0, height: 3.8 } },
    { name: 'Внутренняя структура', camera: { x: -0.35, y: 0, height: 1 } },
  ] },
  { id: 'newton', version: 1, resultKind: 'basins', shaderKind: 10, name: 'Ньютон', subtitle: 'Цвета притяжения', category: 'Классика', formula: 'z′ = z − (zᵖ − 1) / (p·zᵖ⁻¹)', description: 'Метод Ньютона ищет корни единицы. Цвет показывает ближайший корень, а яркость — скорость сходимости. Границы областей притяжения образуют тонкую фрактальную сеть.', parameters: [{ ...power, label: 'Степень Ньютона', min: 3 }], presets: [
    { name: 'Три области притяжения', camera: { x: 0, y: 0, height: 3.8 }, parameters: { power: 3 } },
    { name: 'Пять направлений', camera: { x: 0, y: 0, height: 3.2 }, parameters: { power: 5 } },
    { name: 'Восемь корней', camera: { x: 0, y: 0, height: 3.2 }, parameters: { power: 8 } },
  ] },
  { id: 'nova', version: 1, resultKind: 'convergence', shaderKind: 11, name: 'Нова', subtitle: 'Возмущённое равновесие', category: 'Вариации', formula: 'z′ = z − a·(z³ − 1)/(3z²) + c; z₀ = 1', description: 'К шагу Ньютона прибавляется координата пикселя. Палитра показывает скорость установления орбиты; несошедшиеся и особые точки используют цвет остальных областей. Релаксация меняет силу шага.', parameters: [{ key: 'novaRelaxation', type: 'real', label: 'Релаксация', min: .1, max: 2, step: .01, default: 1 }], presets: [
    { name: 'Рождение Новы', camera: { x: -.5, y: 0, height: 3 } },
    { name: 'Медленное притяжение', camera: { x: -.3, y: 0, height: 1.8 }, parameters: { novaRelaxation: .5 } },
    { name: 'Возмущённые берега', camera: { x: -.35, y: .12, height: .65 }, parameters: { novaRelaxation: 1.5 } },
  ] },
  { id: 'phoenix', version: 1, resultKind: 'escape', shaderKind: 12, name: 'Феникс', subtitle: 'Память предыдущего шага', category: 'Вариации', formula: 'zₙ₊₁ = zₙ² + c + p·zₙ₋₁; z₋₁ = 0', description: 'Вариант Julia с памятью: следующий шаг зависит от двух предыдущих состояний. Константа задаёт геометрию, а коэффициент памяти создаёт острова и повторяющиеся узоры.', parameters: [
    { key: 'phoenixRe', type: 'real', label: 'Действительная часть Феникса', min: -2, max: 2, step: .001, default: .56667 },
    { key: 'phoenixIm', type: 'real', label: 'Мнимая часть Феникса', min: -2, max: 2, step: .001, default: 0 },
    { key: 'phoenixMemory', type: 'real', label: 'Память', min: -1, max: 1, step: .01, default: -.5 },
  ], presets: [
    { name: 'Крылья Феникса', camera: { x: 0, y: 0, height: 3.4 } },
    { name: 'Острова памяти', camera: { x: 0, y: 0, height: 2.8 }, parameters: { phoenixRe: .5, phoenixMemory: -.6 } },
    { name: 'Julia без памяти', camera: { x: 0, y: 0, height: 3.5 }, parameters: { phoenixRe: -.8, phoenixIm: .156, phoenixMemory: 0 } },
  ] },
  { id: 'magnet-1', version: 1, resultKind: 'hybrid', shaderKind: 13, name: 'Магнит 1', subtitle: 'Между притяжением и побегом', category: 'Вариации', formula: 'z′ = ((z² + c − 1)/(2z + c − 2))²; z₀ = 0', description: 'Рациональная формула с двумя исходами: притяжение к единице и уход на бесконечность. Эти орбиты окрашиваются разными половинами палитры; особенности знаменателя выделяются цветом остальных областей.', parameters: [], presets: [
    { name: 'Магнитное поле', camera: { x: 1, y: 0, height: 4 } },
    { name: 'Полюс и острова', camera: { x: 2, y: 0, height: 1.4 } },
    { name: 'Северная граница', camera: { x: 1.5, y: .65, height: .8 } },
  ] },
];

export const getFractal = (id: FractalId): FractalDefinition => fractals.find(f => f.id === id)!;
export const defaultParameters = { juliaRe: -0.74543, juliaIm: 0.11301, power: 3 };
export function parametersFor(id: FractalId): Parameters {
  const parameters: Parameters = { ...defaultParameters };
  for (const field of getFractal(id).parameters) parameters[field.key] = field.default;
  return parameters;
}
export function createScene(id: FractalId = 'mandelbrot', presetIndex = 0): SceneState {
  const preset = getFractal(id).presets[presetIndex] ?? getFractal(id).presets[0];
  return {
    schemaVersion: 1, fractalId: id, formulaVersion: 1,
    camera: { ...preset.camera }, parameters: { ...parametersFor(id), ...preset.parameters }, iterations: 512,
    coloring: { palette: 'aurora', phase: 0, density: 1, interior: '#071014' },
  };
}
