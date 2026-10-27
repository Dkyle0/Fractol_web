import type { BenchmarkReport } from './benchmark';
import { getFractal } from './catalog';
const text = (value: unknown) => String(value ?? 'Недоступно').replace(/[&<>]/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;'})[c]!).replace(/\|/g,'\\|').replace(/[\r\n]+/g,' ');
export function precisionMarkdown(report: BenchmarkReport) {
  if (!report.arithmeticVersion) return '';
  return [
    '', '## Точность и предпросмотр', '',
    `Версия точной арифметики: ${text(report.arithmeticVersion)}. Навигационные метрики относятся к предпросмотру. На безопасном масштабе используется float32, глубже — double-single, а за его проверенным диапазоном либо при недоступности — перепроекция. Double-single не является полноценной binary64. Это отдельная фаза от точного binary64-кадра.`, '',
    'Стандартный набор сохраняет навигационную методику v1.3. Текущая сцена дополнительно ожидает точный кадр после остановки, до 120 секунд на вариант; подготовка точной программы входит в это время. GPU-время тайлов не подменяется задержкой fence.', '',
    ...report.results.flatMap((r,i) => {
      const p=r.precision;
      return [
        `### Вариант ${i+1} — ${text(getFractal(r.scene.fractalId).name)}, ${r.lightGlass?'лёгкое':'полное'} стекло`, '',
        `- Арифметика предпросмотра: ${text(r.arithmeticModes?.join(', ') || null)}.`,
        `- Исполнители: ${text(r.executors?.join(', ')||null)}.`,
        ...(r.previewGenerators?.length?[`- Генераторы double-single: ${text(r.previewGenerators.join(', '))}.`]:[]),
        ...(r.presentations?[`- Обновления: новое поле ${r.presentations.computed}, перепроекция ${r.presentations.reprojection}, повторное предъявление ${r.presentations.repeat}.`]:[]),
        ...(p ? [
          `- Точный кадр: ${p.status==='completed'?'Завершён':'Прерван'}; ${text(p.arithmetic)}. ${text(p.reason)}`,
          `- Вариант ядра: ${text(p.kernelVariant)}.${p.kernelFallback?` Резервный путь: ${text(p.kernelFallback)}.`:''}`,
          `- До точного кадра: ${(p.durationMs/1000).toFixed(2)} с; поле ${text(p.computeResolution || null)}; вывод ${text(p.displayResolution || null)}.`,
          `- Исполнитель точного поля: ${text(p.executor)}; подготовка ${text(p.preparationMs?.toFixed(2))} мс; ожидание подтверждений ${text(p.waitMs?.toFixed(2))} мс (включает ожидание GPU, не является отдельным GPU-временем); порций ${text(p.submittedSlices)}, очередь до ${text(p.maxQueuedSlices)}.`,
          ...(p.compactions?[`- GPU-уплотнений: ${p.compactions}; последняя проверенная область: ${text(p.activePixels)} активных из ${text(p.activeOriginalPixels)} пикселей.`]:[]),
          `- GPU p50 / p95 тайлов: ${p.p50GpuMs?.toFixed(2)??'Недоступно'} / ${p.p95GpuMs?.toFixed(2)??'Недоступно'} мс; образцов ${p.gpuSamples}.`, '',
          'Снимок конечной сцены точного расчёта:', '', '```json', JSON.stringify(p.scene,null,2), '```', '',
        ] : ['- Дополнительный точный этап не выполнялся.', '']),
      ];
    }), '',
  ].join('\n');
}
