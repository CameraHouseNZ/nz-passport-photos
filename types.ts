
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

export enum AppStep {
  UPLOAD = 'UPLOAD',
  CROP = 'CROP',
  VALIDATE = 'VALIDATE',
  DOWNLOAD = 'DOWNLOAD'
}
