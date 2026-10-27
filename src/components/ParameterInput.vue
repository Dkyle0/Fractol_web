<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
const props = defineProps<{ modelValue: number; label: string; accessibleLabel: string; min: number; max: number; step?: number; integer?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [number]; invalid: []; commit: []; begin: [] }>();
const draft = ref(String(props.modelValue)), accepted = ref(props.modelValue);
const errorId = useId();
const value = computed(() => draft.value.trim() === '' ? NaN : Number(draft.value));
const invalid = computed(() => !Number.isFinite(value.value) || value.value < props.min || value.value > props.max || (props.integer && !Number.isInteger(value.value)));
watch(() => props.modelValue, next => {
  accepted.value = next;
  // Keep intermediate edits such as -0. and trailing zeroes when our own update returns.
  if (next !== value.value) draft.value = String(next);
});
function input(event: Event) {
  draft.value = (event.target as HTMLInputElement).value;
  if (!invalid.value) { accepted.value = value.value; emit('update:modelValue', value.value); }
}
function blur(event: FocusEvent) {
  const rejected = invalid.value;
  draft.value = String(accepted.value);
  (event.target as HTMLInputElement).value = draft.value;
  if (rejected) emit('invalid');
  emit('commit');
}
</script>
<template>
  <label>{{ label }}<input type="number" :value="draft" :min="min" :max="max" :step="integer ? (step ?? 1) : 'any'" :aria-label="accessibleLabel" :aria-invalid="invalid" :aria-describedby="invalid ? errorId : undefined" @focus="emit('begin')" @input="input" @blur="blur" @keydown.enter="($event.target as HTMLInputElement).blur()" />
    <span v-if="invalid" :id="errorId" class="parameter-error">Число от {{ min }} до {{ max }}</span>
  </label>
</template>
