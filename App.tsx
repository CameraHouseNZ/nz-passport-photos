
import React, { useState, useCallback, useEffect, useRef } from 'react';
import Cropper from 'react-easy-crop';
import { Area, AppStep, ComplianceResult, TechnicalResult } from './types';
import { getCroppedImg } from './utils/imageUtils';
import { checkPassportCompliance } from './services/geminiService';
import { loadPayPalSDK, verifyPayment } from './services/paypalService';

const STEPS = [AppStep.UPLOAD, AppStep.CROP, AppStep.VALIDATE, AppStep.PAYMENT, AppStep.DOWNLOAD];

const App: React.FC = () => {
  const [step, setStep] = useState<AppStep>(AppStep.UPLOAD);
  const [image, setImage] = useState<string | null>(null);
  const [croppedImage, setCroppedImage] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [loading, setLoading] = useState(false);
  const [compliance, setCompliance] = useState<ComplianceResult | null>(null);
  const [techResult, setTechResult] = useState<TechnicalResult | null>(null);
  const [paymentVerified, setPaymentVerified] = useState(false);
  const [paypalReady, setPaypalReady] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const paypalRendered = useRef(false);

  const onCropComplete = useCallback((_croppedArea: Area, croppedAreaPixels: Area) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  useEffect(() => {
    if (step !== AppStep.PAYMENT) {
      paypalRendered.current = false;
      return;
    }

    let cancelled = false;

    loadPayPalSDK()
      .then(() => {
        if (cancelled) return;
        setPaypalReady(true);

        if (paypalRendered.current) return;
        paypalRendered.current = true;

        const paypal = (window as any).paypal;
        if (!paypal) return;

        paypal.Buttons({
          createOrder: (_data: any, actions: any) => {
            return actions.order.create({
              purchase_units: [{
                amount: { value: '5.00', currency_code: 'NZD' },
                description: 'NZ Passport Photo - Compliance Check & Download',
              }],
            });
          },
          onApprove: async (_data: any, actions: any) => {
            if (cancelled) return;
            setPaymentLoading(true);
            setPaymentError(null);
            try {
              const details = await actions.order.capture();
              const result = await verifyPayment(details.id);
              if (cancelled) return;
              if (result.verified) {
                setPaymentVerified(true);
                setStep(AppStep.DOWNLOAD);
              } else {
                setPaymentError(result.error ?? 'Payment verification failed.');
              }
            } catch (err: any) {
              if (!cancelled) {
                setPaymentError(err.message ?? 'Payment failed. Please try again.');
              }
            } finally {
              if (!cancelled) setPaymentLoading(false);
            }
          },
          onError: (err: any) => {
            if (!cancelled) {
              console.error('PayPal error:', err);
              setPaymentError('Payment error. Please try again.');
            }
          },
          onCancel: () => {
            // User closed PayPal popup — do nothing
          },
          style: {
            layout: 'vertical',
            color: 'blue',
            shape: 'rect',
            label: 'paypal' as const,
          },
        }).render('#paypal-button-container');
      })
      .catch((err: any) => {
        if (!cancelled) {
          console.error('Failed to load PayPal:', err);
          setPaymentError('Failed to load payment system. Please refresh.');
        }
      });

    return () => { cancelled = true; };
  }, [step]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        setImage(reader.result as string);
        setStep(AppStep.CROP);
      });
      reader.readAsDataURL(e.target.files[0]);
    }
  };

  const handleApplyCrop = async () => {
    if (!image || !croppedAreaPixels) return;
    setLoading(true);
    try {
      const { dataUrl, size, width, height } = await getCroppedImg(image, croppedAreaPixels, rotation);
      setCroppedImage(dataUrl);
      
      const fileSizeKb = size / 1024;
      setTechResult({
        fileSizeKb,
        width,
        height,
        format: 'image/jpeg',
        sizeValid: fileSizeKb >= 250 && fileSizeKb <= 5120, // 250KB to 5MB
        dimensionsValid: width >= 900 && width <= 4500 && height >= 1200 && height <= 6000,
        formatValid: true
      });

      // AI Facial Compliance Check
      const result = await checkPassportCompliance(dataUrl);
      setCompliance(result);
      setStep(AppStep.VALIDATE);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setImage(null);
    setCroppedImage(null);
    setRotation(0);
    setZoom(1);
    setStep(AppStep.UPLOAD);
    setCompliance(null);
    setTechResult(null);
    setPaymentVerified(false);
    setPaypalReady(false);
    setPaymentError(null);
    setPaymentLoading(false);
    paypalRendered.current = false;
  };

  return (
    <div className="min-h-screen flex flex-col items-center bg-[#fdfdfd] text-slate-900">
      <header className="w-full bg-white border-b border-slate-200 py-4 px-6 flex justify-between items-center shadow-sm sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-yellow-400 rounded-lg flex items-center justify-center text-slate-900 shadow-sm">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight leading-tight">NZ Passport<span className="text-yellow-500">.photos</span></h1>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Official Digital Standard</p>
          </div>
        </div>
        <button 
          onClick={reset}
          className="text-xs font-semibold text-slate-400 hover:text-yellow-600 transition-colors uppercase tracking-wider"
        >
          Start Over
        </button>
      </header>

      <main className="flex-1 w-full max-w-4xl px-4 py-8">
        {/* Step Indicator */}
        <div className="flex justify-between items-center mb-10 overflow-x-auto pb-4 sm:pb-0">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center">
              <div className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold transition-all duration-300 ${
                step === s ? 'bg-yellow-400 text-slate-900 shadow-lg ring-4 ring-yellow-50' :
                i < STEPS.indexOf(step) ? 'bg-green-500 text-white' : 'bg-slate-200 text-slate-400'
              }`}>
                {i < STEPS.indexOf(step) ? '✓' : i + 1}
              </div>
              <span className={`ml-2 text-[10px] font-bold uppercase tracking-widest hidden sm:inline ${
                step === s ? 'text-yellow-600' : 'text-slate-400'
              }`}>
                {s}
              </span>
              {i < STEPS.length - 1 && <div className="w-8 sm:w-16 h-px bg-slate-200 mx-2" />}
            </div>
          ))}
        </div>

        {/* Step Content */}
        <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
          {step === AppStep.UPLOAD && (
            <div className="p-12 flex flex-col items-center text-center">
              <div className="w-20 h-20 bg-yellow-50 text-yellow-600 rounded-full flex items-center justify-center mb-6">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
              </div>
              <h2 className="text-3xl font-extrabold mb-2 text-slate-800">Check your photo meets requirements</h2>
              <p className="text-slate-500 mb-10 max-w-md mx-auto leading-relaxed">
                Upload your digital photo to verify it meets the New Zealand Government's technical and facial requirements.
              </p>
              <label className="cursor-pointer bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-bold py-4 px-12 rounded-2xl transition-all shadow-xl shadow-yellow-100 active:scale-95 block sm:inline-block">
                Choose your photo
                <input type="file" accept=".jpg,.jpeg" className="hidden" onChange={handleFileUpload} />
              </label>
              <p className="mt-4 text-xs text-slate-400 font-medium italic">Supports .jpg or .jpeg only</p>
            </div>
          )}

          {step === AppStep.CROP && image && (
            <div className="p-6">
              <div className="relative h-[500px] sm:h-[600px] w-full bg-slate-900 rounded-xl overflow-hidden shadow-inner flex items-center justify-center">
                <Cropper
                  image={image}
                  crop={crop}
                  zoom={zoom}
                  rotation={rotation}
                  aspect={3 / 4} // NZ Digital Requirement (3:4)
                  onCropChange={setCrop}
                  onCropComplete={onCropComplete}
                  onZoomChange={setZoom}
                  onRotationChange={setRotation}
                  showGrid={false}
                />
                
                {/* Visual Guides matching the User's Head Template */}
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                   {/* This container matches the crop area visually */}
                  <div className="relative aspect-[3/4] h-full">
                    {/* The Blue Eye-line Band */}
                    <div className="absolute top-[30%] left-0 right-0 h-[20%] bg-blue-400/20 mix-blend-multiply border-y border-blue-400/30" />
                    
                    {/* The Red Head Oval */}
                    <div className="absolute top-[10%] left-[15%] right-[15%] bottom-[20%] border-[3px] border-red-500 rounded-[50%]" />
                    
                    {/* Instruction Tag */}
                    <div className="absolute top-4 left-4 flex items-center gap-2 bg-black/40 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10">
                      <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                      <span className="text-[10px] text-white font-bold uppercase tracking-widest">Alignment Guide</span>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 items-end gap-8">
                <div className="w-full">
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Adjust Zoom</label>
                    <span className="text-[10px] font-bold text-yellow-700 bg-yellow-50 px-2 py-0.5 rounded">{zoom.toFixed(1)}x</span>
                  </div>
                  <input
                    type="range"
                    value={zoom}
                    min={1}
                    max={3}
                    step={0.01}
                    onChange={(e) => setZoom(Number(e.target.value))}
                    className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-yellow-500"
                  />
                </div>

                <div className="w-full">
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Rotate</label>
                    <span className="text-[10px] font-bold text-yellow-700 bg-yellow-50 px-2 py-0.5 rounded">{rotation}°</span>
                  </div>
                  <input
                    type="range"
                    value={rotation}
                    min={-180}
                    max={180}
                    step={1}
                    onChange={(e) => setRotation(Number(e.target.value))}
                    className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-yellow-500"
                  />
                </div>

                <button
                  onClick={handleApplyCrop}
                  disabled={loading}
                  className="w-full bg-yellow-400 hover:bg-yellow-500 disabled:bg-slate-300 text-slate-900 font-bold py-4 px-12 rounded-2xl transition-all shadow-lg active:scale-95 flex items-center justify-center gap-3"
                >
                  {loading ? (
                    <>
                      <div className="animate-spin rounded-full h-5 w-5 border-2 border-slate-900 border-t-transparent" />
                      Checking requirements...
                    </>
                  ) : 'Verify Photo'}
                </button>
              </div>
              
              <div className="mt-4 p-4 bg-yellow-50/50 rounded-xl border border-yellow-100">
                <p className="text-[11px] text-slate-600 leading-tight">
                  <span className="font-bold text-yellow-700">Tip:</span> Center your head in the <span className="text-red-500 font-bold">red oval</span> and ensure your eyes are within the <span className="text-blue-500 font-bold">blue band</span> for optimal results.
                </p>
              </div>
            </div>
          )}

          {step === AppStep.VALIDATE && croppedImage && techResult && compliance && (
            <div className="p-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                <div className="flex flex-col items-center">
                  <div className="relative group p-2 bg-slate-50 rounded-xl border border-slate-200">
                    <img 
                      src={croppedImage} 
                      alt="Cropped Passport Photo" 
                      className="w-full max-w-[320px] h-auto rounded-lg shadow-xl" 
                    />
                    <div className="absolute -top-3 -right-3">
                      {compliance.passed && techResult.sizeValid ? (
                        <div className="bg-green-500 text-white p-2 rounded-full shadow-lg ring-4 ring-white">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      ) : (
                        <div className="bg-red-500 text-white p-2 rounded-full shadow-lg ring-4 ring-white">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className={`mt-6 w-full text-center py-2 px-4 rounded-lg text-xs font-bold uppercase tracking-widest ${compliance.passed && techResult.sizeValid ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {compliance.passed && techResult.sizeValid ? 'Compliant with NZ Standards' : 'Requires Correction'}
                  </div>
                </div>

                <div>
                  <div className="mb-8">
                    <h3 className="text-xl font-bold mb-3 text-slate-800">Requirements Check</h3>
                    <p className="text-sm text-slate-500 leading-relaxed italic border-l-4 border-yellow-200 pl-4 py-2 bg-yellow-50/30 rounded-r-lg">
                      "{compliance.feedback}"
                    </p>
                  </div>

                  <div className="space-y-6">
                    <section>
                      <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Technical Standards</h4>
                      <div className="space-y-2">
                        <StatusItem label="File Format (.jpg)" value="JPEG" status={techResult.formatValid ? 'pass' : 'fail'} />
                        <StatusItem label="File Size (250KB - 5MB)" value={`${techResult.fileSizeKb.toFixed(0)}KB`} status={techResult.sizeValid ? 'pass' : 'fail'} />
                        <StatusItem label="Dimensions (Min 900x1200)" value={`${techResult.width}x${techResult.height}`} status={techResult.dimensionsValid ? 'pass' : 'fail'} />
                      </div>
                    </section>

                    <section>
                      <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Facial Standards</h4>
                      <div className="space-y-2">
                        <StatusItem 
                          label="Background Style" 
                          value={compliance.checks.background} 
                          status={getStatusFromValue(compliance.checks.background)} 
                        />
                        <StatusItem 
                          label="Head Proportion" 
                          value={compliance.checks.headSize} 
                          status={getStatusFromValue(compliance.checks.headSize)} 
                        />
                        <StatusItem 
                          label="Lighting Quality" 
                          value={compliance.checks.lighting} 
                          status={getStatusFromValue(compliance.checks.lighting)} 
                        />
                        <StatusItem 
                          label="Expression" 
                          value={compliance.checks.expression} 
                          status={getStatusFromValue(compliance.checks.expression)} 
                        />
                      </div>
                    </section>
                  </div>

                  <div className="mt-10 flex gap-4">
                    <button
                      onClick={() => setStep(AppStep.CROP)}
                      className="flex-1 border-2 border-slate-200 hover:border-yellow-300 text-slate-600 font-bold py-3 px-4 rounded-xl transition-all"
                    >
                      Re-crop
                    </button>
                    {compliance.passed && techResult.sizeValid && (
                      <button
                        onClick={() => setStep(AppStep.PAYMENT)}
                        className="flex-1 bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-bold py-3 px-4 rounded-xl transition-all shadow-lg"
                      >
                        Accept Photo
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === AppStep.PAYMENT && (
            <div className="p-12 text-center">
              <div className="w-20 h-20 bg-yellow-50 text-yellow-600 rounded-full flex items-center justify-center mb-6 mx-auto">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="text-3xl font-extrabold mb-2 text-slate-800">Complete Your Purchase</h2>
              <p className="text-slate-500 mb-8 max-w-md mx-auto leading-relaxed">
                Your photo passed all compliance checks. Pay once to download your verified passport photo.
              </p>

              <div className="inline-block mb-8 p-6 bg-slate-50 rounded-2xl border border-slate-200">
                <div className="flex items-baseline justify-center gap-1 mb-4">
                  <span className="text-4xl font-extrabold text-slate-900">$5.00</span>
                  <span className="text-sm font-bold text-slate-400">NZD</span>
                </div>
                <ul className="text-left text-sm text-slate-600 space-y-2 mb-6">
                  <li className="flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-500 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    AI-verified compliant photo
                  </li>
                  <li className="flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-500 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    Instant high-res download
                  </li>
                  <li className="flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-500 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    Meets NZ DIA digital standards
                  </li>
                </ul>

                {paymentLoading ? (
                  <div className="flex items-center justify-center gap-3 py-4">
                    <div className="animate-spin rounded-full h-5 w-5 border-2 border-yellow-500 border-t-transparent" />
                    <span className="text-sm font-semibold text-slate-600">Verifying payment...</span>
                  </div>
                ) : (
                  <div id="paypal-button-container" className="max-w-[400px] mx-auto" />
                )}

                {paymentError && (
                  <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 font-medium">
                    {paymentError}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-center gap-6 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                <div className="flex items-center gap-1.5">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  SSL Encrypted
                </div>
                <div className="flex items-center gap-1.5">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  PayPal Protected
                </div>
              </div>
            </div>
          )}

          {step === AppStep.DOWNLOAD && croppedImage && paymentVerified && (
            <div className="p-12 text-center">
              <div className="w-20 h-20 bg-green-50 text-green-600 rounded-full flex items-center justify-center mb-6 mx-auto">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h2 className="text-3xl font-extrabold mb-2 text-slate-800">Photo Validated!</h2>
              <p className="text-slate-500 mb-12 max-sm mx-auto leading-relaxed">
                Your photo meets technical and facial standards for a digital New Zealand passport application at <span className="text-yellow-600 font-bold italic">nzpassport.photos</span>.
              </p>
              
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <a
                  href={croppedImage}
                  download="nz_passport_photo.jpg"
                  className="w-full sm:w-auto bg-yellow-400 hover:bg-yellow-500 text-slate-900 font-bold py-4 px-12 rounded-2xl transition-all shadow-xl active:scale-95 flex items-center justify-center gap-3"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download .jpg
                </a>
                <button
                  onClick={reset}
                  className="w-full sm:w-auto bg-slate-50 hover:bg-slate-100 text-slate-600 font-bold py-4 px-12 rounded-2xl transition-all active:scale-95 border border-slate-200"
                >
                  Start New Photo
                </button>
              </div>

              <div className="mt-12 p-6 bg-yellow-50/30 rounded-2xl border border-yellow-100 text-left">
                <h4 className="text-xs font-bold text-yellow-700 uppercase tracking-widest mb-3 flex items-center gap-2">
                  Next Steps
                </h4>
                <div className="space-y-3">
                  <div className="flex gap-3">
                    <div className="flex-shrink-0 w-5 h-5 bg-yellow-100 text-yellow-700 rounded-full flex items-center justify-center text-[10px] font-bold">1</div>
                    <p className="text-sm text-slate-600">Save this file to your computer or smartphone.</p>
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-shrink-0 w-5 h-5 bg-yellow-100 text-yellow-700 rounded-full flex items-center justify-center text-[10px] font-bold">2</div>
                    <p className="text-sm text-slate-600">Go to the official <a href="https://www.passports.govt.nz" target="_blank" className="text-yellow-700 font-bold underline">NZ Passports website</a>.</p>
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-shrink-0 w-5 h-5 bg-yellow-100 text-yellow-700 rounded-full flex items-center justify-center text-[10px] font-bold">3</div>
                    <p className="text-sm text-slate-600">Upload this .jpg file during your digital application.</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="mt-12 text-center">
          <p className="text-xs text-slate-400 font-medium">
            This tool is designed to help you prepare your photo. Final acceptance is always determined by the <br />
            New Zealand Department of Internal Affairs.
          </p>
        </div>
      </main>

      <footer className="w-full py-8 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">
        NZ Passport.photos &bull; Independent Verification Tool &bull; 2026
      </footer>
    </div>
  );
};

const getStatusFromValue = (val: string): 'pass' | 'warning' | 'fail' => {
  const v = val.toLowerCase();
  if (v.includes('fail') || v.includes('not acceptable')) return 'fail';
  if (v.includes('warning') || v.includes('borderline') || v.includes('could be')) return 'warning';
  return 'pass';
};

const StatusItem: React.FC<{ label: string; value: string; status: 'pass' | 'warning' | 'fail' }> = ({ label, value, status }) => (
  <div className="flex items-center justify-between p-3 bg-slate-50/50 rounded-xl border border-slate-100">
    <div className="flex items-center gap-3">
      {status === 'pass' && (
        <div className="text-green-500 bg-green-100 p-1 rounded-full">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
        </div>
      )}
      {status === 'warning' && (
        <div className="text-yellow-600 bg-yellow-100 p-1 rounded-full">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        </div>
      )}
      {status === 'fail' && (
        <div className="text-red-500 bg-red-100 p-1 rounded-full">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
        </div>
      )}
      <span className="font-bold text-xs text-slate-600">{label}</span>
    </div>
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
      status === 'pass' ? 'bg-green-50 text-green-600' : 
      status === 'warning' ? 'bg-yellow-50 text-yellow-700' : 
      'bg-red-50 text-red-600'
    }`}>
      {value}
    </span>
  </div>
);

export default App;
