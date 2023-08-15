import { WebGLRenderer, PerspectiveCamera, Scene, BoxGeometry, ShaderMaterial, Mesh, Vector2, Vector3 } from 'three';
import { resolveLygia } from 'resolve-lygia';

import { GlslSandbox } from '../index.js';

let W = window,
    D = document;

let width = W.innerWidth;
let height = W.innerHeight;
let pixelRatio = W.devicePixelRatio;

const renderer = new WebGLRenderer();
renderer.setPixelRatio(pixelRatio);
renderer.setSize(width, height);
D.body.appendChild(renderer.domElement);

const shader_vert = resolveLygia(/* glsl */`
#define PLATFORM_WEBGL

uniform float   u_time;

varying vec2    v_texcoord;
varying vec3    v_normal;
varying vec4    v_position;

#include "lygia/math/const.glsl"
#include "lygia/math/rotate4dX.glsl"
#include "lygia/math/rotate4dY.glsl"
#include "lygia/math/rotate4dZ.glsl"

void main(void) {
    v_position = vec4(position, 1.0);

    mat4 rot =  rotate4dY(u_time * 0.5) *
                rotate4dX(u_time * 0.3) * 
                rotate4dZ(u_time * 0.2);

    v_position = rot * v_position;

    v_normal = normalize( (rot * vec4(normal,1.0)).xyz );
    v_texcoord = uv;
    
    gl_Position = projectionMatrix * modelViewMatrix * v_position;
}
`);

const shader_frag = resolveLygia(/* glsl */`
#define PLATFORM_WEBGL

uniform sampler2D   u_scene;
uniform sampler2D   u_doubleBuffer0;

uniform vec2        u_resolution;
uniform float       u_time;
uniform int         u_frame;

varying vec2        v_texcoord;
varying vec3        v_normal;
varying vec4        v_position;

#include "lygia/space/scale.glsl"

void main() {
    vec4 color = vec4(vec3(0.0), 1.0);
    vec2 pixel = 1.0 / u_resolution;
    vec2 st = gl_FragCoord.xy * pixel;
    vec2 uv = v_texcoord;

#if defined(BACKGROUND)
    // Make sure the background is ALPHA ZERO
    color.a = 0.0;

#elif defined(DOUBLE_BUFFER_0)
    // Scale previous frame
    color.rgb = texture2D(u_doubleBuffer0, scale(st, 0.995)).rgb;

    // Incorporate scene pixels only where alpha is not zero (where the geometry is)
    vec4 scene = texture2D(u_scene, st);
    color.rgb = mix(color.rgb, scene.rgb, scene.a);

#elif defined(POSTPROCESSING)
    color = texture2D(u_doubleBuffer0, st);

#else
    // Render normals as colors
    color.rgb = v_normal * 0.5 + 0.5;

#endif

    gl_FragColor = color;
}
`);

const uniforms = {
    u_camera: { value: new Vector3() },
};

// GLSL Buffers
const glsl_sandbox = new GlslSandbox(renderer, uniforms);
glsl_sandbox.load(shader_frag);

// SPHERE
const material = new ShaderMaterial({
    vertexShader: shader_vert,
    fragmentShader: shader_frag,
    uniforms,
});
material.defines = glsl_sandbox.defines;

const mesh = new Mesh(new BoxGeometry(1, 1, 1), material);
const scene = new Scene();
const cam = new PerspectiveCamera(45, width / height, 0.001, 200);
cam.position.z = 3;
scene.add(mesh);

const draw = () => {
    // 3D Scene
    glsl_sandbox.renderScene(scene, cam);

    requestAnimationFrame(draw);
};

const resize = () => {
    width = W.innerWidth;
    height = W.innerHeight;
    pixelRatio = W.devicePixelRatio;

    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height);

    glsl_sandbox.setSize(width, height);

    cam.aspect = width / height;
    cam.updateProjectionMatrix();
};

W.addEventListener("resize", resize);
resize();

draw();