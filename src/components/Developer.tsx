import React, { useEffect } from 'react';

export const Developer: React.FC = () => {
  useEffect(() => {
    // Redirect to the developer's website
    window.location.href = 'https://draurangzebabbas.com';
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center">
      <div className="text-center text-white">
        {/* Profile Picture */}
        <div className="mb-8">
          <div className="w-32 h-32 rounded-full overflow-hidden ring-4 ring-blue-500/30 shadow-2xl mx-auto">
            <img 
              src="/draurangzebabbas.png" 
              alt="Daurang Zeb Abbas" 
              className="w-full h-full object-cover"
            />
          </div>
        </div>
        
        <h1 className="text-3xl font-bold mb-4 text-blue-200">Redirecting...</h1>
        <p className="text-gray-300 mb-6">Taking you to draurangzebabbas.com</p>
        <div className="mt-4">
          <a 
            href="https://draurangzebabbas.com" 
            className="text-blue-400 hover:text-blue-300 underline font-medium"
          >
            Click here if you're not redirected automatically
          </a>
        </div>
      </div>
    </div>
  );
};
