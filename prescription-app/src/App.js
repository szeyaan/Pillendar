import React, { useState, useRef, useEffect, useMemo } from 'react';
import './App.css';
import { Upload, FileText, CheckCircle, Camera } from 'lucide-react';

export default function App() {
  // Navigation & Flow State
  const [currentView, setCurrentView] = useState('splash'); // 'splash', 'camera', 'info', 'confirm'
  const [message, setMessage] = useState('');
  
  // Camera State
  const [stream, setStream] = useState(null);
  
  // Image & API State
  const [imagePreviewUrl, setImagePreviewUrl] = useState(null);
  const [imageInfo, setImageInfo] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState(null);
  
  // Refs
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);

  const labelMap = {
    'medication_name': 'Medication Name',
    'dosage_strength': 'Dosage / Strength',
    'directions': 'Directions for Use',
  };

  // --- CLEANUP & RESET ---
  const resetToSplash = () => {
    stopCamera();
    setCurrentView('splash');
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl); // Prevent memory leaks
    }
    setImagePreviewUrl(null);
    setImageInfo({});
    setApiError(null);
    setMessage('');
  };

  // --- CAMERA LOGIC ---
  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  };

  const startCamera = async () => {
    stopCamera(); 
    setMessage('Requesting camera access...');
    
    if (typeof navigator.mediaDevices === 'undefined' || !navigator.mediaDevices.getUserMedia) {
      setMessage("ERROR: Camera access not supported by this browser.");
      return;
    }

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { 
          width: { ideal: 1280 }, 
          height: { ideal: 720 },
          facingMode: "environment" // Prefer back camera
        },
      });

      setStream(mediaStream);
      setCurrentView('camera');
      setMessage('');
    } catch (err) {
      console.error("Error accessing camera: ", err);
      setMessage("ERROR: Could not access camera. Please check permissions.");
    }
  };

  // Connect the video stream to the video element once the view switches
  useEffect(() => {
    if (currentView === 'camera' && videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play();
    }
  }, [currentView, stream]);

  // Clean up camera on unmount
  useEffect(() => {
    return () => stopCamera();
  }, [stream]);

  // --- CAPTURE & UPLOAD LOGIC ---
  
  // 1. Capture from live video
  const handleCapture = () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Convert the canvas to a Blob (File) so we can send it to the backend exactly like an uploaded file
    canvas.toBlob((blob) => {
      const file = new File([blob], "camera_capture.png", { type: "image/png" });
      stopCamera();
      processImageAndFetchAPI(file);
    }, 'image/png');
  };

  // 2. Upload from gallery
  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file || !file.type.startsWith('image/')) {
      setMessage('Please upload a valid image file.');
      return;
    }
    stopCamera(); // Just in case
    processImageAndFetchAPI(file);
  };

  // --- API LOGIC (Shared by both Camera & Upload) ---
  const processImageAndFetchAPI = async (file) => {
    // Setup UI for loading
    const url = URL.createObjectURL(file);
    setImagePreviewUrl(url);
    setCurrentView('info');
    setIsLoading(true);
    setApiError(null);
    setImageInfo({});
    setMessage('');

    try {
      const formData = new FormData();
      formData.append('image', file);
      
      const API_ENDPOINT = 'http://127.0.0.1:5000/api/analyze'; 
      
      const response = await fetch(API_ENDPOINT, { 
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP Error: ${response.status}. Check if Python server is running.`);
      }
      
      const analysisData = await response.json(); 
      setImageInfo(analysisData);

    } catch (error) {
      console.error('API Error:', error);
      setApiError(error.message || 'Could not connect to Python server at http://127.0.0.1:5000.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = () => {
    setCurrentView('confirm');
  };

  // --- UI COMPONENTS ---
  const InformationRow = ({ label, value }) => (
    <div className="mb-4">
      <div className="informationLabel" style={{ fontWeight: 'bold', marginTop: '10px' }}>
        {label}
      </div>
      <div className="informationValue">
        {value}
      </div>
    </div>
  );

  const InfoPanel = useMemo(() => {
    if (apiError) {
      return (
        <div style={{ color: 'red', marginTop: '20px' }}>
          <h4>Connection/Analysis Error</h4>
          <p>{apiError}</p>
        </div>
      );
    }
    if (isLoading) {
      return (
        <div style={{ marginTop: '20px' }}>
          <h4>Analyzing image...</h4>
          <p>Extracting text and identifying medication details.</p>
        </div>
      );
    }
    if (Object.keys(imageInfo).length === 0) return null;

    return (
      <div style={{ marginTop: '20px' }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <FileText size={24}/>
          Pillender Analysis Results
        </h2>
        <div style={{ textAlign: 'left', background: '#f5f5f5', padding: '15px', borderRadius: '8px' }}>
          {Object.entries(imageInfo).map(([key, value]) => (
            <InformationRow 
              key={key} 
              label={labelMap[key] || key} 
              value={value} 
            />
          ))}
        </div>
      </div>
    );
  }, [imageInfo, isLoading, apiError]);


  // --- RENDER SCREENS ---

  if (currentView === 'splash') {
    return (
      <div className="mobileContainer">
        <div className='splashScreen'>
          <img className="logo" src="./pill-25.png" alt="Pill Logo" />
          <h1 className='splashH1'>Pillender</h1>
          <h2 className='splashH2'>Scan. Review. Schedule.</h2>
          
          <button onClick={startCamera} className='splashButton'>
            <Camera style={{ marginRight: '8px' }} size={20} />
            Take Photo
          </button>
          
          <button 
            className="splashButton" 
            style={{ backgroundColor: '#555' }}
            onClick={() => fileInputRef.current && fileInputRef.current.click()}
          >
            <Upload style={{ marginRight: '8px' }} size={20} />
            Upload an Image
          </button>
          
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
          />
        </div>
        <p className='message' style={{ color: 'red' }}>{message}</p>
      </div>
    );
  }

  if (currentView === 'camera') {
    return (
      <div className='mobileContainer'>
        <div className='cameraView' style={{ display: 'flex', flexDirection: 'column', height: '100vh', justifyContent: 'center' }}>
          <div className='videoWrapper' style={{ position: 'relative', width: '100%', maxWidth: '400px', margin: '0 auto' }}>
            <video 
              ref={videoRef} 
              className='video' 
              autoPlay 
              playsInline 
              muted 
              style={{ width: '100%', borderRadius: '12px', backgroundColor: '#000' }} 
            />
            {/* Hidden canvas used to process the image data */}
            <canvas ref={canvasRef} style={{ display: 'none' }} />
          </div>

          <div className='buttonGroup' style={{ marginTop: '20px', display: 'flex', justifyContent: 'space-around' }}>
            <button onClick={resetToSplash} className='splashButton' style={{ width: '40%', backgroundColor: '#888' }}>
              Cancel
            </button>
            <button onClick={handleCapture} className='splashButton' style={{ width: '40%' }}>
              Capture
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (currentView === 'info') {
    return (
      <div className="mobileContainer">
        <div className="imageScreen">
          <div>
            <div className='imageInstruction'>
              <h2 className='imageTitle'>
                {isLoading ? "Processing..." : "All photos analyzed. Edit by clicking on box if needed."}
              </h2>
            </div> 
            
            <div className="aspect-video w-full rounded-lg overflow-hidden border-2" style={{ margin: '20px 0', display: 'flex', justifyContent: 'center' }}>
              {imagePreviewUrl && (
                <img
                  src={imagePreviewUrl}
                  alt="Uploaded Preview"
                  className="uploadedImage"
                  style={{ maxHeight: '300px', borderRadius: '8px' }}
                />
              )}
            </div>
          </div>

          <div className="pb-8">
            {InfoPanel}
          </div>

          {!isLoading && (
            <div className="buttonRow" style={{ display: 'flex', justifyContent: 'space-between', marginTop: '20px' }}>
              <button className="splashButton" style={{ width: '48%', backgroundColor: '#888' }} onClick={resetToSplash}>
                Retake
              </button>
              
              {!apiError && (
                <button className="splashButton" style={{ width: '48%' }} onClick={handleConfirm}>
                  Confirm
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (currentView === 'confirm') {
    return (
      <div className="mobileContainer">
        <div className="confirmScreen" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '50px' }}>
          <CheckCircle className="checkIcon" size={150} color="#4caf50" />
          <h2 className="confirmTitle" style={{ textAlign: 'center', margin: '30px 0' }}>
            Your medication has been added to your calendar!
          </h2>
          <button onClick={resetToSplash} className="splashButton">
            Go Back to Home
          </button>
        </div>
      </div>
    );
  }

  return null;
}