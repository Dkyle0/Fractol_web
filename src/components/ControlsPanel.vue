<script setup lang="ts">
import { computed } from 'vue';
import { useExplorer } from '../stores/explorer';
import { palettes, paletteGradient } from '../domain/palettes';
import Icon from './Icon.vue';
import ParameterInput from './ParameterInput.vue';
import { iterationEditorLimit, limitResourceIterations, resourcePolicies } from '../domain/resources';
import { float32IterationLimit } from '../domain/viewing';
const store = useExplorer();
const props=defineProps<{ overview?: boolean; economy?:boolean }>();
const emit = defineEmits<{ close: []; interact: [] }>();
const activePalette = computed(() => palettes.find(p => p.id === store.scene.coloring.palette)!);
const resourceMode = computed(() => props.economy ? 'economy' : 'standard');
const detailLimit = computed(() => iterationEditorLimit(resourceMode.value));
const effectiveIterations = computed(() => limitResourceIterations(store.scene.iterations, resourceMode.value));
function applyDetailLimit() { store.change({ iterations: detailLimit.value }, 'iterations'); store.commitAction(); emit('interact'); }
function color(patch: Partial<typeof store.scene.coloring>) { store.change({ coloring: patch }); store.commitAction(); }
function invalidParameter() { store.notify('Значение вне допустимого диапазона. Восстановлено последнее допустимое значение.'); }
const remainingLabel = computed(() => ['newton', 'nova', 'phoenix', 'magnet-1'].includes(store.scene.fractalId) ? 'Неразрешённые и особые точки' : 'Внутренние области');
</script>
<template>
  <aside :inert="store.locked" class="controls-panel side-panel glass" aria-label="Параметры фрактала" data-testid="controls-panel">
    <div class="panel-heading parameters-heading"><h2 aria-label="Параметры"><button class="parameters-heading-button" aria-label="Скрыть параметры" aria-expanded="true" aria-controls="fractal-parameters" @click="emit('close')"><span><span class="eyebrow">ВАША ТОЧКА ЗРЕНИЯ</span><span class="panel-title">Параметры</span></span><Icon name="next" class="parameters-collapse" :size="20" /></button></h2></div>
    <div class="controls-scroll">
      <section class="control-section"><div class="section-label"><Icon name="location" :size="16" /><h3>Интересные места</h3></div>
        <button v-for="(preset, index) in store.definition.presets" :key="preset.name" class="preset-button" @click="store.preset(index)"><span>{{ preset.name }}</span><Icon name="next" :size="16" /></button>
      </section>
      <section class="control-section"><div class="section-label"><Icon name="layers" :size="16" /><h3>Детализация</h3><span class="value-badge">{{ store.scene.iterations }}</span></div>
        <template v-if="store.scene.iterations <= detailLimit">
        <v-slider :model-value="store.scene.iterations" @update:model-value="store.change({ iterations: $event }, 'iterations'); emit('interact')" @end="store.commitAction" @keyup="store.commitAction" @blur="store.commitAction" :min="64" :max="detailLimit" :step="16" hide-details thumb-size="12" track-size="3" aria-label="Число итераций" color="primary" />
        <div class="range-captions"><span>Быстрее</span><span>Больше деталей</span></div>
        <div class="complex-fields parameter-field"><ParameterInput :model-value="store.scene.iterations" label="Предел итераций" accessible-label="Предел итераций" :min="64" :max="detailLimit" :step="1" integer @begin="store.beginAction('iterations')" @update:model-value="store.change({ iterations: $event }, 'iterations'); emit('interact')" @commit="store.commitAction" @invalid="invalidParameter" /></div>
        </template>
        <template v-else>
          <p v-if="economy" class="small-note">В этой сцене сохранено {{ store.scene.iterations }} итераций. Исходное значение сохранено для обычного режима и точного PNG; предел просмотра — {{ detailLimit }}.</p>
          <p v-else class="small-note">В этой сцене сохранено {{ store.scene.iterations }} итераций. Просмотр использует весь предел через DS; редактор позволяет выбрать до {{ detailLimit }}. Кнопка ниже явно уменьшит число итераций сцены.</p>
          <v-btn variant="tonal" size="small" block @click="applyDetailLimit">Установить {{ detailLimit }}</v-btn>
        </template>
        <p v-if="economy" class="small-note">Экономный режим: float32, до {{ resourcePolicies.economy.iterationLimit }} итераций при движении и в покое. В сцене: {{ store.scene.iterations }}; просмотр: {{ effectiveIterations }}.</p><p v-else class="small-note">При движении и после остановки — выбранное число итераций. Для плавности подстраивается разрешение. Float32 — до {{ float32IterationLimit }} итераций; при глубоком приближении включается DS. Точный расчёт выполняется при экспорте.</p>
      </section>
      <section v-if="store.definition.parameters.length" class="control-section">
        <div class="section-label"><Icon name="tune" :size="16" /><h3>Параметры формулы</h3></div>
        <div v-for="field in store.definition.parameters" :key="`${store.scene.fractalId}:${field.key}`" class="formula-parameter">
          <div class="complex-fields parameter-field"><ParameterInput :model-value="store.scene.parameters[field.key] ?? field.default" :label="field.label" :accessible-label="field.label" :min="field.min" :max="field.max" :step="field.step" :integer="field.type === 'integer'" @update:model-value="value => { store.change({ parameters: { [field.key]: value } }, field.key); emit('interact'); }" @begin="store.beginAction(field.key)" @commit="store.commitAction" @invalid="invalidParameter" /></div>
          <v-slider v-if="!['juliaRe', 'juliaIm', 'phoenixRe', 'phoenixIm'].includes(field.key)" :model-value="store.scene.parameters[field.key] ?? field.default" @update:model-value="store.change({ parameters: { [field.key]: $event } }, field.key); emit('interact')" @end="store.commitAction" @keyup="store.commitAction" @blur="store.commitAction" :min="field.min" :max="field.max" :step="field.step" hide-details thumb-size="12" track-size="3" :aria-label="field.label" />
        </div>
        <button v-if="store.scene.fractalId === 'julia'" class="toggle-row" :aria-pressed="store.juliaPointer" @click="store.setJuliaPointer(!store.juliaPointer)"><Icon name="cursor" :size="16" /><span>Изменять указателем</span><span class="toggle" :class="{ on: store.juliaPointer }" /></button>
      </section>
      <section class="control-section palette-section"><div class="section-label"><Icon name="spark" :size="16" /><h3>Палитра</h3><span class="subtle">{{ activePalette.name }}</span></div>
        <div class="palette-grid"><button v-for="palette in palettes" :key="palette.id" :style="{ background: paletteGradient(palette) }" :class="{ active: store.scene.coloring.palette === palette.id }" :aria-label="`Палитра: ${palette.name}`" :aria-pressed="store.scene.coloring.palette === palette.id" :title="palette.name" @click="color({ palette: palette.id })"><Icon v-if="store.scene.coloring.palette === palette.id" name="check" :size="16" /></button></div>
        <div class="field-caption"><span>Сдвиг цвета</span><span>{{ Math.round(store.scene.coloring.phase * 100) }}%</span></div>
        <v-slider :model-value="store.scene.coloring.phase" @update:model-value="store.change({ coloring: { phase: $event } }, 'phase')" @end="store.commitAction" @keyup="store.commitAction" @blur="store.commitAction" :min="0" :max="1" :step="0.005" hide-details thumb-size="11" track-size="3" aria-label="Сдвиг цвета" />
        <div class="field-caption"><span>Плотность цвета</span><span>{{ store.scene.coloring.density.toFixed(2) }}</span></div>
        <v-slider :model-value="store.scene.coloring.density" @update:model-value="store.change({ coloring: { density: $event } }, 'density')" @end="store.commitAction" @keyup="store.commitAction" @blur="store.commitAction" :min="0.25" :max="3" :step="0.05" hide-details thumb-size="11" track-size="3" aria-label="Плотность цвета" />
        <label class="interior-row"><span>{{ remainingLabel }}</span><input :value="store.scene.coloring.interior" @input="store.change({ coloring: { interior: ($event.target as HTMLInputElement).value } }, 'interior')" @blur="store.commitAction" @change="store.commitAction" type="color" :aria-label="`Цвет: ${remainingLabel}`" /></label>
      </section>
      <section class="formula-note"><span class="eyebrow">МАТЕМАТИКА КРАСОТЫ</span><p class="formula">{{ store.definition.formula }}</p><p>{{ store.definition.description }}</p></section>
    </div>
    <button class="reset-controls" :disabled="overview" @click="store.reset"><Icon name="reset" :size="16" />Вернуться к общему виду</button>
  </aside>
</template>
