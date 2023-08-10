import { WebGLRenderer, PerspectiveCamera, Scene, BoxGeometry, ShaderMaterial, Mesh, Vector2, Vector3 } from 'three'
import { resolveLygia } from 'resolve-lygia'

import { GlslSandbox }  from './index.js'

let W = window,
    D = document;

let width = W.innerWidth;
let height = W.innerHeight;
let pixelRatio = W.devicePixelRatio

const renderer = new WebGLRenderer({
    // antialias: true,
    // precision: 'mediump', 
    // powerPreference: "high-performance", 
    // depth: false, 
    // alpha: true,
    // preserveDrawingBuffer: true,
});
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

    mat4 rot =  rotate4dY(u_time) *
                rotate4dX(PI*0.2) * 
                rotate4dZ(PI*0.25);

    v_position = rot * v_position;

    v_normal = normalize( (rot * vec4(normal,1.0)).xyz );
    v_texcoord = uv;
    
    gl_Position = projectionMatrix * modelViewMatrix * v_position;
}
`);

const shader_frag = resolveLygia(/* glsl */`
#define PLATFORM_WEBGL

uniform sampler2D   u_scene;
uniform sampler2D   u_buffer0; // 512x512
uniform sampler2D   u_doubleBuffer0; // 512x512
uniform sampler2D   u_doubleBuffer1; // 512x512

uniform vec3        u_camera;
uniform vec2        u_resolution;
uniform float       u_time;
uniform int         u_frame;

varying vec2        v_texcoord;
varying vec4        v_position;

#include "lygia/space/ratio.glsl"
#include "lygia/space/sqTile.glsl"
#include "lygia/color/palette/hue.glsl"
#include "lygia/draw/circle.glsl"

void main() {
    vec4 color = vec4(vec3(0.0), 1.0);
    vec2 pixel = 1.0/u_resolution;
    vec2 st = gl_FragCoord.xy * pixel;
    vec2 uv = v_texcoord;

#ifdef BACKGROUND
    st = ratio(st, u_resolution);
    color.rgb += (1.0-circle(st, 0.8)) * vec3(st, sin(u_time)) * 0.1;

#elif defined(DOUBLE_BUFFER_0)
    color = texture2D(u_doubleBuffer0, st) * 0.99;

    float amount = 10.0;
    vec4 t = sqTile(uv, amount);
    float time = t.z + t.w + u_time * 4.0;
    t.xy += vec2(cos(time), sin(time)) * 0.2;
    color.rgb += hue( fract((t.z + t.w) / amount) + u_time * 0.1) * circle(t.xy, 0.1) * 0.05;

    color.a = 1.0;

#elif defined(DOUBLE_BUFFER_1)
    vec4 scene = texture2D(u_scene, st);
    
    color += texture2D(u_doubleBuffer1, st) * 0.99;
    color.rgb += scene.rgb * scene.a * 0.1;


#elif defined(POSTPROCESSING)
    color = texture2D(u_doubleBuffer1, st);

#else

    color.rg = st;
    color = texture2D(u_doubleBuffer0, uv);

#endif

    gl_FragColor = color;
}
`);

const uniforms = {
    u_camera: { type: "v3", value: new Vector3() },
};

// GLSL Buffers
const glsl_sandbox = new GlslSandbox(renderer, uniforms);
glsl_sandbox.load(shader_frag);

// SPHERE
const material = new ShaderMaterial({
    vertexShader: shader_vert,
    fragmentShader: shader_frag,
    uniforms: uniforms,
});
material.defines = glsl_sandbox.defines;

const mesh = new Mesh(new BoxGeometry( 1, 1, 1 ), material);
const scene = new Scene();
const cam = new PerspectiveCamera(45, width / height, 0.001, 200);
cam.position.z = 3;
scene.add(mesh);

const draw = () => {
    uniforms.u_camera.value = cam.position;

    // // 2D main shader
    // glsl_sandbox.renderMain();

    // 3D Scense
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

    material.uniforms.u_resolution.value = new Vector2(width, height);
    
    cam.aspect = width / height;
    cam.updateProjectionMatrix();
    draw();
};

W.addEventListener("resize", resize);
resize();

draw();