import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createArtifactRoot } from '../../scripts/lib/runArtifacts.mjs';

test('artifact ownership permits children and prevents replacing old runs', async () => {
  const previous = { dir: process.env.FRACTOL_RUN_DIR, owner: process.env.FRACTOL_RUN_OWNER };
  const setEnvironment = (dir, owner) => {
    if (dir === undefined) delete process.env.FRACTOL_RUN_DIR; else process.env.FRACTOL_RUN_DIR = dir;
    if (owner === undefined) delete process.env.FRACTOL_RUN_OWNER; else process.env.FRACTOL_RUN_OWNER = owner;
  };
  await mkdir('.local/runs', { recursive: true });
  // Keep the evidence, like other diagnostic artifacts; no recursive cleanup.
  const root = await mkdtemp(path.resolve('.local/runs/run-artifacts-test-'));
  try {
    const destination = path.join(root, 'new');
    setEnvironment(destination);
    const result = await createArtifactRoot('parent');
    assert.equal(path.resolve(result), destination);
    const owner = process.env.FRACTOL_RUN_OWNER;
    assert.ok(owner);
    const marker = await readFile(path.join(destination, '.fractol-run.json'), 'utf8');
    await writeFile(path.join(destination, 'sentinel.txt'), 'original', { flag: 'wx' });

    // A child inherits both values. Reusing the root for checkpoints is valid.
    assert.equal(await createArtifactRoot('child'), result);
    assert.equal(await readFile(path.join(destination, '.fractol-run.json'), 'utf8'), marker);

    for (const rejectedOwner of [undefined, 'different-owner']) {
      setEnvironment(destination, rejectedOwner);
      await assert.rejects(createArtifactRoot('another-run'), /belongs to another invocation/);
      assert.equal(await readFile(path.join(destination, 'sentinel.txt'), 'utf8'), 'original');
      assert.equal(await readFile(path.join(destination, '.fractol-run.json'), 'utf8'), marker);
      assert.equal(process.env.FRACTOL_RUN_OWNER, rejectedOwner);
    }

    const old = path.join(root, 'old');
    await mkdir(old); await writeFile(path.join(old, 'result.json'), '{"old":true}', { flag: 'wx' });
    setEnvironment(old);
    await assert.rejects(createArtifactRoot('another-run'), /not empty/);
    assert.equal(await readFile(path.join(old, 'result.json'), 'utf8'), '{"old":true}');

    const malformed = path.join(root, 'malformed');
    await mkdir(malformed); await writeFile(path.join(malformed, '.fractol-run.json'), 'null', { flag: 'wx' });
    setEnvironment(malformed, owner);
    await assert.rejects(createArtifactRoot('another-run'), /belongs to another invocation/);

    const empty = path.join(root, 'empty'); await mkdir(empty);
    setEnvironment(empty); await createArtifactRoot('empty');
    assert.equal(JSON.parse(await readFile(path.join(empty, '.fractol-run.json'), 'utf8')).version, 1);

    setEnvironment(path.resolve('docs'));
    await assert.rejects(createArtifactRoot('outside'), /must be inside/);
    setEnvironment(undefined);
    const automatic = await createArtifactRoot('automatic');
    assert.match(automatic, /^\.local\/runs\/automatic-/);
  } finally { setEnvironment(previous.dir, previous.owner); }
});
