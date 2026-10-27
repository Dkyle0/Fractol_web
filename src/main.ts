import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createVuetify } from 'vuetify';
import { VApp, VBtn, VSlider, VDialog, VTextField, VTextarea, VMenu, VList, VListItem, VSnackbar, VProgressCircular } from 'vuetify/components';
import 'vuetify/styles';
import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/latin-500.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/latin-700.css';
import '@fontsource/manrope/cyrillic-400.css';
import '@fontsource/manrope/cyrillic-500.css';
import '@fontsource/manrope/cyrillic-600.css';
import '@fontsource/manrope/cyrillic-700.css';
import App from './App.vue';
import './styles.css';

const vuetify = createVuetify({
  components: { VApp, VBtn, VSlider, VDialog, VTextField, VTextarea, VMenu, VList, VListItem, VSnackbar, VProgressCircular },
  theme: { defaultTheme: 'fractol', themes: { fractol: { dark: true, colors: { primary: '#a8e9d8', surface: '#151e28', background: '#080e16', 'on-primary': '#122c29' } } } },
  defaults: { VBtn: { rounded: 'lg', elevation: 0, style: 'text-transform: none; letter-spacing: 0; font-weight: 600;' }, VSlider: { color: 'primary' } },
});
createApp(App).use(createPinia()).use(vuetify).mount('#app');
