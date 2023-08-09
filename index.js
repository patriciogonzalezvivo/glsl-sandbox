module.exports = GlslSandbox

function GlslSandbox( renderer, uniforms = {}) {
    if (typeof global.THREE === 'undefined') {
        throw new TypeError('You must have THREE in global scope for this module.')
    }
    
    if (!renderer.extensions.get( "OES_texture_float" ) )
        return "No OES_texture_float support for float textures.";
    
    renderer.extensions.get("WEBGL_color_buffer_float");

    this.defines = {};
    this.uniforms = uniforms;
    this.uniforms.u_resolution = { type: "v2", value: new THREE.Vector2() };
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

    var billboard_scene = new global.THREE.Scene();
    var billboard_camera = new global.THREE.Camera();
    billboard_camera.position.z = 1;
    var passThruUniforms = { texture: { value: null } };
    var passThruShader = createShaderMaterial( getPassThroughFragmentShader(), passThruUniforms );

    var mesh = new global.THREE.Mesh( new global.THREE.PlaneBufferGeometry( 2, 2 ), passThruShader );
    billboard_scene.add( mesh );

    var clock = new THREE.Clock();
    var frame = 0;
    var lastTime = 0.0;
    var time = 0.0;
    let resolution = new global.THREE.Vector2(renderer.domElement.width, renderer.domElement.height);

    this.getBufferSize = function( frag_src, name ) {
        const size_exp = new RegExp(`uniform\\s*sampler2D\\s*${name}\\;\\s*\\/\\/*\\s(\\d+)x(\\d+)`, 'gm');
        const size_found = size_exp.exec(frag_src);
        if (size_found) {
            // console.log("Found size:", size_found);
            return {width: parseInt(size_found[1]), height: parseInt(size_found[2]) };
        }
        // return {width: 32.0, height: 32.0};
        
        const scale_exp = new RegExp(`uniform\\s*sampler2D\\s*${name}\\;\\s*\\/\\/*\\s(\\d*\\.\\d+|\\d+)`, 'gm');
        const scale_found = scale_exp.exec(frag_src);
        if (scale_found) {
         console.log("Found scale:", scale_found);
         if (scale_found.length > 2) {
             return {width: parseFloat(scale_found[1]), height: parseFloat(scale_found[2]) };
         }
         else if (scale_found.length > 1) {
             return {width: parseFloat(scale_found[1]), height: parseFloat(scale_found[1]) };
         }
        }

        return {width: 1.0, height: 1.0};
    }

    this.load = function( frag_src ) {
        const found_background = frag_src.match(/(?:^\s*)((?:#if|#elif)(?:\s*)(defined\s*\(\s*BACKGROUND)(?:\s*\))|(?:#ifdef)(?:\s*BACKGROUND)(?:\s*))/gm);
        // console.log("background:", found_background );
        if (found_background) {
            renderer.autoClearColor = false;
            this.addBackground(frag_src);
        }

        const found_buffers = frag_src.match(/(?:^\s*)((?:#if|#elif)(?:\s*)(defined\s*\(\s*BUFFER_)(\d+)(?:\s*\))|(?:#ifdef)(?:\s*BUFFER_)(\d+)(?:\s*))/gm);
        // console.log("buffers:", found_buffers );
        if (found_buffers)
            for (let i = 0; i < found_buffers.length; i++) {
                let s = this.getBufferSize( frag_src, `u_buffer${i}` );
                this.addBuffer(frag_src, s.width, s.height );
            }
        
        const found_doubleBuffers = frag_src.match(/(?:^\s*)((?:#if|#elif)(?:\s*)(defined\s*\(\s*DOUBLE_BUFFER_)(\d+)(?:\s*\))|(?:#ifdef)(?:\s*DOUBLE_BUFFER_)(\d+)(?:\s*))/gm);
        // console.log("doubleBuffers:", found_doubleBuffers );
        if (found_doubleBuffers) {
            renderer.autoClearColor = false;
            for (let i = 0; i < found_doubleBuffers.length; i++) {
                let s = this.getBufferSize( frag_src, `u_doubleBuffer${i}` );
                this.addDoubleBuffer(frag_src, s.width, s.height );
            }
        }

        // this.main = createShaderMaterial(frag_src);

        const found_postprocessing = frag_src.match(/(?:^\s*)((?:#if|#elif)(?:\s*)(defined\s*\(\s*POSTPROCESSING)(?:\s*\))|(?:#ifdef)(?:\s*POSTPROCESSING)(?:\s*))/gm);
        // console.log("postprocessing:", found_postprocessing );
        if (found_postprocessing)
            this.addPostprocessing(frag_src);
    }

    this.addBackground = function( frag_src ) {
        this.background = createShaderMaterial(`#define BACKGROUND\n${frag_src}`);
        this.background.defines = this.defines;
        return this.background;
    };

    this.addBuffer = function( frag_src, width, height, initialValueTexture ) {
        let index = this.buffers.length;
        var material = createShaderMaterial(`#define BUFFER_${index}\n${frag_src}`);
        material.defines = this.defines;
        var b = {
            name: `u_buffer${index}`,
            initialValueTexture: initialValueTexture,
            material: material,
            renderTarget: null,
            wrapS: null,
            wrapT: null,
            width: width,
            height: height,
            minFilter: global.THREE.LinearFilter,
            magFilter: global.THREE.LinearFilter
        };

        this.buffers.push( b );
        this.uniforms[ b.name ] = { type: 't', value: null };

        b.renderTarget = this.createRenderTarget( b );

        if ( initialValueTexture ) {
            this.renderTexture( b.initialValueTexture, b.renderTarget);
            this.uniforms[ b.name ].value = b.renderTarget.texture;
        }

        return b;
    };

    this.addDoubleBuffer = function( frag_src, width, height, initialValueTexture ) {
        let index = this.doubleBuffers.length;
        var material = createShaderMaterial(`#define DOUBLE_BUFFER_${index}\n${frag_src}`);
        material.defines = this.defines;
        var db = {
            name: `u_doubleBuffer${index}`,
            initialValueTexture: initialValueTexture,
            material: material,
            renderTargets: [],
            wrapS: null,
            wrapT: null,
            width: width,
            height: height,
            minFilter: global.THREE.LinearFilter,
            magFilter: global.THREE.LinearFilter
        };

        this.doubleBuffers.push( db );
        this.uniforms[ db.name ] = { type: 't', value: null };

        db.renderTargets[ 0 ] = this.createRenderTarget( db );
        db.renderTargets[ 1 ] = this.createRenderTarget( db );

        if ( initialValueTexture ) {
            this.renderTexture( db.initialValueTexture, db.renderTargets[ 0 ] );
            this.renderTexture( db.initialValueTexture, db.renderTargets[ 1 ] );
            this.uniforms[ db.name ].value = db.renderTargets[ 0 ].texture;
        }

        return db;
    };

    this.addPostprocessing = function( frag_src ) {
        this.sceneBuffer = {
            renderTarget: null,
            wrapS: null,
            wrapT: null,
            width: renderer.domElement.width,
            height: renderer.domElement.height,
            minFilter: global.THREE.LinearFilter,
            magFilter: global.THREE.LinearFilter
        };
        
        this.uniforms[ "u_scene" ] = { type: 't',  value: null };
        this.sceneBuffer.renderTarget = this.createRenderTarget( this.sceneBuffer );
        this.postprocessing = createShaderMaterial(`#define POSTPROCESSING\n${frag_src}`);
        this.postprocessing.defines = this.defines;
        return this.postprocessing;
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
            this.uniforms[ "u_resolution" ].value = new global.THREE.Vector2( b.width, b.height );

            this.doRenderTarget( b.material, b.renderTarget );
            this.uniforms[ b.name ].value = b.renderTarget.texture;
        }

        // Double buffers
        var currentTextureIndex = this.currentTextureIndex;
        var nextTextureIndex = this.currentTextureIndex === 0 ? 1 : 0;
        for ( var i = 0, il = this.doubleBuffers.length; i < il; i++ ) {
            var db = this.doubleBuffers[ i ];
            this.uniforms[ "u_resolution" ].value = new global.THREE.Vector2( db.width, db.height );
            this.uniforms[ db.name ].value = db.renderTargets[ currentTextureIndex ].texture;

            this.doRenderTarget( db.material, db.renderTargets[ nextTextureIndex ] );
            this.uniforms[ db.name ].value = db.renderTargets[ nextTextureIndex ].texture;
        }
        
        this.currentTextureIndex = nextTextureIndex;
        renderer.setRenderTarget(null);
    };

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
            
            this.uniforms[ "u_scene" ].value = this.sceneBuffer.renderTarget.texture;
            mesh.material = this.postprocessing;
            renderer.render( billboard_scene, billboard_camera );
            mesh.material = passThruShader;
        }
    }


    this.setSize = function(width, height) {
        if (this.sceneBuffer) {
            this.sceneBuffer.width = width;
            this.sceneBuffer.height = height;
            this.sceneBuffer.renderTarget.setSize(width, height);
        }

        resolution = new global.THREE.Vector2( width, height );

        for ( var i = 0; i < this.buffers.length; i++ ) {
            var b = this.buffers[ i ];
            if (b.width <= 1.0 && b.height <= 1.0)
                b.renderTarget.setSize(b.width * width, b.height * height);
        }

        for (var i = 0; i < this.doubleBuffers.length; i++) {
            var db = this.doubleBuffers[ i ];
            if (db.width <= 1.0 && db.height <= 1.0) {
                db.renderTargets[ 0 ].setSize(db.width * width, db.height * height);
                db.renderTargets[ 1 ].setSize(db.width * width, db.height * height);
            }
        }
    }

    this.getBufferTexture = function( index ) {
        return this.buffers[index].renderTargets[0].texture;
    };

    this.getDoubleBufferTexture = function( index ) {
        return this.doubleBuffers[index].renderTargets[ this.currentTextureIndex ].texture;
    };

    function createShaderMaterial( computeFragmentShader ) {
        var material = new global.THREE.ShaderMaterial( {
            uniforms: uniforms,
            vertexShader: getPassThroughVertexShader(),
            fragmentShader: computeFragmentShader
        } );
        return material;
    };
    // this.createShaderMaterial = createShaderMaterial;

    this.createRenderTarget = function( b ) {
        b.wrapS = b.wrapS || global.THREE.ClampToEdgeWrapping;
        b.wrapT = b.wrapT || global.THREE.ClampToEdgeWrapping;

        b.minFilter = b.minFilter || global.THREE.LinearFilter;
        b.magFilter = b.magFilter || global.THREE.LinearFilter;

        let type = global.THREE.FloatType;

        if ( renderer.capabilities.isWebGL2 === false )
            type = global.THREE.HalfFloatType;

        var renderTarget = new global.THREE.WebGLRenderTarget( b.width, b.height, {
            wrapS: b.wrapS,
            wrapT: b.wrapT,
            minFilter: b.minFilter,
            magFilter: b.magFilter,
            format: global.THREE.RGBAFormat,
            type: ( /(iPad|iPhone|iPod)/g.test( navigator.userAgent ) ) ? global.THREE.HalfFloatType : type,
            stencilBuffer: false
        } );
        return renderTarget;
    };

    this.createTexture = function( sizeXTexture, sizeYTexture ) {
        var a = new Float32Array( sizeXTexture * sizeYTexture * 4 );
        var texture = new global.THREE.DataTexture( a, sizeXTexture, sizeYTexture, global.THREE.RGBAFormat, global.THREE.FloatType );
        texture.needsUpdate = true;
        return texture;
    };

    this.renderBackground = function() {
        if (this.background) {
            mesh.material = this.background;
            renderer.render( billboard_scene, billboard_camera );
            mesh.material = passThruShader;
        }
    };

    this.renderTexture = function( input, output ) {
        passThruUniforms.texture.value = input;
        this.doRenderTarget( passThruShader, output);
        passThruUniforms.texture.value = null;
    };

    this.doRenderTarget = function( material, output ) {
        mesh.material = material;
        renderer.setRenderTarget(output);
        renderer.clear();
        renderer.render( billboard_scene, billboard_camera, output );
        mesh.material = passThruShader;
    };

    function getPassThroughVertexShader() {
        return  `varying vec2 v_texcoord;
void main() {
    v_texcoord = uv;
    gl_Position = vec4(position, 1.0);
}`;
    }

    function getPassThroughFragmentShader() {
        return  `uniform sampler2D texture;
uniform vec2 u_resolution;
void main() {
vec2 uv = gl_FragCoord.xy / u_resolution.xy;
gl_FragColor = texture2D( texture, uv );
}`;
    }

}