export interface FieldSurface { texture: WebGLTexture; framebuffer: WebGLFramebuffer }
export function disposeFieldSurface(gl: WebGL2RenderingContext, surface: FieldSurface) {
  gl.deleteFramebuffer(surface.framebuffer); gl.deleteTexture(surface.texture);
}
export function createFieldSurface(gl: WebGL2RenderingContext, width: number, height: number): FieldSurface {
  const texture = gl.createTexture(), framebuffer = gl.createFramebuffer();
  try {
    if (!texture || !framebuffer) throw Error('Не удалось выделить кэш поля.');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw Error('Кэш поля недоступен.');
    return { texture, framebuffer };
  } catch (error) {
    if (texture) gl.deleteTexture(texture); if (framebuffer) gl.deleteFramebuffer(framebuffer); throw error;
  } finally { gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
}
