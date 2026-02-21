import { Model } from "./model/model.js";
import { Simulator } from "./sim/simulator.js";
import { buildGraphFromModel } from "./viz/buildGraph.js";
import { Camera } from "./viz/camera.js";

const sketch = (p) => {
  let model;
  let sim;
  let graph;
  let camera;

  p.setup = () => {
    const wrap = document.getElementById("canvas-wrap") || document.body;

    const w = wrap === document.body ? p.windowWidth : wrap.clientWidth;
    const h = wrap === document.body ? p.windowHeight : wrap.clientHeight;

    const c = p.createCanvas(w, h);
    c.parent(wrap);

    p.textFont("system-ui");

    model = Model.example();
    sim = new Simulator(model);
    graph = buildGraphFromModel(p, model);
    camera = new Camera(p);
  };

  p.draw = () => {
    p.background(12);

    // simulation step(s)
    sim.tick(p.deltaTime / 1000, () => {
      graph = sim.rebuildGraphPreservingPositions(p, graph, buildGraphFromModel);
    });

    // world space
    camera.apply();
    graph.stepPhysics();
    graph.draw(camera);
    camera.unapply();

    // HUD overlays
    sim.drawHUD(p);

    // If you added a selection panel helper in main.js, it would be called here:
    // drawSelectionPanel(p, graph, model);
  };

  p.windowResized = () => {
    const wrap = document.getElementById("canvas-wrap") || document.body;

    const w = wrap === document.body ? p.windowWidth : wrap.clientWidth;
    const h = wrap === document.body ? p.windowHeight : wrap.clientHeight;

    p.resizeCanvas(w, h);
  };

  // Input routing
  p.mousePressed = () => graph.onMousePressed(p, camera);
  p.mouseDragged = () => graph.onMouseDragged(p, camera);
  p.mouseReleased = () => graph.onMouseReleased(camera);
  p.mouseWheel = (evt) => graph.onMouseWheel(p, camera, evt);

  p.keyPressed = () => {
    if (p.key === " ") camera.reset();
    else sim.onKey(p.key); // requires Simulator.onKey
  };
};

new window.p5(sketch);
