import {
    WebGLRenderTarget,
    Camera,
    Scene,
    PlaneGeometry,
    ShaderMaterial,
    Mesh,
    Clock,
    Vector2,
    LinearFilter,
    RepeatWrapping,
    ClampToEdgeWrapping,
    FloatType,
    HalfFloatType,
    RGBAFormat,
    NearestFilter,
} from 'three';

class GlslSandbox {
    constructor(renderer, uniforms = {}) {
        if (!renderer.capabilities.floatFragmentTextures)
            throw new Error("No OES_texture_float support for float textures.");

        this.renderer = renderer;

        this.uniforms = uniforms;
        this.uniforms.u_resolution = { value: new Vector2() };
        this.uniforms.u_delta = { value: 0.0 };
        this.uniforms.u_time = { value: 0.0 };
        this.uniforms.u_frame = { value: 0 };

        this.currentTextureIndex = 0;
        this.buffers = [];
        this.doubleBuffers = [];
        this.background = null;
        this.main = null;
        this.sceneBuffer = null;
        this.postprocessing = null;

        this.billboard_scene = new Scene();
        this.billboard_camera = new Camera();
        this.billboard_camera.position.z = 1;
        this.passThruUniforms = { texture: { value: null } };
        this.passThruShader = createShaderMaterial(getPassThroughFragmentShader(), this.passThruUniforms);

        this.mesh = new Mesh(new PlaneGeometry(2, 2), this.passThruShader);
        this.billboard_scene.add(this.mesh);

        this.clock = new Clock();
        this.frame = 0;
        this.lastTime = 0.0;
        this.time = 0.0;
        this.resolution = new Vector2(renderer.domElement.width, renderer.domElement.height);
    }

    getBufferSize(frag_src, name) {
        const size_exp = new RegExp(`uniform\\s*sampler2D\\s*${name}\\;\\s*\\/\\/*\\s(\\d+)x(\\d+)`, 'gm');
        const size_found = size_exp.exec(frag_src);
        if (size_found)
            return { width: parseInt(size_found[1]), height: parseInt(size_found[2]) };

        const scale_exp = new RegExp(`uniform\\s*sampler2D\\s*${name}\\;\\s*\\/\\/*\\s(\\d*\\.\\d+|\\d+)`, 'gm');
        const scale_found = scale_exp.exec(frag_src);
        if (scale_found) {
            if (scale_found.length > 2)
                return { width: parseFloat(scale_found[1]), height: parseFloat(scale_found[2]) };
            else if (scale_found.length > 1)
                return { width: parseFloat(scale_found[1]), height: parseFloat(scale_found[1]) };
        }

        return { width: 1.0, height: 1.0 };
    }

    load(frag_src) {
        const found_background = frag_src.match(/(?:^\s*)((?:#if|#elif)(?:\s*)(defined\s*\(\s*BACKGROUND)(?:\s*\))|(?:#ifdef)(?:\s*BACKGROUND)(?:\s*))/gm);
        if (found_background) {
            this.renderer.autoClearColor = false;
            this.addBackground(frag_src);
        }

        const found_buffers = frag_src.match(/(?:^\s*)((?:#if|#elif)(?:\s*)(defined\s*\(\s*BUFFER_)(\d+)(?:\s*\))|(?:#ifdef)(?:\s*BUFFER_)(\d+)(?:\s*))/gm);
        if (found_buffers)
            for (let i = 0; i < found_buffers.length; i++) {
                let s = this.getBufferSize(frag_src, `u_buffer${i}`);
                this.addBuffer(frag_src, s.width, s.height);
            }

        const found_doubleBuffers = frag_src.match(/(?:^\s*)((?:#if|#elif)(?:\s*)(defined\s*\(\s*DOUBLE_BUFFER_)(\d+)(?:\s*\))|(?:#ifdef)(?:\s*DOUBLE_BUFFER_)(\d+)(?:\s*))/gm);
        if (found_doubleBuffers) {
            this.renderer.autoClearColor = false;
            for (let i = 0; i < found_doubleBuffers.length; i++) {
                let s = this.getBufferSize(frag_src, `u_doubleBuffer${i}`);
                // console.log(s);
                this.addDoubleBuffer(frag_src, s.width, s.height);
            }
        }

        this.main = createShaderMaterial(frag_src);

        const found_postprocessing = frag_src.match(/(?:^\s*)((?:#if|#elif)(?:\s*)(defined\s*\(\s*POSTPROCESSING)(?:\s*\))|(?:#ifdef)(?:\s*POSTPROCESSING)(?:\s*))/gm);
        if (found_postprocessing)
            this.addPostprocessing(frag_src);
    }

    addBackground(frag_src) {
        this.background = createShaderMaterial(`#define BACKGROUND\n${frag_src}`);
        this.background.defines = this.defines;
        return this.background;
    }

    addBuffer(frag_src, width, height) {
        let index = this.buffers.length;
        let material = createShaderMaterial(`#define BUFFER_${index}\n${frag_src}`);
        material.defines = this.defines;
        let b = {
            name: `u_buffer${index}`,
            material: material,
            renderTarget: null,
            width: width,
            height: height,
            wrapS: RepeatWrapping,
            wrapT: RepeatWrapping,
            minFilter: LinearFilter,
            magFilter: LinearFilter
        };

        this.buffers.push(b);
        this.uniforms[b.name] = { value: null };

        b.renderTarget = this.createRenderTarget(b);

        return b;
    }

    addDoubleBuffer(frag_src, width, height) {
        let index = this.doubleBuffers.length;
        let material = createShaderMaterial(`#define DOUBLE_BUFFER_${index}\n${frag_src}`);
        material.defines = this.defines;
        let db = {
            name: `u_doubleBuffer${index}`,
            material: material,
            renderTargets: [],
            width: width,
            height: height,
            wrapS: RepeatWrapping,
            wrapT: RepeatWrapping,
            minFilter: LinearFilter,
            magFilter: LinearFilter
        };

        this.doubleBuffers.push(db);
        this.uniforms[db.name] = { value: null };

        db.renderTargets[0] = this.createRenderTarget(db);
        db.renderTargets[1] = this.createRenderTarget(db);

        return db;
    }

    addPostprocessing(frag_src) {
        this.postprocessing = createShaderMaterial(`#define POSTPROCESSING\n${frag_src}`);
        this.postprocessing.defines = this.defines;

        this.sceneBuffer = {
            renderTarget: null,
            width: this.renderer.domElement.width,
            height: this.renderer.domElement.height,
        };

        this.uniforms["u_scene"] = { value: null };

        this.sceneBuffer.renderTarget = this.createRenderTarget({
            width: this.sceneBuffer.width,
            height: this.sceneBuffer.height,
            wrapS: null,
            wrapT: null,
            minFilter: LinearFilter,
            magFilter: LinearFilter
        });

        return this.sceneBuffer;
    }

    createRenderTarget(b) {
        b.wrapS = b.wrapS || ClampToEdgeWrapping;
        b.wrapT = b.wrapT || ClampToEdgeWrapping;

        b.minFilter = b.minFilter || NearestFilter;
        b.magFilter = b.magFilter || NearestFilter;

        let type = FloatType;

        if (this.renderer.capabilities.isWebGL2 === false)
            type = HalfFloatType;

        let w = b.width;
        let h = b.height;

        if (w <= 1.0 && h <= 1.0) {
            w *= this.renderer.domElement.width;
            h *= this.renderer.domElement.height;
        }

        let renderTarget = new WebGLRenderTarget(Math.floor(w), Math.floor(h), {
            wrapS: b.wrapS,
            wrapT: b.wrapT,
            minFilter: b.minFilter,
            magFilter: b.magFilter,
            format: RGBAFormat,
            type: (/(iPad|iPhone|iPod)/g.test(navigator.userAgent)) ? HalfFloatType : type,
            stencilBuffer: false
        });

        return renderTarget;
    }

    updateUniforms() {
        this.time = this.clock.getElapsedTime();

        this.uniforms.u_time.value = this.time;
        this.uniforms.u_delta.value = this.time - this.lastTime;
        this.uniforms.u_frame.value = this.frame;

        this.lastTime = this.time;
        this.frame++;
    }

    updateBuffers() {
        // Buffers
        for (let i = 0, il = this.buffers.length; i < il; i++) {
            let b = this.buffers[i];
            if (db.width <= 1.0 && db.height <= 1.0)
                this.uniforms["u_resolution"].value = new Vector2(Math.floor(this.resolution.x * b.width), Math.floor(this.resolution.y * b.height));
            else
                this.uniforms["u_resolution"].value = new Vector2(b.width, b.height);

            this.renderTarget(b.material, b.renderTarget);
            this.uniforms[b.name].value = b.renderTarget.texture;
        }

        // Double buffers
        let currentTextureIndex = this.currentTextureIndex;
        let nextTextureIndex = this.currentTextureIndex === 0 ? 1 : 0;
        for (let i = 0, il = this.doubleBuffers.length; i < il; i++) {
            let db = this.doubleBuffers[i];
            if (db.width <= 1.0 && db.height <= 1.0)
                this.uniforms["u_resolution"].value = new Vector2(Math.floor(this.resolution.x * db.width), Math.floor(this.resolution.y * db.height));
            else
                this.uniforms["u_resolution"].value = new Vector2(db.width, db.height);

            this.uniforms[db.name].value = db.renderTargets[currentTextureIndex].texture;

            this.renderTarget(db.material, db.renderTargets[nextTextureIndex]);
            this.uniforms[db.name].value = db.renderTargets[nextTextureIndex].texture;
        }

        this.currentTextureIndex = nextTextureIndex;
        this.renderer.setRenderTarget(null);
    };

    renderBackground() {
        if (this.background) {
            this.mesh.material = this.background;
            this.renderer.render(this.billboard_scene, this.billboard_camera);
            this.mesh.material = this.passThruShader;
        }
    }

    getBufferTexture(index) {
        if (index >= this.buffers.length)
            return;

        return this.buffers[index].renderTarget.texture;
    }

    getDoubleBufferTexture(index) {
        if (index >= this.doubleBuffers.length)
            return;

        return this.doubleBuffers[index].renderTargets[this.currentTextureIndex].texture;
    }

    renderBuffer(index) {
        if (index >= this.buffers.length)
            return;

        this.uniforms["u_resolution"].value = this.resolution;
        this.passThruUniforms.texture.value = this.geBufferTexture(index);
        this.mesh.material = this.passThruShader;
        this.renderer.render(this.billboard_scene, this.billboard_camera);
    }

    renderDoubleBuffer(index) {
        if (index >= this.doubleBuffers.length)
            return;

        this.uniforms["u_resolution"].value = this.resolution;
        this.passThruUniforms.texture.value = this.getDoubleBufferTexture(index);
        this.mesh.material = this.passThruShader;
        this.renderer.render(this.billboard_scene, this.billboard_camera);
    }

    renderMain() {
        this.updateUniforms();

        this.updateBuffers();

        this.uniforms["u_resolution"].value = this.resolution;

        this.mesh.material = this.main;
        this.renderer.render(this.billboard_scene, this.billboard_camera);
        this.mesh.material = this.passThruShader;
    }

    renderScene(scene, camera) {
        this.updateUniforms();

        this.updateBuffers();

        this.uniforms["u_resolution"].value = this.resolution;

        if (this.sceneBuffer) {
            this.renderer.setRenderTarget(this.sceneBuffer.renderTarget);
            this.renderer.clear();
        }

        this.renderBackground();
        this.renderer.render(scene, camera);

        if (this.sceneBuffer) {
            this.renderer.setRenderTarget(null);
            this.renderer.clear();

            this.uniforms["u_resolution"].value = this.resolution;
            this.uniforms["u_scene"].value = this.sceneBuffer.renderTarget.texture;
            this.mesh.material = this.postprocessing;
            this.renderer.render(this.billboard_scene, this.billboard_camera);
            this.mesh.material = this.passThruShader;
        }
    }

    renderTarget(material, output) {
        this.mesh.material = material;
        this.renderer.setRenderTarget(output);
        this.renderer.clear();
        this.renderer.render(this.billboard_scene, this.billboard_camera, output);
        this.mesh.material = this.passThruShader;
    }

    setSize(width, height) {
        if (this.sceneBuffer) {
            this.sceneBuffer.width = width;
            this.sceneBuffer.height = height;
            this.sceneBuffer.renderTarget.setSize(width, height);
        }

        this.resolution = new Vector2(width, height);
        this.uniforms["u_resolution"].value = this.resolution;

        for (let i = 0; i < this.buffers.length; i++) {
            let b = this.buffers[i];
            if (b.width <= 1.0 && b.height <= 1.0)
                b.renderTarget.setSize(b.width * width, b.height * height);
        }

        for (let i = 0; i < this.doubleBuffers.length; i++) {
            this.renderer.autoClearColor = false;
            let db = this.doubleBuffers[i];
            if (db.width <= 1.0 && db.height <= 1.0) {
                let w = Math.floor(db.width * width);
                let h = Math.floor(db.height * height);
                db.renderTargets[0].setSize(w, h);
                db.renderTargets[1].setSize(w, h);
            }
        }
    }
}

function createShaderMaterial(computeFragmentShader, uniforms) {
    let material = new ShaderMaterial({
        uniforms: uniforms === undefined ? {} : uniforms,
        vertexShader: getPassThroughVertexShader(),
        fragmentShader: computeFragmentShader
    });
    return material;
}

function getPassThroughVertexShader() {
    return  /* glsl */`varying vec2 v_texcoord;
    void main() {
        v_texcoord = uv;
        gl_Position = vec4(position, 1.0);
    }`;
}

function getPassThroughFragmentShader() {
    return  /* glsl */`uniform sampler2D texture;
    uniform vec2 u_resolution;
    void main() {
        vec2 uv = gl_FragCoord.xy / u_resolution.xy;
        gl_FragColor = texture2D( texture, uv );
    }`;
}

export { GlslSandbox };