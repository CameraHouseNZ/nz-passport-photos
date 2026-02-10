
import { Area } from "../types";

export const createImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', (error) => reject(error));
    image.setAttribute('crossOrigin', 'anonymous');
    image.src = url;
  });

export const getCroppedImg = async (
  imageSrc: string,
  pixelCrop: Area,
  rotation: number = 0
): Promise<{ dataUrl: string; size: number; width: number; height: number }> => {
  const image = await createImage(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) throw new Error('Could not get canvas context');

  // NZ Passport digital requirement: 900-4500px wide, 1200-6000px high (3:4 ratio)
  // We'll target 1500x2000px to ensure high quality and stay safely within the range
  const targetWidth = 1500;
  const targetHeight = 2000;

  canvas.width = targetWidth;
  canvas.height = targetHeight;

  ctx.save();
  
  // Create a translation/rotation matrix to handle the cropping of a rotated image
  const scaleX = targetWidth / pixelCrop.width;
  const scaleY = targetHeight / pixelCrop.height;

  // Move the context to the center of our target canvas
  ctx.translate(targetWidth / 2, targetHeight / 2);
  // Apply rotation
  ctx.rotate((rotation * Math.PI) / 180);
  // Scale to fit the crop area into our target dimensions
  ctx.scale(scaleX, scaleY);
  // Move back by the center of the crop area
  ctx.translate(
    -(pixelCrop.x + pixelCrop.width / 2),
    -(pixelCrop.y + pixelCrop.height / 2)
  );

  // Draw the original image. The transformation matrix handles the crop + rotation.
  ctx.drawImage(image, 0, 0);
  ctx.restore();

  return new Promise((resolve) => {
    // NZ requires JPEG format. We use high quality (0.95) to ensure it stays > 250KB
    canvas.toBlob(
      (blob) => {
        if (!blob) throw new Error('Canvas is empty');
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => {
          resolve({
            dataUrl: reader.result as string,
            size: blob.size,
            width: targetWidth,
            height: targetHeight
          });
        };
      },
      'image/jpeg',
      0.95
    );
  });
};
