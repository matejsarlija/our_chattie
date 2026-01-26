import { useChat } from '../../contexts/ChatContext';

export default function ControlPanel({ 
  mode = 'chat',
  onClearChat, 
  caseNumber, 
  setCaseNumber, 
  onCourtAnalysis,
  courtAnalysisLoading,
  courtAnalysisError,
  analysisProgress 
}) {
  const { textSize, setTextSize } = useChat();
  const isValidInput = caseNumber.trim().length >= 8;

  // Court analysis handler
  const handleCourtAnalysis = async () => {
    if (!caseNumber.trim()) {
      return; // Let parent handle validation
    }
    onCourtAnalysis?.();
  };

  return (
    <div className="hidden lg:block w-1/6 lg:w-1/5 bg-white border-l border-slate-200 p-4" style={{ overflowY: 'auto' }}>
      <div className="sticky top-4 space-y-4">
        {/* Text size toggle - Common for all modes */}
        <div className="border border-slate-200 rounded-lg p-3 shadow-sm bg-white">
          <p className="text-sm text-slate-600 mb-2">Veličina teksta</p>
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() => setTextSize(16)}
              className={`px-3 py-2 rounded-md ${textSize === 16 ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-800'} hover:bg-slate-200`}
            >
              A
            </button>
            <button
              onClick={() => setTextSize(18)}
              className={`px-3 py-2 rounded-md ${textSize === 18 ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-800'} hover:bg-slate-200`}
            >
              A+
            </button>
          </div>
        </div>

        {/* Mode-specific controls */}
        {mode === 'chat' ? (
          <>
            {/* Clear conversation button */}
            <div className="border border-slate-200 rounded-lg p-3 shadow-sm bg-white">
              <button
                onClick={onClearChat}
                className="w-full text-slate-800 bg-slate-100 px-3.5 py-2 rounded-lg hover:bg-slate-200 transition-colors border border-slate-300"
              >
                Očisti razgovor
              </button>
            </div>

            {/* Court Analysis Section */}
            <div className="border border-slate-200 rounded-lg p-3 shadow-sm bg-white">
              <p className="text-sm text-slate-600 mb-2">Unesite broj predmeta ili OIB</p>
              <div className="space-y-2">
                <input
                  type="text"
                  value={caseNumber}
                  onChange={(e) => setCaseNumber?.(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && isValidInput && handleCourtAnalysis()}
                  placeholder="Npr. 12345678 (min. 8 znakova)"
                  minLength={3}
                  className={`w-full px-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${caseNumber.trim().length > 0 && caseNumber.trim().length < 8
                      ? 'border-red-300 bg-red-50'
                      : 'border-slate-300'
                  }`}
                  disabled={courtAnalysisLoading}
                />

                {/* Validation message */}
                {caseNumber.trim().length > 0 && caseNumber.trim().length < 8 && (
                  <div className="text-blue-600 text-xs mt-1">
                    Minimalno 8 znakova potrebno
                  </div>
                )}

                {/* Error message */}
                {courtAnalysisError && (
                  <div className="text-amber-600 text-sm">
                    {courtAnalysisError}
                  </div>
                )}

                <button
                  onClick={handleCourtAnalysis}
                  disabled={courtAnalysisLoading || !isValidInput}
                  className={`w-full py-2 px-3 text-sm rounded-md font-medium transition-colors relative overflow-hidden ${courtAnalysisLoading || !isValidInput
                      ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  }`}
                >
                  {/* Progress bar background */}
                  {courtAnalysisLoading && (
                    <div
                      className="absolute inset-0 bg-blue-400 transition-all duration-300 ease-out"
                      style={{ width: `${analysisProgress || 0}%` }}
                    />
                  )}

                  {/* Button content */}
                  <div className="relative z-10 flex items-center justify-center">
                    {courtAnalysisLoading ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-1 h-3 w-3 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Analiza u tijeku... {analysisProgress || 0}%
                      </>
                    ) : (
                      'Pretraži e-Oglasnu ploču sudova'
                    )}
                  </div>
                </button>
              </div>
            </div>
          </>
        ) : (
          /* Canvas mode controls (placeholder for Chunk 3) */
          <div className="border border-slate-200 rounded-lg p-3 shadow-sm bg-white">
            <p className="text-sm text-slate-600 mb-2">Document Tools</p>
            <div className="space-y-2">
              <button className="w-full text-slate-800 bg-slate-100 px-3 py-2 rounded-md text-sm hover:bg-slate-200">
                📄 Templates
              </button>
              <button className="w-full text-slate-800 bg-slate-100 px-3 py-2 rounded-md text-sm hover:bg-slate-200">
                💾 Save Document
              </button>
              <button className="w-full text-slate-800 bg-slate-100 px-3 py-2 rounded-md text-sm hover:bg-slate-200">
                📤 Export
              </button>
            </div>
          </div>
        )}

        {/* Right Ad Container */}
        <div className="mt-8">
          <div className="ad-container-right h-[600px] bg-slate-100 rounded-lg">
            <ins className="adsbygoogle"
              style={{ display: "block" }}
              data-ad-client="ca-pub-4611047163958988"
              data-ad-slot="6802702755"
              data-ad-format="auto"
              data-full-width-responsive="true"></ins>
          </div>
        </div>
      </div>
    </div>
  );
}