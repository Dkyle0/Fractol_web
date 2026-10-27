export type WorkspacePanel = 'catalog' | 'controls';
export interface WorkspaceLayout {
  width: number;
  catalogOpen: boolean;
  controlsOpen: boolean;
  immersive: boolean;
  lastPanel: WorkspacePanel | null;
}
export function createWorkspace(width: number): WorkspaceLayout {
  return { width, catalogOpen: true, controlsOpen: width >= 1280, immersive: false, lastPanel: null };
}
export function resizeWorkspace(state: WorkspaceLayout, width: number): WorkspaceLayout {
  const next = { ...state, width };
  if (width < 1280 && next.catalogOpen && next.controlsOpen) {
    if (next.lastPanel === 'catalog') next.controlsOpen = false;
    else next.catalogOpen = false;
  }
  return next;
}
export function openWorkspacePanel(state: WorkspaceLayout, panel: WorkspacePanel): WorkspaceLayout {
  const next = { ...state, immersive: false, lastPanel: panel };
  if (panel === 'catalog') { next.catalogOpen = true; if (next.width < 1280) next.controlsOpen = false; }
  else { next.controlsOpen = true; if (next.width < 1280) next.catalogOpen = false; }
  return next;
}
export function closeWorkspacePanel(state: WorkspaceLayout, panel: WorkspacePanel): WorkspaceLayout {
  return { ...state, ...(panel === 'catalog' ? { catalogOpen: false } : { controlsOpen: false }) };
}
export function toggleWorkspacePanel(state: WorkspaceLayout, panel: WorkspacePanel): WorkspaceLayout {
  // A hidden-but-remembered panel must open when requested from clean view.
  return !state.immersive && (panel === 'catalog' ? state.catalogOpen : state.controlsOpen)
    ? closeWorkspacePanel(state, panel) : openWorkspacePanel(state, panel);
}
