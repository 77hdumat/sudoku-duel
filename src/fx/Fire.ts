/**
 * 볼륨 불꽃 — mattatz/THREE.Fire (https://github.com/mattatz/THREE.Fire) 를 ES 모듈로 옮기고 조금 고쳤다.
 * 고친 점: 이펙트 레이어가 정사영 카메라라 광선 방향을 화면 안쪽(-z)으로 고정, 꺼질 때 쓰는 opacity, 가산 합성.
 * 불꽃 모양 텍스처는 public/assets/fire.png (같은 저장소의 Fire.png).
 *
 * The MIT License (MIT)
 *
 * Copyright (c) 2015 mattatz
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import * as THREE from 'three';

const vertexShader = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
}`;

// 원본 그대로 (simplex noise: ashima/webgl-noise, MIT) + ORTHO 광선 · opacity
const fragmentShader = /* glsl */ `
uniform vec3 color;
uniform float time;
uniform float seed;
uniform mat4 invModelMatrix;
uniform vec3 scale;
uniform vec4 noiseScale;
uniform float magnitude;
uniform float lacunarity;
uniform float gain;
uniform float opacity;
uniform sampler2D fireTex;
varying vec3 vWorldPos;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

float turbulence(vec3 p) {
  float sum = 0.0;
  float freq = 1.0;
  float amp = 1.0;
  for (int i = 0; i < OCTIVES; i++) {
    sum += abs(snoise(p * freq)) * amp;
    freq *= lacunarity;
    amp *= gain;
  }
  return sum;
}

vec4 samplerFire(vec3 p, vec4 scale) {
  vec2 st = vec2(sqrt(dot(p.xz, p.xz)), p.y);
  if (st.x <= 0.0 || st.x >= 1.0 || st.y <= 0.0 || st.y >= 1.0) return vec4(0.0);
  p.y -= (seed + time) * scale.w;
  p *= scale.xyz;
  st.y += sqrt(st.y) * magnitude * turbulence(p);
  if (st.y <= 0.0 || st.y >= 1.0) return vec4(0.0);
  return texture2D(fireTex, st);
}

vec3 localize(vec3 p) { return (invModelMatrix * vec4(p, 1.0)).xyz; }

void main() {
  vec3 rayPos = vWorldPos;
  // 정사영 카메라: 모든 광선이 화면 안쪽으로 나란하다
  vec3 rayDir = vec3(0.0, 0.0, -1.0);
  float rayLen = 0.0288 * length(scale.xyz);
  vec4 col = vec4(0.0);
  for (int i = 0; i < ITERATIONS; i++) {
    rayPos += rayDir * rayLen;
    vec3 lp = localize(rayPos);
    lp.y += 0.5;
    lp.xz *= 2.0;
    col += samplerFire(lp, noiseScale);
  }
  col *= opacity;
  col.a = col.r;
  gl_FragColor = col;
}`;

const box = new THREE.BoxGeometry(1, 1, 1);
let tex: THREE.Texture | null = null;

export class Fire extends THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial> {
  constructor(color = 0xffffff) {
    if (!tex) {
      tex = new THREE.TextureLoader().load('assets/fire.png');
      tex.magFilter = tex.minFilter = THREE.LinearFilter;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    }
    super(
      box,
      new THREE.ShaderMaterial({
        defines: { ITERATIONS: '20', OCTIVES: '3' },
        uniforms: {
          fireTex: { value: tex },
          color: { value: new THREE.Color(color) },
          time: { value: 0 },
          seed: { value: Math.random() * 19.19 },
          invModelMatrix: { value: new THREE.Matrix4() },
          scale: { value: new THREE.Vector3(1, 1, 1) },
          noiseScale: { value: new THREE.Vector4(1, 2, 1, 0.3) },
          magnitude: { value: 1.3 },
          lacunarity: { value: 2.0 },
          gain: { value: 0.5 },
          opacity: { value: 1 },
        },
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    );
  }

  /** 매 프레임: 시간(초)·투명도를 넘기고 모델 역행렬을 맞춘다 */
  update(time: number, opacity = 1): void {
    const u = this.material.uniforms;
    this.updateMatrixWorld();
    (u.invModelMatrix.value as THREE.Matrix4).copy(this.matrixWorld).invert();
    u.time.value = time;
    u.opacity.value = opacity;
    (u.scale.value as THREE.Vector3).copy(this.scale);
  }

  dispose(): void {
    this.material.dispose();
  }
}
