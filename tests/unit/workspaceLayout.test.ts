import { describe, expect, it } from 'vitest';
import { closeWorkspacePanel, createWorkspace, openWorkspacePanel, resizeWorkspace, toggleWorkspacePanel } from '../../src/domain/workspace';

describe('workspace transitions', () => {
  it('keeps desktop panels independent and opens the requested remembered panel from clean view', () => {
    const initial = createWorkspace(1440);
    const hidden = { ...initial, immersive: true };
    const parameters = toggleWorkspacePanel(hidden, 'controls');
    expect(parameters).toMatchObject({ immersive: false, catalogOpen: true, controlsOpen: true });
    expect(initial).toEqual(createWorkspace(1440));
    expect(toggleWorkspacePanel(parameters, 'controls').catalogOpen).toBe(true);
  });
  it.each([320, 767, 768, 1279])('keeps panels exclusive at %s pixels', width => {
    const initial = createWorkspace(width);
    const parameters = toggleWorkspacePanel({ ...initial, immersive: true }, 'controls');
    expect(parameters).toMatchObject({ immersive: false, catalogOpen: false, controlsOpen: true });
    expect(openWorkspacePanel(parameters, 'catalog')).toMatchObject({ catalogOpen: true, controlsOpen: false });
  });
  it('retains last-selected panel on shrinking and uses parameters as a fallback', () => {
    const initial = createWorkspace(1440);
    expect(resizeWorkspace(initial, 900)).toMatchObject({ catalogOpen: false, controlsOpen: true });
    const catalogLast = openWorkspacePanel(initial, 'catalog');
    expect(resizeWorkspace(catalogLast, 390)).toMatchObject({ catalogOpen: true, controlsOpen: false });
    expect(resizeWorkspace(resizeWorkspace(catalogLast, 390), 1440).controlsOpen).toBe(false);
  });
  it('preserves hidden panel choices through resize and explicit closing', () => {
    const parametersClosed = closeWorkspacePanel(createWorkspace(1440), 'controls');
    const hidden = resizeWorkspace({ ...parametersClosed, immersive: true }, 390);
    expect(hidden).toMatchObject({ immersive: true, catalogOpen: true, controlsOpen: false });
    expect(toggleWorkspacePanel(hidden, 'controls')).toMatchObject({ immersive: false, catalogOpen: false, controlsOpen: true });
  });
});
