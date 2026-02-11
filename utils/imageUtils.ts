
import { Area } from "../types";

export const createImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', (error) => reject(error));
    image.setAttribute('crossOrigin', 'anonymous');
    image.src = url;
  });

// NZ Passport digital requirement: 900-4500px wide, 1200-6000px high (3:4 ratio)
// Target 1500x2000px for high quality within range
const TARGET_WIDTH = 1500;
const TARGET_HEIGHT = 2000;

function drawCroppedImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  pixelCrop: Area,
  rotation: number,
): void {
  const scaleX = TARGET_WIDTH / pixelCrop.width;
  const scaleY = TARGET_HEIGHT / pixelCrop.height;

  ctx.save();
  ctx.translate(TARGET_WIDTH / 2, TARGET_HEIGHT / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.scale(scaleX, scaleY);
  ctx.translate(
    -(pixelCrop.x + pixelCrop.width / 2),
    -(pixelCrop.y + pixelCrop.height / 2)
  );
  ctx.drawImage(image, 0, 0);
  ctx.restore();
}

function addWatermark(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.globalAlpha = 0.15;
  ctx.fillStyle = '#888888';
  ctx.font = 'bold 100px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.translate(TARGET_WIDTH / 2, TARGET_HEIGHT / 2);
  ctx.rotate(-Math.PI / 6);
  ctx.fillText('PREVIEW', 0, -100);
  ctx.fillText('PREVIEW', 0, 100);
  ctx.restore();
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) throw new Error('Canvas is empty');
        resolve(blob);
      },
      'image/jpeg',
      quality,
    );
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

/**
 * Generate a watermarked preview image, full-quality data URL, and file size stats.
 * The caller should upload fullDataUrl to the server then discard it.
 * The previewUrl contains a visible watermark and is NOT suitable for final download.
 */
export const getCroppedImg = async (
  imageSrc: string,
  pixelCrop: Area,
  rotation: number = 0
): Promise<{ previewUrl: string; fullDataUrl: string; fullSizeBytes: number; width: number; height: number }> => {
  const image = await createImage(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');

  canvas.width = TARGET_WIDTH;
  canvas.height = TARGET_HEIGHT;

  // Draw cropped image (clean) to get full-quality data URL
  drawCroppedImage(ctx, image, pixelCrop, rotation);
  const fullBlob = await canvasToBlob(canvas, 0.95);
  const fullDataUrl = await blobToDataUrl(fullBlob);

  // Add watermark over the image for preview
  addWatermark(ctx);
  const previewBlob = await canvasToBlob(canvas, 0.7);
  const previewUrl = await blobToDataUrl(previewBlob);

  return {
    previewUrl,
    fullDataUrl,
    fullSizeBytes: fullBlob.size,
    width: TARGET_WIDTH,
    height: TARGET_HEIGHT,
  };
};