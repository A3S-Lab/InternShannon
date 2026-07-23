interface SlidesViewport {
  onMouseWheel$?: unknown;
}

export interface SlidesSceneWithViewport {
  getMainViewport(): SlidesViewport | undefined;
  getViewport(key: string): SlidesViewport | undefined;
}

interface SlidesRender {
  unitId: string;
  scene: SlidesSceneWithViewport;
}

export interface SlidesRenderManager {
  getRenderById(unitId: string): SlidesRender | null | undefined;
  created$: {
    subscribe(observer: (render: SlidesRender) => void): { unsubscribe(): void };
  };
}

// Univer Slides 0.24 registers the presentation viewport as `__mainView__`,
// while the shared Canvas wheel handler only looks up `viewMain`. Point that
// lookup at the real slide viewport so a wheel event cannot dereference
// `undefined`.
export const UNIVER_SLIDES_VIEWPORT_KEY = "__mainView__";

export function installSlidesMainViewportFallback(
  scene: SlidesSceneWithViewport
): { dispose(): void } {
  const originalGetMainViewport = scene.getMainViewport;
  const getOriginalMainViewport = originalGetMainViewport.bind(scene);

  if (getOriginalMainViewport()) {
    return { dispose() {} };
  }

  // The slide viewport is registered asynchronously after the scene is created.
  // Keep the fallback lookup lazy so early installation starts working as soon
  // as Univer adds that viewport.
  const patchedGetMainViewport = () =>
    getOriginalMainViewport() ?? scene.getViewport(UNIVER_SLIDES_VIEWPORT_KEY);
  scene.getMainViewport = patchedGetMainViewport;

  return {
    dispose() {
      if (scene.getMainViewport === patchedGetMainViewport) {
        scene.getMainViewport = originalGetMainViewport;
      }
    },
  };
}

export function installSlidesRenderViewportFallback(
  renderManager: SlidesRenderManager,
  unitId: string
): { dispose(): void } {
  let viewportFallback: { dispose(): void } | undefined;
  const install = (render: SlidesRender) => {
    if (render.unitId !== unitId || viewportFallback) return;
    viewportFallback = installSlidesMainViewportFallback(render.scene);
  };

  const existingRender = renderManager.getRenderById(unitId);
  if (existingRender) install(existingRender);
  const createdSubscription = renderManager.created$.subscribe(install);

  return {
    dispose() {
      createdSubscription.unsubscribe();
      viewportFallback?.dispose();
    },
  };
}
