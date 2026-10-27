import { fieldBytes } from '../../domain/renderLimits';
export class WebGLResources {
  texture: WebGLTexture | null = null;
  framebuffer: WebGLFramebuffer | null = null;
  backTexture: WebGLTexture | null = null;
  backFramebuffer: WebGLFramebuffer | null = null;
  instructionTexture: WebGLTexture | null = null;
  vao: WebGLVertexArrayObject | null = null;
  frontSize = { width: 0, height: 0 };
  backSize = { width: 0, height: 0 };
  instructionBytes = 0;
  scratchBytes = 0;
  constructor(readonly gl: WebGL2RenderingContext) { this.initialize(); }
  initialize() {
    const gl = this.gl;
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    gl.disable(gl.DITHER); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    this.texture = gl.createTexture(); this.framebuffer = gl.createFramebuffer();
    this.backTexture = gl.createTexture(); this.backFramebuffer = gl.createFramebuffer();
    this.instructionTexture = gl.createTexture();
    if (!this.instructionTexture) throw new Error('Не удалось выделить память программы binary64.');
    gl.bindTexture(gl.TEXTURE_2D,this.instructionTexture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    if (!this.texture || !this.framebuffer || !this.backTexture || !this.backFramebuffer || !this.vao) throw new Error('Не удалось выделить ресурсы WebGL2.');
    for (const texture of [this.texture, this.backTexture]) {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.backFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.backTexture, 0);
    this.frontSize = { width: 0, height: 0 }; this.backSize = { width: 0, height: 0 }; this.instructionBytes = 0;
  }
  allocate(back: boolean, width: number, height: number) {
    const size = back ? this.backSize : this.frontSize;
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, back ? this.backFramebuffer : this.framebuffer);
    if (size.width === width && size.height === height) return;
    gl.bindTexture(gl.TEXTURE_2D, back ? this.backTexture : this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Видеоустройство не смогло создать буфер изображения.');
    if (back) this.backSize = { width, height }; else this.frontSize = { width, height };
  }

  estimate() { return { fieldBytes: fieldBytes(this.frontSize.width,this.frontSize.height)+fieldBytes(this.backSize.width,this.backSize.height), instructionBytes: this.instructionBytes, scratchBytes:this.scratchBytes }; }
  swap() { [this.texture,this.backTexture]=[this.backTexture,this.texture];[this.framebuffer,this.backFramebuffer]=[this.backFramebuffer,this.framebuffer];[this.frontSize,this.backSize]=[this.backSize,this.frontSize]; }
  dispose() { const gl=this.gl;gl.deleteTexture(this.texture);gl.deleteTexture(this.backTexture);gl.deleteTexture(this.instructionTexture);gl.deleteFramebuffer(this.framebuffer);gl.deleteFramebuffer(this.backFramebuffer);gl.deleteVertexArray(this.vao);this.frontSize={width:0,height:0};this.backSize={width:0,height:0};this.instructionBytes=0; }
}
