import { reactive, toRefs } from 'vue';
import { closeWorkspacePanel, createWorkspace, openWorkspacePanel, resizeWorkspace, toggleWorkspacePanel, type WorkspaceLayout, type WorkspacePanel } from '../domain/workspace';

export function useWorkspaceLayout(width: number) {
  const state = reactive(createWorkspace(width));
  const apply = (next: WorkspaceLayout) => Object.assign(state, next);
  return {
    ...toRefs(state),
    snapshot: (): WorkspaceLayout => ({ ...state }),
    restore: (snapshot: WorkspaceLayout, width: number) => apply(resizeWorkspace(snapshot, width)),
    resize: (width: number) => apply(resizeWorkspace(state, width)),
    openPanel: (panel: WorkspacePanel) => apply(openWorkspacePanel(state, panel)),
    closePanel: (panel: WorkspacePanel) => apply(closeWorkspacePanel(state, panel)),
    togglePanel: (panel: WorkspacePanel) => apply(toggleWorkspacePanel(state, panel)),
    setImmersive: (hidden: boolean) => { state.immersive = hidden; },
    enterBenchmark: () => apply({ ...state, immersive: false, catalogOpen: state.width >= 768, controlsOpen: state.width >= 1280 }),
  };
}
