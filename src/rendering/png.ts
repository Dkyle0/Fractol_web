/** Converts an RGBA bottom-up readback. GPU allocation and readback stay in the backend. */
export async function encodePng(bytes: Uint8Array, width: number, height: number): Promise<Blob> {
  const output = document.createElement('canvas'); output.width = width; output.height = height;
  const context = output.getContext('2d');
  if (!context) throw new Error('Экспорт изображения недоступен.');
  const flipped = new Uint8ClampedArray(bytes.length), rowSize = width * 4;
  for (let row = 0; row < height; row++) flipped.set(bytes.subarray(row * rowSize, (row + 1) * rowSize), (height - row - 1) * rowSize);
  context.putImageData(new ImageData(flipped, width, height), 0, 0);
  return new Promise<Blob>((resolve, reject) => output.toBlob(blob => blob ? resolve(blob) : reject(new Error('Не удалось создать PNG.')), 'image/png'));
}
