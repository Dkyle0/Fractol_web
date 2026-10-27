<script setup lang="ts">
import { ref } from 'vue';
import type { BenchmarkConfig, BenchmarkReport } from '../domain/benchmark';
import { benchmarkFilename, benchmarkMarkdown } from '../domain/benchmarkMarkdown';
import { getFractal } from '../domain/catalog';
import { downloadFile } from '../infrastructure/download';
import type {ResourceMode} from '../domain/resources';
import { qualityProfiles, type QualityProfile } from '../domain/quality';
const props = defineProps<{ report: BenchmarkReport | null; available: boolean; qualityProfile: QualityProfile;resourceMode?:ResourceMode }>();
const emit = defineEmits<{ start: [BenchmarkConfig['mode']] }>();
const mode = ref<BenchmarkConfig['mode']>('standard');
const number = (v: number | null) => v == null ? '—' : v.toFixed(2);
function download() { if (props.report) downloadFile(benchmarkMarkdown(props.report), benchmarkFilename(props.report), 'text/markdown;charset=utf-8'); }
</script>
<template>
  <span class="eyebrow">ПЛАВНОСТЬ В ЦИФРАХ</span><h2>Бенчмарк</h2>
  <p>Проверка навигации с полным и лёгким стеклом в текущем размере окна. Перед измерением шейдеры подготавливаются, затем идут 2 секунды прогрева и 10 секунд теста на вариант.</p>
  <div class="benchmark-options"><label><input v-model="mode" type="radio" value="standard" name="benchmark-mode" /> Стандартный набор <small>Mandelbrot, Julia, Burning Ship · 512 итераций · около 72 с</small></label><label><input v-model="mode" type="radio" value="current" name="benchmark-mode" /> Текущая сцена <small>Ваши параметры и камера · около 24 с</small></label></div>
  <p v-if="resourceMode==='economy'" role="status" class="small-note">Стандартный набор временно снимает экономные ограничения и может сильно нагрузить устройство. Текущая сцена сохраняет экономный режим; два варианта стекла сравниваются временно.</p>
  <p class="small-note">Стандартный набор использует профиль «Авто». Текущая сцена — выбранный профиль «{{ qualityProfiles[qualityProfile].name }}».</p>
  <p class="small-note">Приближённый просмотр float32/DS с выбранными итерациями; binary64 доступна при экспорте PNG. Методика v6 отдельно учитывает готовые поля, тайлы и отправки изображения по событиям. Кэш просмотра на время теста отключён. Экономный режим: float32, до 512 итераций и 30 отправок/с.</p>
  <p class="small-note">Оставьте вкладку активной и не меняйте размер окна. После теста сцена восстановится. Готовность GPU наблюдается неблокирующим fence; это не физические кадры или задержка монитора. Поздние GPU-query ожидаются до 0,5 с вне измерительного окна.</p>
  <p v-if="!available" role="status" class="form-error">Для теста необходимо готовое изображение WebGL2.</p>
  <v-btn color="primary" block :disabled="!available" @click="emit('start', mode)">{{ report ? 'Запустить ещё раз' : 'Запустить бенчмарк' }}</v-btn>
  <section v-if="report" class="benchmark-results" aria-label="Результаты бенчмарка"><h3>{{ report.status === 'completed' ? 'Результаты' : 'Неполный прогон' }}</h3><p v-if="report.reason" role="status">{{ report.reason }}</p>
    <p class="device-name">{{ report.device.browser }} · {{ report.device.platform }}<br />{{ report.device.webgl.renderer }}</p>
    <p class="benchmark-profile">Профиль: {{ qualityProfiles[report.qualityProfile].name }} · {{ report.method }}</p><p v-for="(row,i) in report.results" :key="`view-${i}`" class="small-note">{{ getFractal(row.scene.fractalId).name }} · итерации {{ row.effectiveIterations?.join(', ') || 'Недоступно' }} · новых полей/с {{ number(row.newFieldsPerSecond ?? null) }} · p95 полей {{ number(row.p95FieldMs ?? null) }} мс · тайлы {{ row.measurement?.publishedTiles ?? row.presentations?.computed ?? 0 }} · из кэша {{ row.measurement?.restoredFields ?? 0 }} · перепроекции {{ row.presentations?.reprojection ?? 0 }} · повторные предъявления {{ row.presentations?.repeat ?? 0 }}</p>
    <p v-if="report.arithmeticVersion" class="small-note">Навигация: предпросмотр. Точный расчёт: {{ report.arithmeticVersion }}.</p>
    <div v-for="(row, index) in report.results" :key="`precision-${index}`">
      <p v-if="row.precision" class="small-note" style="overflow-wrap:anywhere">
        {{ getFractal(row.scene.fractalId).name }} · {{ row.lightGlass ? 'лёгкое' : 'полное' }}: точный кадр {{ row.precision.status === 'completed' ? 'готов' : 'не завершён' }} за {{ number(row.precision.durationMs / 1000) }} с · поле {{ row.precision.computeResolution || '—' }} · вывод {{ row.precision.displayResolution || '—' }}<br />
        {{ row.precision.reason }}<br />Исполнитель: {{ row.precision.executor || '—' }} · подготовка {{ number(row.precision.preparationMs ?? null) }} мс<br />
        Ядро: {{ row.precision.kernelVariant || 'Недоступно' }}
        <template v-if="row.precision.kernelFallback"><br />Резервное ядро: {{ row.precision.kernelFallback }}</template>
      </p>
    </div>
    <div class="benchmark-table-wrap"><table><thead><tr><th>Фрактал / стекло</th><th>Отправок/с</th><th>p95, мс</th><th>GPU p95, мс</th></tr></thead><tbody><tr v-for="(row, index) in report.results" :key="index"><td>{{ getFractal(row.scene.fractalId).name }}<small>{{ row.lightGlass ? 'Лёгкое' : 'Полное' }} · {{ row.status === 'completed' ? 'Завершён' : 'Прерван' }}</small></td><td>{{ number(row.updatesPerSecond) }}</td><td>{{ number(row.p95FrameMs) }}</td><td>{{ number(row.p95GpuMs) }}</td></tr></tbody></table></div>
    <p v-if="!report.results.length">Измерения ещё не были выполнены. Причина остановки сохранится в отчёте.</p>
    <details><summary>Браузер и устройство</summary><dl class="device-details"><dt>Модель (браузер)</dt><dd>{{ report.device.model || 'Недоступно' }}</dd><dt>Архитектура</dt><dd>{{ report.device.architecture || 'Недоступно' }}</dd><dt>Логических процессоров</dt><dd>{{ report.device.logicalProcessors ?? 'Недоступно' }}</dd><dt>Память, приблизительно</dt><dd>{{ report.device.memoryGiB == null ? 'Недоступно' : `${report.device.memoryGiB} ГиБ` }}</dd><dt>Окно / DPR</dt><dd>{{ report.device.viewport.width }} × {{ report.device.viewport.height }} / {{ report.device.viewport.dpr }}</dd><dt>GPU-таймер</dt><dd>{{ report.device.webgl.gpuTimer ? 'Доступен' : 'Недоступен' }}</dd><dt>User-Agent</dt><dd>{{ report.device.userAgent }}</dd></dl></details>
    <div class="report-fields"><v-text-field v-model="report.deviceLabel" label="Модель устройства — вручную" maxlength="160" variant="outlined" hide-details /><v-text-field v-model="report.processorLabel" label="Процессор — вручную" maxlength="160" variant="outlined" hide-details /><v-textarea v-model="report.comment" label="Комментарий к результату" placeholder="Питание от сети, режим энергосбережения, другие приложения…" maxlength="4000" rows="3" variant="outlined" hide-details /></div>
    <v-btn color="primary" block @click="download">Скачать .md</v-btn><p class="small-note">Отчёт содержит условия, сведения о браузере и устройстве, метрики, ваш комментарий и снимки сцен. Можно изменить комментарий и скачать файл повторно.</p>
  </section>
</template>
