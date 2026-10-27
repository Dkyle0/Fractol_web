import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

/** One invocation owns one ignored run directory; child tools share its path. */
export async function createArtifactRoot(label) {
  if (!/^[a-z0-9._-]+$/i.test(label)) throw new Error('Invalid run label');
  const base = path.resolve('.local/runs');
  const requested = process.env.FRACTOL_RUN_DIR;
  const stamp = new Date().toISOString().replaceAll(':', '-');
  const destination = path.resolve(requested || path.join(base, `${label}-${stamp}-${process.pid}`));
  if (!destination.startsWith(base + path.sep)) throw new Error('FRACTOL_RUN_DIR must be inside .local/runs');
  await mkdir(base, { recursive: true });
  await mkdir(destination, { recursive: !!requested });
  const marker = path.join(destination, '.fractol-run.json');
  const inheritedOwner = process.env.FRACTOL_RUN_OWNER;
  const entries = await readdir(destination);
  let owner;
  if (entries.length === 0) {
    owner = randomUUID();
    // Never replace a marker, including a simultaneous claim of this directory.
    await writeFile(marker, JSON.stringify({ version: 1, owner }, null, 2), { flag: 'wx' });
  } else {
    let claim;
    try { claim = JSON.parse(await readFile(marker, 'utf8')); }
    catch { throw new Error('Run directory is not empty; choose a new FRACTOL_RUN_DIR'); }
    if (!inheritedOwner || !claim || claim.version !== 1 || claim.owner !== inheritedOwner) {
      throw new Error('Run directory belongs to another invocation; choose a new FRACTOL_RUN_DIR');
    }
    owner = inheritedOwner;
  }
  // Only children of a successful claim may share a directory for checkpoints.
  process.env.FRACTOL_RUN_DIR = destination;
  process.env.FRACTOL_RUN_OWNER = owner;
  return path.relative(process.cwd(), destination).replaceAll('\\', '/');
}
