export function GlslSandbox( renderer, uniforms = {}) {

    if ( !renderer.extensions.get( "OES_texture_float" ) )
        return "No OES_texture_float support for float textures.";

    this.defines = {};
    this.uniforms = uniforms;
    this.currentTextureIndex = 0;

    this.buffers = [];
    this.doubleBuffers = [];
    this.background = null;
    this.main = null;
    this.sceneBuffer = null;
    this.postprocessing = null;

    var billboard_scene = new THREE.Scene();
    var billboard_camera = new THREE.Camera();
    billboard_camera.position.z = 1;
    var passThruUniforms = { texture: { value: null } };
    var passThruShader = createShaderMaterial( getPassThroughFragmentShader(), passThruUniforms );

    var mesh = new THREE.Mesh( new THREE.PlaneBufferGeometry( 2, 2 ), passThruShader );
    billboard_scene.add( mesh );

    this.getBufferSize = function( frag_src, name ) {
        const size_exp = new RegExp(`uniform\\s*sampler2D\\s*${name}\\;\\s*\\/\\/*\\s(\\d+)x(\\d+)`, 'gm');
        const size_found = size_exp.exec(frag_src);
        if (size_found) {
            // console.log("Found size:", size_found);
            return {width: parseInt(size_found[1]), height: parseInt(size_found[2]) };
        }
        return {width: 32.0, height: 32.0};
        
        // const scale_exp = new RegExp(`uniform\\s*sampler2D\\s*${name}\\;\\s*\\/\\/*\\s(\\d*\\.\\d+|\\d+))`, 'gm');
        // const scale_found = scale_exp.exec(frag_src);
        // if (scale_found) {
        //  console.log("Found scale:", scale_found);
        //  if (scale_found.length > 2) {
        //      return {width: parseFloat(scale_found[1]), height: parseFloat(scale_found[2]) };
        //  }
        //  else if (scale_found.length > 1) {
        //      return {width: parseFloat(scale_found[1]), height: parseFloat(scale_found[1]) };
        //  }
        // }

        // return {width: 1.0, height: 1.0};
    }

    this.load = function( frag_src ) {
        const found_background = frag_src.match(/(?:^\s*)((?:#if|#elif)(?:\s*)(defined\s*\(\s*BACKGROUND)(?:\s*\))|(?:#ifdef)(?:\s*BACKGROUND)(?:\s*))/gm);
        // console.log("background:", found_background );
        if (found_background)
            this.addBackground(frag_src);

        const found_buffers = frag_src.match(/(?:^\s*)((?:#if|#elif)(?:\s*)(defined\s*\(\s*BUFFER_)(\d+)(?:\s*\))|(?:#ifdef)(?:\s*BUFFER_)(\d+)(?:\s*))/gm);
        // console.log("buffers:", found_buffers );
        for (let i = 0; i < found_buffers.length; i++) {
            let s = this.getBufferSize( frag_src, `u_buffer${i}` );
            this.addBuffer(frag_src, s.width, s.height );
        }
        
        const found_doubleBuffers = frag_src.match(/(?:^\s*)((?:#if|#elif)(?:\s*)(defined\s*\(\s*DOUBLE_BUFFER_)(\d+)(?:\s*\))|(?:#ifdef)(?:\s*DOUBLE_BUFFER_)(\d+)(?:\s*))/gm);
        // console.log("doubleBuffers:", found_doubleBuffers );
        for (let i = 0; i < found_doubleBuffers.length; i++) {
            let s = this.getBufferSize( frag_src, `u_doubleBuffer${i}` );
            this.addDoubleBuffer(frag_src, s.width, s.height );
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
            renderTargets: [],
            wrapS: null,
            wrapT: null,
            width: width,
            height: height,
            minFilter: THREE.LinnearFilter,
            magFilter: THREE.LinnearFilter
        };

        this.buffers.push( b );
        this.uniforms[ b.name ] = { value: null };

        b.renderTargets[ 0 ] = this.createRenderTarget( b );

        if ( initialValueTexture ) {
            this.renderTexture( b.initialValueTexture, b.renderTargets[ 0 ] );
            this.uniforms[ b.name ].value = b.renderTargets[ 0 ].texture;
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
            minFilter: THREE.LinnearFilter,
            magFilter: THREE.LinnearFilter
        };

        this.doubleBuffers.push( db );
        this.uniforms[ db.name ] = { value: null };

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
            renderTargets: null,
            wrapS: null,
            wrapT: null,
            width: renderer.domElement.width,
            height: renderer.domElement.height,
            minFilter: THREE.LinnearFilter,
            magFilter: THREE.LinnearFilter
        };
        this.sceneBuffer.renderTargets = this.createRenderTarget( this.sceneBuffer );
        this.uniforms[ "u_scene" ] = { value: this.sceneBuffer.renderTargets.texture };
        this.postprocessing = createShaderMaterial(`#define POSTPROCESSING\n${frag_src}`);
        this.postprocessing.defines = this.defines;
        return this.postprocessing;
    };

    this.update = function() {

        // Buffers
        for ( var i = 0, il = this.buffers.length; i < il; i++ ) {
            var b = this.buffers[ i ];
            this.uniforms[ "u_resolution" ].value = new THREE.Vector2( b.width, b.height );

            this.doRenderTarget( b.material, b.renderTargets[ 0 ] );
            this.uniforms[ b.name ].value = b.renderTargets[ 0 ].texture;
        }

        // Double buffers
        var currentTextureIndex = this.currentTextureIndex;
        var nextTextureIndex = this.currentTextureIndex === 0 ? 1 : 0;
        for ( var i = 0, il = this.doubleBuffers.length; i < il; i++ ) {
            var db = this.doubleBuffers[ i ];
            this.uniforms[ "u_resolution" ].value = new THREE.Vector2( db.width, db.height );
            this.uniforms[ db.name ].value = db.renderTargets[ currentTextureIndex ].texture;

            this.doRenderTarget( db.material, db.renderTargets[ nextTextureIndex ] );
            this.uniforms[ db.name ].value = db.renderTargets[ nextTextureIndex ].texture;
        }
        
        this.currentTextureIndex = nextTextureIndex;
        renderer.setRenderTarget(null);
    };

    this.renderScene = function(scene, camera) {
        this.update();

        this.uniforms[ "u_resolution" ].value = new THREE.Vector2( this.sceneBuffer.width, this.sceneBuffer.height );
        
        if (this.sceneBuffer) {
            renderer.setRenderTarget(this.sceneBuffer.renderTargets);
            renderer.clear();
        }
        
        this.renderBackground();
        renderer.render( scene, camera );

        if (this.sceneBuffer) {
         renderer.setRenderTarget(null);
            
         this.uniforms[ "u_scene" ] = { value: this.sceneBuffer.renderTargets.texture };

         mesh.material = this.postprocessing;
         renderer.render( billboard_scene, billboard_camera );
         mesh.material = passThruShader;
        }
    }


    this.setSize = function(width, height) {
        if (this.sceneBuffer) {
            this.sceneBuffer.width = width;
            this.sceneBuffer.height = height;
            this.sceneBuffer.renderTargets.setSize(width, height);
        }

        for ( var i = 0; i < this.buffers.length; i++ ) {
            var b = this.buffers[ i ];
            if (b.width <= 1.0 && b.height <= 1.0)
                b.renderTargets[ 0 ].setSize(b.width * width, b.height * height);
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
        var material = new THREE.ShaderMaterial( {
            uniforms: uniforms,
            vertexShader: getPassThroughVertexShader(),
            fragmentShader: computeFragmentShader
        } );
        return material;
    };
    // this.createShaderMaterial = createShaderMaterial;

    this.createRenderTarget = function( b ) {
        b.wrapS = b.wrapS || THREE.RepeatWrapping;
        b.wrapT = b.wrapT || THREE.RepeatWrapping;

        b.minFilter = b.minFilter || THREE.LinnearFilter;
        b.magFilter = b.magFilter || THREE.LinnearFilter;

        let type = THREE.FloatType;

        if ( renderer.capabilities.isWebGL2 === false )
            type = THREE.HalfFloatType;

        var renderTarget = new THREE.WebGLRenderTarget( b.width, b.height, {
            wrapS: b.wrapS,
            wrapT: b.wrapT,
            minFilter: b.minFilter,
            magFilter: b.magFilter,
            format: THREE.RGBAFormat,
            type: ( /(iPad|iPhone|iPod)/g.test( navigator.userAgent ) ) ? THREE.HalfFloatType : type,
            stencilBuffer: false
        } );
        return renderTarget;
    };

    this.createTexture = function( sizeXTexture, sizeYTexture ) {
        var a = new Float32Array( sizeXTexture * sizeYTexture * 4 );
        var texture = new THREE.DataTexture( a, sizeXTexture, sizeYTexture, THREE.RGBAFormat, THREE.FloatType );
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