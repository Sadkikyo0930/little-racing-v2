/* ------------------------------------------------------------------ *
 * On-screen controls for phones and tablets.
 *
 * Steering is a *relative* analog pad: the whole lower-left quadrant is a
 * capture area, and the wheel is driven by how far the thumb has travelled
 * from wherever it first landed. That means you never have to look at the
 * screen to find a "stick", which is the main complaint with fixed pads.
 *
 * There is deliberately no drift button. A phone only has two thumbs and
 * one of them is busy steering, so drifting is folded into the gas: hold
 * the gas normally, and *blip* it — a quick lift and re-press — while the
 * wheel is turned to throw the kart into a slide. The slide is held for as
 * long as you stay on the gas, and banks its mini-turbo the moment you
 * straighten up or lift off, which is exactly when you want the boost.
 *
 * Everything uses Pointer Events with explicit capture so a finger that
 * slides off a button still releases it, and so multiple fingers (steer +
 * gas) are tracked independently.
 * ------------------------------------------------------------------ */

const FULL_LOCK_PX = 58;  // thumb travel for full steering lock
const RETURN_RATE = 7;    // how fast the wheel recentres once released

// A lift shorter than this counts as a blip rather than lifting off.
const BLIP_MS = 400;
// ...and the press it interrupted has to have been a real hold, so that
// simply tapping the gas repeatedly from a standstill doesn't drift.
const MIN_HOLD_MS = 90;
// Straightening the wheel for this long ends the slide and pays the boost.
const STRAIGHTEN_S = 0.16;
// How long a blip stays armed waiting for the wheel to be turned. Players
// blip *then* turn in about as often as they turn in then blip, and
// demanding steering lock at the exact instant of the re-press made the
// control feel like it only worked half the time.
const ARM_MS = 600;
// Steering lock that engages an armed slide, and the lock below which the
// slide is considered straightened out.
const DRIFT_STEER = 0.22;
// Steering *against* the slide this hard, for this long, bails out of it.
// Without this the only exit was straightening up, so a player fighting a slide
// held the wheel over, which is precisely what kept the slide alive — the kart
// stayed pinned in a circle and the wheel appeared to stop working.
const COUNTER_STEER = 0.55;
const COUNTER_S = 0.12;

export class TouchControls {
  constructor(input, root) {
    this.input = input;
    this.root = root.querySelector('#touch');
    if (!this.root) return;

    this.knob = this.root.querySelector('#steerKnob');
    this.pad = this.root.querySelector('#steerPad');
    this.steerPointer = null;
    this.steerOrigin = 0;
    this._raw = 0;

    this._gasDown = false;
    this._gasDownAt = 0;
    this._gasUpAt = -1e9;
    this._heldLongEnough = false;
    this._armedUntil = 0;
    this._drifting = false;
    this._driftDir = 0;
    this._straightT = 0;
    this._counterT = 0;

    this._bindSteer();
    this._bindGas();
    this._bindButton('#btnBrake', (on) => { this.input.touch.brake = on ? 1 : 0; });
    this._bindButton('#btnItem', (on) => { this.input.touch.item = on; });
    this._bindReset();
  }

  _bindSteer() {
    const pad = this.pad;

    pad.addEventListener('pointerdown', (e) => {
      if (this.steerPointer !== null) return;
      this.steerPointer = e.pointerId;
      this.steerOrigin = e.clientX;
      pad.setPointerCapture(e.pointerId);
      this.root.classList.add('steering');
      e.preventDefault();
    });

    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.steerPointer) return;
      const dx = e.clientX - this.steerOrigin;
      this._raw = Math.max(-1, Math.min(1, dx / FULL_LOCK_PX));
      // Let the thumb drag the origin along once it's past full lock, so the
      // wheel responds immediately when you start steering back the other way.
      if (Math.abs(dx) > FULL_LOCK_PX) {
        this.steerOrigin = e.clientX - Math.sign(dx) * FULL_LOCK_PX;
      }
      e.preventDefault();
    });

    const release = (e) => {
      if (e.pointerId !== this.steerPointer) return;
      this.steerPointer = null;
      this._raw = 0;
      this.root.classList.remove('steering');
    };
    pad.addEventListener('pointerup', release);
    pad.addEventListener('pointercancel', release);
    pad.addEventListener('lostpointercapture', release);
  }

  _bindGas() {
    const el = this.root.querySelector('#btnGas');
    if (!el) return;
    this.gasEl = el;

    const down = (e) => {
      el.setPointerCapture(e.pointerId);
      el.classList.add('on');
      const now = performance.now();
      // Re-pressing straight after a short lift is a blip, which *arms* the
      // slide. It engages as soon as the wheel is turned, which may be now or
      // may be a moment later -- see ARM_MS. A blip that is never followed by
      // any steering expires harmlessly, so tapping along a straight still
      // does nothing.
      if (now - this._gasUpAt < BLIP_MS && this._heldLongEnough) {
        this._armedUntil = now + ARM_MS;
        el.classList.add('armed');
      }
      this._gasDown = true;
      this._gasDownAt = now;
      this.input.touch.throttle = 1;
      e.preventDefault();
    };

    const up = (e) => {
      el.classList.remove('on');
      const now = performance.now();
      this._heldLongEnough = now - this._gasDownAt > MIN_HOLD_MS;
      this._gasUpAt = now;
      this._gasDown = false;
      this.input.touch.throttle = 0;
      // Lifting off cashes in the slide. A blip re-press will arm a fresh one,
      // so blipping mid-corner banks the boost and starts the next slide.
      this._disarm();
      this._endDrift();
      e?.preventDefault?.();
    };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', () => up({}));
  }

  _disarm() {
    this._armedUntil = 0;
    this.gasEl?.classList.remove('armed');
  }

  _endDrift() {
    if (!this._drifting) return;
    this._drifting = false;
    this._driftDir = 0;
    this._straightT = 0;
    this._counterT = 0;
    this.gasEl?.classList.remove('drift');
  }

  _bindButton(sel, set) {
    const el = this.root.querySelector(sel);
    if (!el) return;
    const down = (e) => {
      el.setPointerCapture(e.pointerId);
      el.classList.add('on');
      set(true);
      e.preventDefault();
    };
    const up = (e) => {
      el.classList.remove('on');
      set(false);
      e.preventDefault();
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', () => { el.classList.remove('on'); set(false); });
  }

  /** Little Racing V2 — one-tap "back to track" when a child gets stuck. */
  _bindReset() {
    const el = this.root.querySelector('#btnReset');
    if (!el) return;
    const down = (e) => {
      el.setPointerCapture(e.pointerId);
      el.classList.add('on');
      this.onReset?.();
      e.preventDefault();
    };
    const up = (e) => { el.classList.remove('on'); e?.preventDefault?.(); };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', () => el.classList.remove('on'));
  }

  show(on) {
    if (!this.root) return;
    this.root.classList.toggle('hidden', !on);
    if (!on) {
      // Never leave a control latched when the HUD is torn down mid-press.
      const t = this.input.touch;
      t.throttle = 0; t.brake = 0; t.steer = 0; t.drift = false; t.item = false;
      this._raw = 0;
      this.steerPointer = null;
      this._gasDown = false;
      this._disarm();
      this._endDrift();
    }
  }

  /** Smooth toward the raw thumb offset so kerb-bumps don't twitch the wheel. */
  update(dt) {
    if (!this.root) return;
    const t = this.input.touch;
    const k = this.steerPointer !== null ? 1 : Math.min(1, RETURN_RATE * dt);
    t.steer += (this._raw - t.steer) * k;
    if (Math.abs(t.steer) < 0.002) t.steer = 0;
    if (this.knob) this.knob.style.transform = `translateX(${t.steer * 46}px)`;

    // An armed blip engages the moment the wheel is turned, so it doesn't
    // matter whether you blip before or after you start turning in.
    if (this._armedUntil) {
      if (!this._gasDown || performance.now() > this._armedUntil) {
        this._disarm();
      } else if (Math.abs(t.steer) > DRIFT_STEER) {
        this._disarm();
        this._drifting = true;
        this._driftDir = Math.sign(t.steer);
        this._straightT = 0;
        this._counterT = 0;
        this.gasEl?.classList.add('drift');
      }
    }

    // Coming out of the corner ends the slide and pays out the mini-turbo,
    // so the boost lands on the exit rather than costing you the throttle.
    if (this._drifting) {
      if (Math.abs(t.steer) < 0.14) this._straightT += dt;
      else this._straightT = 0;
      // Hauling the wheel the other way is a deliberate "get me out of this".
      if (this._driftDir && Math.sign(t.steer) === -this._driftDir
          && Math.abs(t.steer) > COUNTER_STEER) this._counterT += dt;
      else this._counterT = 0;
      if (this._straightT > STRAIGHTEN_S || this._counterT > COUNTER_S) this._endDrift();
    }
    t.drift = this._drifting && this._gasDown;
  }
}
