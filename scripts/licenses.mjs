import { readFile, writeFile, mkdir } from 'node:fs/promises';
const packages = ['vue', '@vue/shared', '@vue/reactivity', '@vue/runtime-core', '@vue/runtime-dom', 'vuetify', 'pinia', '@mdi/js', '@fontsource/manrope'];
await mkdir('public/licenses', { recursive: true });
for (const name of packages) {
  let license;
  for (const file of ['LICENSE', 'LICENSE.md', 'LICENSE.txt']) {
    try { license = await readFile(`node_modules/${name}/${file}`, 'utf8'); break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!license) throw new Error(`License missing for ${name}`);
  const metadata = JSON.parse(await readFile(`node_modules/${name}/package.json`, 'utf8'));
  await writeFile(`public/licenses/${name.replaceAll('/', '-').replaceAll('@', '')}.txt`, `${name} ${metadata.version}\n\n${license}`);
}
// This canonical upstream notice is maintained independently of the npm copies.
// Fail if it is missing; never overwrite it with the general project index.
await readFile('public/licenses/berkeley-softfloat.txt', 'utf8');
await writeFile('public/licenses/fractol.txt', await readFile('LICENSE', 'utf8'));
const notices = await readFile('THIRD_PARTY_NOTICES.md', 'utf8');
const distributionIndex = notices
  .replace(/\[([^\]]+)\]\(public\/licenses\/([^)]+)\)/g, '$1: licenses/$2')
  .replace('[MIT](LICENSE)', 'MIT (licenses/fractol.txt)');
await writeFile('public/third-party-notices.txt', distributionIndex);
console.log(`Updated ${packages.length} dependency notices, the project license and distribution index; SoftFloat preserved.`);
