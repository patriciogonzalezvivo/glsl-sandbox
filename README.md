# GlslSandbox 🖌📦

[![stable](http://badges.github.io/stability-badges/dist/stable.svg)](http://github.com/badges/stability-badges)

GlslSandbox is a module that brings the workflow of [glslViewer](https://github.com/patriciogonzalezvivo/glslViewer) for handling multiple buffers. It follows the premise of branching the code in a shader by using `#define` flags. Currently it supports defining `BUFFERS`, `DOUBLE_BUFFERS`, `BACKGROUND` and `POSTPROCESSING`. For more information on this workflow, please read glslViewer's [wiki](https://github.com/patriciogonzalezvivo/glslViewer/wiki)

It works with [three.js](https://github.com/mrdoob/three.js) at the moment, but the logic can be used in many other graphics environments.



## Install

```sh
npm install glsl-sandbox --save
```

## Usage

TODO

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
