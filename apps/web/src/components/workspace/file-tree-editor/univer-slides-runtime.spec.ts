import * as assert from "node:assert/strict";
import { test } from "node:test";
import {
  installSlidesMainViewportFallback,
  installSlidesRenderViewportFallback,
  setSlidesRenderZoom,
  UNIVER_SLIDES_VIEWPORT_KEY,
  type SlidesRenderManager,
  type SlidesSceneWithViewport,
} from "./univer-slides-runtime.ts";

test("uses Univer Slides 0.24's concrete SLIDE_KEY.VIEW value", () => {
  assert.equal(UNIVER_SLIDES_VIEWPORT_KEY, "__mainView__");
});

test("applies presentation zoom to the rendered scene", () => {
  const calls: number[][] = [];
  const scene: SlidesSceneWithViewport = {
    getMainViewport: () => undefined,
    getViewport: () => undefined,
    scale: (x, y) => {
      calls.push([x ?? 0, y ?? 0]);
      return scene;
    },
    makeDirty: () => scene,
  };
  assert.equal(setSlidesRenderZoom({ getRenderById: () => ({ unitId: "slide-1", scene }) }, "slide-1", 1.4), true);
  assert.deepEqual(calls, [[1.4, 1.4]]);
});

test("maps Univer Slides' view viewport to the generic wheel handler", () => {
  const slideViewport = { onMouseWheel$: {} };
  const originalGetMainViewport = () => undefined;
  const scene: SlidesSceneWithViewport = {
    getMainViewport: originalGetMainViewport,
    getViewport: (key) =>
      key === UNIVER_SLIDES_VIEWPORT_KEY ? slideViewport : undefined,
  };

  const disposable = installSlidesMainViewportFallback(scene);

  assert.equal(scene.getMainViewport(), slideViewport);
  disposable.dispose();
  assert.equal(scene.getMainViewport, originalGetMainViewport);
  assert.equal(scene.getMainViewport(), undefined);
});

test("keeps an upstream main viewport when Univer supplies one", () => {
  const mainViewport = { onMouseWheel$: {} };
  const originalGetMainViewport = () => mainViewport;
  const scene: SlidesSceneWithViewport = {
    getMainViewport: originalGetMainViewport,
    getViewport: () => ({ onMouseWheel$: {} }),
  };

  const disposable = installSlidesMainViewportFallback(scene);

  assert.equal(scene.getMainViewport, originalGetMainViewport);
  assert.equal(scene.getMainViewport(), mainViewport);
  disposable.dispose();
  assert.equal(scene.getMainViewport, originalGetMainViewport);
});

test("resolves a slide viewport that is registered after installation", () => {
  let slideViewport: { onMouseWheel$: unknown } | undefined;
  const originalGetMainViewport = () => undefined;
  const scene: SlidesSceneWithViewport = {
    getMainViewport: originalGetMainViewport,
    getViewport: (key) =>
      key === UNIVER_SLIDES_VIEWPORT_KEY ? slideViewport : undefined,
  };

  const disposable = installSlidesMainViewportFallback(scene);

  assert.notEqual(scene.getMainViewport, originalGetMainViewport);
  assert.equal(scene.getMainViewport(), undefined);
  slideViewport = { onMouseWheel$: {} };
  assert.equal(scene.getMainViewport(), slideViewport);
  disposable.dispose();
  assert.equal(scene.getMainViewport, originalGetMainViewport);
});

test("patches a slide render that is created after the unit", () => {
  let observer:
    | ((render: { unitId: string; scene: SlidesSceneWithViewport }) => void)
    | undefined;
  let unsubscribed = false;
  const slideViewport = { onMouseWheel$: {} };
  const originalGetMainViewport = () => undefined;
  const scene: SlidesSceneWithViewport = {
    getMainViewport: originalGetMainViewport,
    getViewport: (key) =>
      key === UNIVER_SLIDES_VIEWPORT_KEY ? slideViewport : undefined,
  };
  const renderManager: SlidesRenderManager = {
    getRenderById: () => undefined,
    created$: {
      subscribe(next) {
        observer = next;
        return {
          unsubscribe: () => {
            unsubscribed = true;
          },
        };
      },
    },
  };

  const disposable = installSlidesRenderViewportFallback(renderManager, "slide-1");
  observer?.({ unitId: "other-slide", scene });
  assert.equal(scene.getMainViewport, originalGetMainViewport);
  observer?.({ unitId: "slide-1", scene });
  assert.equal(scene.getMainViewport(), slideViewport);

  disposable.dispose();
  assert.equal(unsubscribed, true);
  assert.equal(scene.getMainViewport, originalGetMainViewport);
});
