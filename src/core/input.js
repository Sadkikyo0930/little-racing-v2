/* Unified input: keyboard, gamepad, and touch. */

export class Input {
  constructor() {
    this.keys = new Set();
    this.state = {
      throttle: 0,   // 0..1
      brake: 0,      // 0..1
      steer: 0,      // -1..1
      drift: false,
      item: false,
      look: false,
    };
    this._itemEdge = false;
    this._prevItem = false;
    this._prevDrift = false;
    this.driftEdge = false;

    addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    this.touch = { steer: 0, throttle: 0, drift: false, item: false, brake: 0 };
  }

  has(...codes) {
    return codes.some((c) => this.keys.has(c));
  }

  update() {
    const s = this.state;
    const prevItem = s.item;
    const prevDrift = s.drift;

    let throttle = this.has('ArrowUp', 'KeyW') ? 1 : 0;
    let brake = this.has('ArrowDown', 'KeyS') ? 1 : 0;
    let steer = (this.has('ArrowRight', 'KeyD') ? 1 : 0) - (this.has('ArrowLeft', 'KeyA') ? 1 : 0);
    let drift = this.has('ShiftLeft', 'ShiftRight', 'Space');
    let item = this.has('KeyE', 'ControlLeft', 'KeyQ');
    let look = this.has('KeyC');

    // gamepad
    const pads = navigator.getGamepads?.() || [];
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] ?? 0;
      if (Math.abs(ax) > 0.14) steer += ax;
      const rt = p.buttons[7]?.value ?? 0;
      const lt = p.buttons[6]?.value ?? 0;
      throttle = Math.max(throttle, rt, p.buttons[0]?.pressed ? 1 : 0);
      brake = Math.max(brake, lt, p.buttons[1]?.pressed ? 1 : 0);
      drift = drift || !!p.buttons[5]?.pressed || !!p.buttons[4]?.pressed;
      item = item || !!p.buttons[2]?.pressed || !!p.buttons[3]?.pressed;
      break;
    }

    // touch
    throttle = Math.max(throttle, this.touch.throttle);
    brake = Math.max(brake, this.touch.brake);
    if (this.touch.steer) steer += this.touch.steer;
    drift = drift || this.touch.drift;
    item = item || this.touch.item;

    s.throttle = Math.min(1, throttle);
    s.brake = Math.min(1, brake);
    s.steer = Math.max(-1, Math.min(1, steer));
    s.drift = drift;
    s.item = item;
    s.look = look;

    this.itemPressed = item && !prevItem;
    this.driftPressed = drift && !prevDrift;
  }
}
