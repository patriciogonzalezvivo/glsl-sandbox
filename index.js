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
} from 'three'

function GlslSandbox( renderer, uniforms = {} ) {    
    if (!renderer.capabilities.floatFragmentTextures )
        return "No OES_texture_float support for float textures.";
    
    this.defines = {};
    this.uniforms = uniforms;
    this.uniforms.u_resolution = { type: "v2", value: new Vector2() };
    this.uniforms.u_delta = { type: "f", value: 0.0 },
    this.uniforms.u_time = { type: "f", value: 0.0 },
    this.uniforms.u_frame = { type: 'int', value: 0 },
    this.currentTextureIndex = 0;

    this.buffers = [];
    this.doubleBuffers = [];
    this.background = null;
    this.main = null;
    this.sceneBuffer = null;
    this.postprocessing = null;

    var billboard_scene = new Scene();
    var billboard_camera = new Camera();
    billboard_camera.position.z = 1;
    var passThruUniforms = { texture: { value: null } };
    var passThruShader = createShaderMaterial( getPassThroughFragmentShader(), passThruUniforms );

    var mesh = new Mesh( new PlaneGeometry( 2, 2 ), passThruShader );
    billboard_scene.add( mesh );

    var clock = new Clock();
    var frame = 0;
    var lastTime = 0.0;
    var time = 0.0;
    let resolution = new Vector2(renderer.domElement.width, renderer.domElement.height);

    this.getBufferSize = function( frag_src, name ) {
        const size_exp = new RegExp(`uniform\\s*sampler2D\\s*${name}\\;\\s*\\/\\/*\\s(\\d+)x(\\d+)`, 'gm');
        const size_found = size_exp.exec(frag_src);
        if (size_found)
            return {width: parseInt(size_found[1]), height: parseInt(size_found[2]) };
        
        const scale_exp = new RegExp(`uniform\\s*sampler2D\\s*${name}\\;\\s*\\/\\/*\\s(\\d*\\.\\d+|\\d+)`, 'gm');
        const scale_found = scale_exp.exec(frag_src);
        if (scale_found) {
            if (scale_found.length > 2)
                return {width: parseFloat(scale_found[1]), height: parseFloat(scale_found[2]) };
            else if (scale_found.length > 1)
                return {width: parseFloat(scale_found[1]), height: parseFloat(scale_found[1]) };
        }

        return {width: 1.0, height: 1.0};
    };

    this.load = function( frag_src ) {
        const found_background = frag_src.match(/(?:^\s*)((?:#if|#elif)(?:\s*)(defined\s*\(\s*BACKGROUND)(?:\s*\))|(?:#ifdef)(?:\s*BACKGROUND)(?:\s*))/gm);
        if (found_background) {
            renderer.autoClearColor = false;
            this.addBackground(frag_src);
        }

        const found_buffers = frag_src.match(/(?:^\s*)((?:#if|#elif)(?:\s*)(defined\s*\(\s*BUFFER_)(\d+)(?:\s*\))|(?:#ifdef)(?:\s*BUFFER_)(\d+)(?:\s*))/gm);
        if (found_buffers)
            for (let i = 0; i < found_buffers.length; i++) {
                let s = this.getBufferSize( frag_src, `u_buffer${i}` );
                this.addBuffer(frag_src, s.width, s.height );
            }
        
        const found_doubleBuffers = frag_src.match(/(?:^\s*)((?:#if|#elif)(?:\s*)(defined\s*\(\s*DOUBLE_BUFFER_)(\d+)(?:\s*\))|(?:#ifdef)(?:\s*DOUBLE_BUFFER_)(\d+)(?:\s*))/gm);
        if (found_doubleBuffers) {
            renderer.autoClearColor = false;
            for (let i = 0; i < found_doubleBuffers.length; i++) {
                let s = this.getBufferSize( frag_src, `u_doubleBuffer${i}` );
                console.log(s);
                this.addDoubleBuffer(frag_src, s.width, s.height );
            }
        }

        this.main = createShaderMaterial(frag_src);

        const found_postprocessing = frag_src.match(/(?:^\s*)((?:#if|#elif)(?:\s*)(defined\s*\(\s*POSTPROCESSING)(?:\s*\))|(?:#ifdef)(?:\s*POSTPROCESSING)(?:\s*))/gm);
        if (found_postprocessing)
            this.addPostprocessing(frag_src);
    };

    this.addBackground = function( frag_src ) {
        this.background = createShaderMaterial(`#define BACKGROUND\n${frag_src}`);
        this.background.defines = this.defines;
        return this.background;
    };

    this.addBuffer = function( frag_src, width, height ) {
        let index = this.buffers.length;
        var material = createShaderMaterial(`#define BUFFER_${index}\n${frag_src}`);
        material.defines = this.defines;
        var b = {
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

        this.buffers.push( b );
        this.uniforms[ b.name ] = { type: 't', value: null };

        b.renderTarget = this.createRenderTarget( b );

        return b;
    };

    this.addDoubleBuffer = function( frag_src, width, height ) {
        let index = this.doubleBuffers.length;
        var material = createShaderMaterial(`#define DOUBLE_BUFFER_${index}\n${frag_src}`);
        material.defines = this.defines;
        var db = {
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

        this.doubleBuffers.push( db );
        this.uniforms[ db.name ] = { type: 't', value: null };

        db.renderTargets[ 0 ] = this.createRenderTarget( db );
        db.renderTargets[ 1 ] = this.createRenderTarget( db );

        return db;
    };

    this.addPostprocessing = function( frag_src ) {
        this.postprocessing = createShaderMaterial(`#define POSTPROCESSING\n${frag_src}`);
        this.postprocessing.defines = this.defines;

        this.sceneBuffer = {
            renderTarget: null,
            width: renderer.domElement.width,
            height: renderer.domElement.height,
        };
        
        this.uniforms[ "u_scene" ] = { type: 't',  value: null };

        this.sceneBuffer.renderTarget = this.createRenderTarget( {
            width: this.sceneBuffer.width,
            height: this.sceneBuffer.height,
            wrapS: null,
            wrapT: null,
            minFilter: LinearFilter,
            magFilter: LinearFilter
        } );

        return this.sceneBuffer;
    };

    function createShaderMaterial( computeFragmentShader ) {
        var material = new ShaderMaterial( {
            uniforms: uniforms,
            vertexShader: getPassThroughVertexShader(),
            fragmentShader: computeFragmentShader
        } );
        return material;
    };
    // this.createShaderMaterial = createShaderMaterial;

    this.createRenderTarget = function( b ) {
        b.wrapS = b.wrapS || ClampToEdgeWrapping;
        b.wrapT = b.wrapT || ClampToEdgeWrapping;

        b.minFilter = b.minFilter || NearestFilter;
        b.magFilter = b.magFilter || NearestFilter;

        let type = FloatType;

        if ( renderer.capabilities.isWebGL2 === false )
            type = HalfFloatType;

        var w = b.width;
        var h = b.height;

        if (w <= 1.0 && h <= 1.0) {
            w *= renderer.domElement.width;
            h *= renderer.domElement.height;
        }

        var renderTarget = new WebGLRenderTarget( Math.floor(w), Math.floor(h), {
            wrapS: b.wrapS,
            wrapT: b.wrapT,
            minFilter: b.minFilter,
            magFilter: b.magFilter,
            format: RGBAFormat,
            type: ( /(iPad|iPhone|iPod)/g.test( navigator.userAgent ) ) ? HalfFloatType : type,
            stencilBuffer: false
        } );
        return renderTarget;
    };

    this.updateUniforms = function() {
        time = clock.getElapsedTime();
    
        this.uniforms.u_time.value = time;
        this.uniforms.u_delta.value = time - lastTime;
        this.uniforms.u_frame.value = frame;

        lastTime = time;
        frame++;
    };

    this.updateBuffers = function() {
        // Buffers
        for ( var i = 0, il = this.buffers.length; i < il; i++ ) {
            var b = this.buffers[ i ];
            if (db.width <= 1.0 && db.height <= 1.0) 
                this.uniforms[ "u_resolution" ].value = new Vector2( Math.floor(resolution.x * b.width), Math.floor(resolution.y * b.height) );
            else
                this.uniforms[ "u_resolution" ].value = new Vector2( b.width, b.height );

            this.renderTarget( b.material, b.renderTarget );
            this.uniforms[ b.name ].value = b.renderTarget.texture;
        }

        // Double buffers
        var currentTextureIndex = this.currentTextureIndex;
        var nextTextureIndex = this.currentTextureIndex === 0 ? 1 : 0;
        for ( var i = 0, il = this.doubleBuffers.length; i < il; i++ ) {
            var db = this.doubleBuffers[ i ];
            if (db.width <= 1.0 && db.height <= 1.0) 
                this.uniforms[ "u_resolution" ].value = new Vector2( Math.floor(resolution.x * db.width), Math.floor(resolution.y * db.height) );
            else
                this.uniforms[ "u_resolution" ].value = new Vector2( db.width, db.height );

            this.uniforms[ db.name ].value = db.renderTargets[ currentTextureIndex ].texture;

            this.renderTarget( db.material, db.renderTargets[ nextTextureIndex ] );
            this.uniforms[ db.name ].value = db.renderTargets[ nextTextureIndex ].texture;
        }
        
        this.currentTextureIndex = nextTextureIndex;
        renderer.setRenderTarget(null);
    };

    this.renderBackground = function() {
        if (this.background) {
            mesh.material = this.background;
            renderer.render( billboard_scene, billboard_camera );
            mesh.material = passThruShader;
        }
    };

    this.getBufferTexture = function( index ) {
        if (index >= this.buffers.length)
            return;

        return this.buffers[index].renderTarget.texture;
    };

    this.getDoubleBufferTexture = function( index ) {
        if (index >= this.doubleBuffers.length)
            return;

        return this.doubleBuffers[index].renderTargets[ this.currentTextureIndex ].texture;
    };

    this.renderBuffer = function(index) {
        if (index >= this.buffers.length)
            return;

        this.uniforms[ "u_resolution" ].value = resolution;
        passThruUniforms.texture.value = this.geBufferTexture(index);
        mesh.material = passThruShader;
        renderer.render( billboard_scene, billboard_camera );
    }

    this.renderDoubleBuffer = function(index) {
        if (index >= this.doubleBuffers.length)
            return;

        this.uniforms[ "u_resolution" ].value = resolution;
        passThruUniforms.texture.value = this.getDoubleBufferTexture(index);
        mesh.material = passThruShader;
        renderer.render( billboard_scene, billboard_camera );
    }

    this.renderMain = function() {
        this.updateUniforms();

        this.updateBuffers();
        
        this.uniforms[ "u_resolution" ].value = resolution;

        mesh.material = this.main;
        renderer.render( billboard_scene, billboard_camera );
        mesh.material = passThruShader;
    }
  
    this.renderScene = function(scene, camera) {
        this.updateUniforms();

        this.updateBuffers();
        
        this.uniforms[ "u_resolution" ].value = resolution;

        if (this.sceneBuffer) {
            renderer.setRenderTarget(this.sceneBuffer.renderTarget);
            renderer.clear();
        }
        
        this.renderBackground();
        renderer.render( scene, camera );

        if (this.sceneBuffer) {
            renderer.setRenderTarget(null);
            renderer.clear();
            
            this.uniforms[ "u_resolution" ].value = resolution;
            this.uniforms[ "u_scene" ].value = this.sceneBuffer.renderTarget.texture;
            mesh.material = this.postprocessing;
            renderer.render( billboard_scene, billboard_camera );
            mesh.material = passThruShader;
        }
    };

    this.renderTarget = function( material, output ) {
        mesh.material = material;
        renderer.setRenderTarget(output);
        renderer.clear();
        renderer.render( billboard_scene, billboard_camera, output );
        mesh.material = passThruShader;
    };

    this.setSize = function( width, height ) {
        if (this.sceneBuffer) {
            this.sceneBuffer.width = width;
            this.sceneBuffer.height = height;
            this.sceneBuffer.renderTarget.setSize(width, height);
        }

        resolution = new Vector2( width, height );
        this.uniforms[ "u_resolution" ].value = resolution;

        for ( var i = 0; i < this.buffers.length; i++ ) {
            var b = this.buffers[ i ];
            if (b.width <= 1.0 && b.height <= 1.0)
                b.renderTarget.setSize(b.width * width, b.height * height);
        }

        for (var i = 0; i < this.doubleBuffers.length; i++) {
            renderer.autoClearColor = false;
            var db = this.doubleBuffers[ i ];
            if (db.width <= 1.0 && db.height <= 1.0) {
                var w = Math.floor(db.width * width);
                var h = Math.floor(db.height * height);
                db.renderTargets[ 0 ].setSize(w, h);
                db.renderTargets[ 1 ].setSize(w, h);
            }
        }
    };

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
}

export { GlslSandbox }