const radius = .32;
const gravity = 20;
const launchSpeed = 6.76;
const skin = .002;

function overlaps(box, x, z) {
  const dx = Math.max(box.min.x - x, 0, x - box.max.x);
  const dz = Math.max(box.min.z - z, 0, z - box.max.z);
  return dx * dx + dz * dz < radius * radius;
}

export class PlayerMotor {
  constructor(boxes, bounds) {
    this.boxes = boxes;
    this.bounds = bounds;
    this.reset();
  }

  reset() {
    this.y = this.vy = this.vx = this.vz = 0;
    this.landing = this.landingSpeed = this.jumpBuffer = 0;
    this.grace = .07;
    this.grounded = true;
  }

  headroom(x, z) {
    let clearance = Infinity;
    for (const box of this.boxes) {
      if (box.min.y > this.y + skin && overlaps(box, x, z)) {
        clearance = Math.min(clearance, box.min.y - this.y);
      }
    }
    return clearance;
  }

  blocked(x, z, height) {
    const b = this.bounds;
    if (x < b.minX + radius || x > b.maxX - radius ||
        z < b.minZ + radius || z > b.maxZ - radius) return true;
    return this.boxes.some(box => box.max.y > this.y + skin &&
      box.min.y < this.y + height - skin && overlaps(box, x, z));
  }

  support(x, z, maxHeight) {
    if (maxHeight <= skin) return 0;
    let floor = 0;
    for (const box of this.boxes) {
      if (box.max.y > floor && box.max.y <= maxHeight + skin && overlaps(box, x, z)) {
        floor = box.max.y;
      }
    }
    return floor;
  }

  jump() {
    this.jumpBuffer = .10;
  }

  advance(pos, targetX, targetZ, moving, height, dt) {
    let impact = 0;
    // Resolve contact several times per rendered frame so narrow ledges also
    // catch a falling capsule on a slow frame.
    const slices = Math.ceil(dt * 120);
    const h = dt / slices;
    for (let i = 0; i < slices; i++) {
      if (this.jumpBuffer > 0 && this.grace > 0 && this.headroom(pos.x, pos.z) > height + .04) {
        this.vy = launchSpeed;
        this.grounded = false;
        this.grace = this.jumpBuffer = 0;
      }
      this.jumpBuffer = Math.max(0, this.jumpBuffer - h);
      const oldY = this.y;
      if (!this.grounded) {
        const ceiling = this.vy > 0 ? this.headroom(pos.x, pos.z) : Infinity;
        this.y += this.vy * h - gravity * h * h / 2;
        this.vy -= gravity * h;
        if (this.y > oldY + ceiling - height) {
          this.y = oldY + Math.max(0, ceiling - height);
          this.vy = 0;
        }
      }
      const rate = this.grounded ? (moving ? 22 : 32) : (moving ? 4.6 : .85);
      const decay = Math.exp(-rate * h);
      // Integrating the velocity response preserves travel distance across frame rates.
      const dx = targetX * h + (this.vx - targetX) * (1 - decay) / rate;
      const dz = targetZ * h + (this.vz - targetZ) * (1 - decay) / rate;
      this.vx = targetX + (this.vx - targetX) * decay;
      this.vz = targetZ + (this.vz - targetZ) * decay;
      if (dx && !this.blocked(pos.x + dx, pos.z, height)) pos.x += dx;
      else if (dx) this.vx = 0;
      if (dz && !this.blocked(pos.x, pos.z + dz, height)) pos.z += dz;
      else if (dz) this.vz = 0;

      const floor = this.support(pos.x, pos.z, Math.max(oldY, this.y));
      if (this.y <= floor + skin && this.vy <= 0) {
        if (!this.grounded && this.vy < -.85) {
          impact = Math.max(impact, Math.min(1, -this.vy / launchSpeed));
          this.landingSpeed = Math.max(this.landingSpeed, impact * 41);
        }
        this.y = floor;
        this.vy = 0;
        this.grounded = true;
        this.grace = .07;
      } else {
        this.grounded = false;
        this.grace = Math.max(0, this.grace - h);
      }
      const spring = this.landingSpeed + 16 * this.landing;
      const damping = Math.exp(-16 * h);
      this.landing = (this.landing + spring * h) * damping;
      this.landingSpeed = (this.landingSpeed - 16 * spring * h) * damping;
    }
    return impact;
  }
}
