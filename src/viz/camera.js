export class Camera {
        constructor(p) {
                this.p = p;
                this.tx = p.width / 2;
                this.ty = p.height / 2;
                this.scale = 1.0;

                this.panning = false;
                this.panLast = null;
        }

        startPan(p) {
                this.panning = true;
                this.panLast = { x: p.mouseX, y: p.mouseY };
        }

        dragPan(p) {
                if (!this.panning) return;
                const dx = p.mouseX - this.panLast.x;
                const dy = p.mouseY - this.panLast.y;
                this.tx += dx;
                this.ty += dy;
                this.panLast = { x: p.mouseX, y: p.mouseY };
        }

        endPan() {
                this.panning = false;
                this.panLast = null;
        }

        apply() {
                const p = this.p;
                p.push();
                p.translate(this.tx, this.ty);
                p.scale(this.scale);
        }

        unapply() {
                this.p.pop();
        }

        reset() {
                const p = this.p;
                this.tx = p.width / 2;
                this.ty = p.height / 2;
                this.scale = 1.0;
        }

        screenToWorld(px, py) {
                return { x: (px - this.tx) / this.scale, y: (py - this.ty) / this.scale };
        }

        onWheel(p, event) {
                const before = this.screenToWorld(p.mouseX, p.mouseY);
                const zoom = Math.pow(1.0015, -event.delta);
                this.scale = p.constrain(this.scale * zoom, 0.2, 3.0);
                const after = this.screenToWorld(p.mouseX, p.mouseY);
                this.tx += (after.x - before.x) * this.scale;
                this.ty += (after.y - before.y) * this.scale;
                return false;
        }
}
