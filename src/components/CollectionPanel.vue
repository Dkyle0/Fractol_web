<script setup lang="ts">
import { computed, ref } from 'vue';
import { useExplorer } from '../stores/explorer';
import { getFractal } from '../domain/catalog';
import { MAX_IMPORT_BYTES, previewLibraryImport, type LibraryImportPreview } from '../domain/library';
import { downloadFile } from '../infrastructure/download';
import Icon from './Icon.vue';
const emit = defineEmits<{ close: [] }>();
const store = useExplorer(), search = ref(''), sort = ref('newest'), editing = ref(''), name = ref('');
const fileInput = ref<HTMLInputElement>(), preview = ref<LibraryImportPreview>(), importRaw = ref(''), error = ref('');
const scenes = computed(() => {
  const query = (search.value || '').trim().toLocaleLowerCase('ru');
  return store.library.scenes.filter(s => `${s.name} ${getFractal(s.scene.fractalId).name}`.toLocaleLowerCase('ru').includes(query)).slice().sort((a, b) => sort.value === 'name' ? a.name.localeCompare(b.name, 'ru') : (Date.parse(a.createdAt) - Date.parse(b.createdAt)) * (sort.value === 'oldest' ? 1 : -1));
});
function exportLibrary() { downloadFile(JSON.stringify(store.library, null, 2), 'fractol-library.json', 'application/json;charset=utf-8'); }
async function readFile(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0];
  preview.value = undefined; error.value = ''; importRaw.value = '';
  try {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) throw new Error('Файл больше 1 МиБ.');
    importRaw.value = await file.text(); preview.value = previewLibraryImport(importRaw.value, store.library);
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Не удалось прочитать файл.'; }
  finally { input.value = ''; }
}
function applyImport() {
  try { store.importLibrary(importRaw.value); preview.value = undefined; importRaw.value = ''; store.notify('Коллекция дополнена.'); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'Не удалось добавить коллекцию.'; }
}
function rename() { store.rename(editing.value, name.value); editing.value = ''; }
</script>
<template>
  <span class="eyebrow">ВАШИ ОТКРЫТИЯ</span><h2>Моя коллекция <span class="count">{{ store.library.scenes.length }}</span></h2>
  <div class="collection-tools"><v-btn variant="tonal" @click="exportLibrary">Экспорт JSON</v-btn><v-btn variant="tonal" @click="fileInput?.click()">Импорт JSON</v-btn><input ref="fileInput" type="file" accept=".json,application/json" hidden aria-label="Файл коллекции" @change="readFile" /></div>
  <p v-if="error" role="alert" class="form-error">{{ error }}</p>
  <div v-if="preview" class="import-preview" role="status"><p>Новых сцен: {{ preview.additions.length }} · Повторов: {{ preview.duplicates }} · Некорректных записей: {{ preview.invalid }} · Избранных: {{ preview.favorites.length }}</p><p v-if="preview.overflow" class="form-error">Лимит 100 сцен будет превышен. Освободите место перед импортом.</p><div class="collection-tools"><v-btn color="primary" :disabled="preview.overflow" @click="applyImport">Добавить</v-btn><v-btn variant="text" @click="preview = undefined">Отмена импорта</v-btn></div></div>
  <div v-if="store.library.scenes.length" class="collection-filters"><v-text-field v-model="search" label="Поиск в коллекции" variant="outlined" hide-details clearable @click:clear="search = ''" /><label class="sort-label">Порядок<select v-model="sort" aria-label="Сортировка коллекции"><option value="newest">Сначала новые</option><option value="oldest">Сначала старые</option><option value="name">По имени</option></select></label></div>
  <p v-if="!store.library.scenes.length" class="collection-empty"><Icon name="save" :size="36" />Здесь будут ваши находки.<br />Сохраните сцену или импортируйте коллекцию.</p>
  <p v-else-if="!scenes.length" role="status">Ничего не найдено. Попробуйте другое название или имя фрактала.</p>
  <div v-else class="saved-list"><article v-for="item in scenes" :key="item.id">
    <form v-if="editing === item.id" class="rename-form" @submit.prevent="rename"><v-text-field v-model="name" label="Новое название" maxlength="80" variant="outlined" hide-details autofocus /><v-btn type="submit" :disabled="!name.trim()" aria-label="Применить название"><Icon name="check" /></v-btn><v-btn variant="text" aria-label="Отменить переименование" @click="editing = ''"><Icon name="close" /></v-btn></form>
    <template v-else><button class="saved-open" @click="store.load(item.id); emit('close')"><img :src="`./thumbnails/${item.scene.fractalId}.webp`" alt="" /><span><strong>{{ item.name }}</strong><small>{{ getFractal(item.scene.fractalId).name }} · {{ new Date(item.createdAt).toLocaleDateString('ru-RU') }}</small></span><Icon name="next" :size="18" /></button><button class="saved-rename" :aria-label="`Переименовать сцену: ${item.name}`" @click="editing = item.id; name = item.name"><Icon name="edit" :size="18" /></button><button class="saved-delete" :aria-label="`Удалить сцену: ${item.name}`" @click="store.remove(item.id)"><Icon name="delete" :size="18" /></button></template>
  </article></div>
</template>
