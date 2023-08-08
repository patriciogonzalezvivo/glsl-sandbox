global.THREE = require('three')

var GlslSandbox = require('./')

var dpr = window.devicePixelRatio
var width = window.innerWidth;
var height = window.innerHeight;
var canvas = document.createElement('canvas')
canvas.width = width * dpr
canvas.height = height * dpr
canvas.style.width = width + 'px'
canvas.style.height = height + 'px'
document.body.appendChild(canvas)

var renderer = new THREE.WebGLRenderer({
  antialias: false,
  canvas: canvas
})

