# GlslSandbox 🖌📦

[![stable](http://badges.github.io/stability-badges/dist/stable.svg)](http://github.com/badges/stability-badges)

GlslSandbox is a module that brings the workflow of [glslViewer](https://github.com/patriciogonzalezvivo/glslViewer) for handling multiple buffers. It follows the premise of branching the code in a shader by using `#define` flags. Currently it supports defines for `BUFFERS`, `DOUBLE_BUFFERS`, `BACKGROUND` and `POSTPROCESSING`. For more information on this workflow, please read glslViewer's [wiki](https://github.com/patriciogonzalezvivo/glslViewer/wiki)

It works with [three.js](https://github.com/mrdoob/three.js) at the moment, but the logic can be used in many other graphics environments.



## Install

```sh
npm install glsl-sandbox --save
```

## Usage
```js
import { WebGLRenderer, PerspectiveCamera, Vector3 } from 'three';
import { GlslSandbox } from 'glsl-sandbox';

const renderer = new WebGLRenderer();
const camera = new PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 100);

const fragmentShader = `
#define PLATFORM_WEBGL

uniform sampler2D   u_scene;

uniform vec2        u_resolution;

void main() {
    vec4 color = vec4(vec3(0.0), 1.0);
    vec2 pixel = 1.0 / u_resolution;
    vec2 st = gl_FragCoord.xy * pixel;

#if defined(BACKGROUND)
    // This will render a red background behind the 3D
    color.r = 1.0;

#elif defined(POSTPROCESSING)
    // Postprocessing pass,
    // displays the scene directly to the screen
    color = texture2D(u_scene, st);

#endif

    gl_FragColor = color;
}
`;

const sandbox = new GlslSandbox(renderer, {
    // Optional uniforms object to pass to the shader
    u_camera: { value: new Vector3() },
});

sandbox.load(fragmentShader);

const draw = () => {
    // Renders the 3D Scene, to render
    // a 2D main shader use sandbox.renderMain();
    sandbox.renderScene(scene, camera);

    requestAnimationFrame(draw);
};

const resize = () => {
    sandbox.setSize(window.innerWidth, window.innerHeight);
};

window.addEventListener("resize", resize);
resize();

draw();
```

## Demo

To build/run from source, first `git clone` this repo 

```sh
git clone git@github.com:patriciogonzalezvivo/glsl-sandbox.git
```

And then:

```sh
npm install
```

Once installed, you can test/build the demo like this:

```sh
# to run demo dev server/scripts
npm run dev

# to run demo build scripts
npm run build
```

## License

MIT, see [LICENSE.md](http://github.com/patriciogonzalezvivo/glsl-sandbox/blob/master/LICENSE.md) for details.
