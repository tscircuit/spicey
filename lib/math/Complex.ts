import { EPS } from "../constants/EPS"

class Complex {
  re: number
  im: number

  constructor(re = 0, im = 0) {
    this.re = re
    this.im = im
  }

  static from(re: number, im = 0) {
    return new Complex(re, im)
  }

  static fromPolar(mag: number, deg = 0) {
    const ph = (deg * Math.PI) / 180
    return new Complex(mag * Math.cos(ph), mag * Math.sin(ph))
  }

  clone() {
    return new Complex(this.re, this.im)
  }

  add(b: Complex) {
    return new Complex(this.re + b.re, this.im + b.im)
  }

  sub(b: Complex) {
    return new Complex(this.re - b.re, this.im - b.im)
  }

  mul(b: Complex) {
    return new Complex(
      this.re * b.re - this.im * b.im,
      this.re * b.im + this.im * b.re,
    )
  }

  div(b: Complex) {
    const d = b.re * b.re + b.im * b.im
    if (d < EPS) throw new Error("Complex divide by ~0")
    return new Complex(
      (this.re * b.re + this.im * b.im) / d,
      (this.im * b.re - this.re * b.im) / d,
    )
  }

  inv() {
    const d = this.re * this.re + this.im * this.im
    if (d < EPS) throw new Error("Complex invert by ~0")
    return new Complex(this.re / d, -this.im / d)
  }

  abs() {
    return Math.hypot(this.re, this.im)
  }

  phaseDeg() {
    return (Math.atan2(this.im, this.re) * 180) / Math.PI
  }
}

export { Complex }
