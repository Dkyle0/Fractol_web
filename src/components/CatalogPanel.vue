<script setup lang="ts">
import { computed, ref } from 'vue';
import { useExplorer } from '../stores/explorer';
import { fractals } from '../domain/catalog';
import Icon from './Icon.vue';
const store = useExplorer();
defineEmits<{ close: [] }>();
const query = ref(''), category = ref('Все');
const categories = ['Все', 'Классика', 'Вариации', 'Избранное'];
const results = computed(() => fractals.filter(f =>
  (category.value === 'Все' || category.value === f.category || (category.value === 'Избранное' && store.library.favorites.includes(f.id))) &&
  `${f.name} ${f.id} ${f.subtitle}`.toLowerCase().includes(query.value.trim().toLowerCase()),
));
</script>
<template>
  <aside class="catalog-panel side-panel glass" aria-label="Каталог фракталов" data-testid="catalog-panel">
    <div class="panel-heading"><div><span class="eyebrow">БЕСКОНЕЧНОЕ РАЗНООБРАЗИЕ</span><h2>Фракталы <span class="count">{{ fractals.length }}</span></h2></div><v-btn variant="text" class="icon-button panel-close" aria-label="Закрыть каталог" @click="$emit('close')"><Icon name="close" :size="18" /></v-btn></div>
    <label class="search-field"><Icon name="search" :size="18" /><input v-model="query" aria-label="Найти фрактал" placeholder="Найти свою вселенную…" /><kbd>/</kbd></label>
    <div class="catalog-filters" aria-label="Категории"><button v-for="item in categories" :key="item" :class="{ active: category === item }" :aria-pressed="category === item" @click="category = item">{{ item }}</button></div>
    <div class="catalog-grid">
      <article v-for="fractal in results" :key="fractal.id" class="fractal-card" :class="{ selected: store.scene.fractalId === fractal.id }">
        <button class="fractal-select" :aria-label="`Открыть: ${fractal.name}`" :aria-pressed="store.scene.fractalId === fractal.id" @click="store.select(fractal.id)">
          <div class="thumbnail"><img :src="`./thumbnails/${fractal.id}.webp`" alt="" loading="lazy" /><span v-if="store.scene.fractalId === fractal.id" class="selected-mark"><Icon name="check" :size="12" /></span></div>
          <span class="card-name">{{ fractal.name }}</span><span class="card-category">{{ fractal.category }}</span>
        </button>
        <button class="favorite-button" :class="{ marked: store.library.favorites.includes(fractal.id) }" :aria-label="`${store.library.favorites.includes(fractal.id) ? 'Убрать из избранного' : 'В избранное'}: ${fractal.name}`" :aria-pressed="store.library.favorites.includes(fractal.id)" @click="store.favorite(fractal.id)"><Icon :name="store.library.favorites.includes(fractal.id) ? 'heart' : 'favorite'" :size="14" /></button>
      </article>
      <p v-if="!results.length" class="empty-state">{{ category === 'Избранное' ? 'Отмечайте фракталы сердечком — они появятся здесь.' : 'Ничего не найдено. Попробуйте другое название.' }}</p>
    </div>
    <div class="panel-footnote"><Icon name="spark" :size="15" /><span>Каждая формула — новый мир</span></div>
  </aside>
</template>
