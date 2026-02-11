
export interface ComplianceResult {
  passed: boolean;
  score: number;
  checks: {
    background: string;
    headSize: string;
    expression: string;
    lighting: string;
    sharpness: string;
  };
  feedback: string;
}

export interface TechnicalResult {
  fileSizeKb: number;
  width: number;
  height: number;
  format: string;
  sizeValid: boolean;
  dimensionsValid: boolean;
  formatValid: boolean;
}

export interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PaymentResult {
  verified: boolean;
  orderID?: string;
  error?: string;
}

export interface EmailResult {
  sent: boolean;
  error?: string;
}

export interface PhotoStoreResult {
  photoId: string;
}

export interface DownloadResult {
  downloadUrl: string;
}

export enum AppStep {
  UPLOAD = 'UPLOAD',
  CROP = 'CROP',
  VALIDATE = 'VALIDATE',
  PAYMENT = 'PAYMENT',
  DOWNLOAD = 'DOWNLOAD'
}
