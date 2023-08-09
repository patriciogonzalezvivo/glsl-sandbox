global.THREE = require('three')

var resolveLygia = require('resolve-lygia');

var GlslSandbox = require('./');
let W = window,
    D = document;

let width = W.innerWidth;
let height = W.innerHeight;
let pixelRatio = W.devicePixelRatio

let shader_frag = resolveLygia(`
#define PLATFORM_WEBGL

uniform sampler2D   u_doubleBuffer0;

uniform vec2        u_resolution;
uniform vec2        u_mouse;
uniform float       u_time;
uniform int         u_frame;

#include "lygia/generative/random.glsl"
#include "lygia/draw/stroke.glsl"
#include "lygia/sdf/circleSDF.glsl"

void main() {
    vec3 color = vec3(0.0);
    vec2 st = gl_FragCoord.xy/u_resolution;

#ifdef DOUBLE_BUFFER_0

    color = texture2D(u_doubleBuffer0, st).rgb;

    float d = 0.0;
    d = 1.75 * stroke(circleSDF(st - u_mouse/u_resolution + 0.5), 0.05, 0.01) * random(st + u_time);

    //  Grab the information arround the active pixel
    //
   	float s0 = color.y;
   	vec3  pixel = vec3(vec2(2.0)/u_resolution.xy,0.);
    float s1 = texture2D(u_doubleBuffer0, st + (-pixel.zy)).r;    //     s1
    float s2 = texture2D(u_doubleBuffer0, st + (-pixel.xz)).r;    //  s2 s0 s3
    float s3 = texture2D(u_doubleBuffer0, st + (pixel.xz)).r;     //     s4
    float s4 = texture2D(u_doubleBuffer0, st + (pixel.zy)).r;
    d += -(s0 - .5) * 2. + (s1 + s2 + s3 + s4 - 2.);

    d *= 0.99;
    d *= (u_frame <= 1)? 0.0 : 1.0; // Clean buffer at startup
    d = clamp(d * 0.5 + 0.5, 0.0, 1.0);

    color = vec3(d, color.x, 0.0);

#else
    color = texture2D(u_doubleBuffer0, st).rgb;

#endif

    gl_FragColor = vec4(color, 1.0);
}

`);
let frame = 0;

const renderer = new THREE.WebGLRenderer({
  antialias: false
})
renderer.setPixelRatio(pixelRatio);
renderer.setSize(width, height);
renderer.autoClearColor = false;
D.body.appendChild(renderer.domElement);

const uniforms = {
  u_camera: { type: "v3", value: new THREE.Vector3() },
  u_resolution: { type: "v2", value: new THREE.Vector2() },
  u_time: { type: "f", value: 0.0 },
  u_frame: { type: 'int', value: 0 },
};

// GLSL Buffers
const glsl_sandbox = new GlslSandbox(renderer, uniforms);
glsl_sandbox.load(shader_frag);

// SPHERE
const material = new THREE.ShaderMaterial({
  vertexShader: shader.vert,
  fragmentShader: `#define MODEL_VERTEX_NORMAL\n${shader_frag}`,
  uniforms: uniforms,
});
material.defines = glsl_sandbox.defines;

// Set parameters
glsl_sandbox.defines.ATMOSPHERE_INTENSITY = "1.0";
glsl_sandbox.defines.STARS_INTENSITY = "0.5";
glsl_sandbox.defines.GROUND_INTENSITY = "0.5";
glsl_sandbox.defines.STREAM_INTENSITY = "0.5";
glsl_sandbox.defines.LIGHT_FLARE_INTENSITY = "10.0";

const mesh = new THREE.Mesh(new THREE.SphereGeometry(15, 64, 32), material);
const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(45, width / height, 0.001, 200);
cam.position.z = 50;
scene.add(mesh);

console.log(material.defines);

// Draw loop
const delta = 1 / 24;
let nextTime = 0.0;
let time = 0.0;
const draw = () => {
  
  time = clock.getElapsedTime();
  if (nextTime < time) {
      uniforms.u_time.value = time;
      uniforms.u_frame.value = frame;
      uniforms.u_camera.value = cam.position;

      glsl_sandbox.renderScene(scene, cam);

      // Swap buffers
      nextTime = time + delta;
      frame++;
  }

  requestAnimationFrame(draw);
};

const resize = () => {
  width = W.innerWidth;
  height = W.innerHeight;
  pixelRatio = W.devicePixelRatio;

  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height);

  glsl_sandbox.setSize(width, height);

  material.uniforms.u_resolution.value = new THREE.Vector2(width, height);
  
  cam.aspect = width / height;
  cam.updateProjectionMatrix();
  draw();
};

W.addEventListener("resize", resize);
resize();

draw();


