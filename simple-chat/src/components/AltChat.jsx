import { useState, useEffect, useRef, useCallback } from 'react';
import { useChat } from '../contexts/ChatContext';
import { useStreamingAPI } from '../hooks/useStreamingAPI';
import { useFileUpload } from '../hooks/useFileUpload';
import CourtAnalysisModal from './CourtAnalysisModal';
import WelcomeModal from './WelcomeModal';
import { useFirstVisit } from '../hooks/useFirstVisit';
import ErrorBoundary from './ErrorBoundary';
import {
  MessageList,
  ChatInput,
  ChatHeader,
  ControlPanel,
  MobileControls,
  ScrollToBottomButton
} from './Chat';

export default function AltChat() {
  // Custom hooks for state management
  const { 
    messages, addMessages, updateMessage, removeMessage, clearMessages,
    textSize, setTextSize, setError, clearError, setLoading
  } = useChat();
  const streamingAPI = useStreamingAPI();
  const fileUpload = useFileUpload();

  // Local state for UI
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [caseNumber, setCaseNumber] = useState('');
  const [courtAnalysisLoading, setCourtAnalysisLoading] = useState(false);
  const [courtAnalysisError, setCourtAnalysisError] = useState('');
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [isAnalysisModalOpen, setIsAnalysisModalOpen] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);

  // Welcome modal state
  const { isFirstVisit, loading } = useFirstVisit();
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const chatScrollContainerRef = useRef(null);

  // Input text state
  const [inputText, setInputText] = useState('');

  // Load AdSense script and initialize ads
  useEffect(() => {
    try {
      if (window.adsbygoogle && !window.adsbygoogle.loaded) {
        window.adsbygoogle = window.adsbygoogle || [];
        window.adsbygoogle.push({});
      }
    } catch (e) {
      console.error('AdSense initialization error:', e);
    }
  }, []);

  // Show the modal when we determine it's a first visit
  useEffect(() => {
    if (!loading && isFirstVisit) {
      setShowWelcomeModal(true);
    }
  }, [isFirstVisit, loading]);

  // Handle chat message sending
  const handleSend = async () => {
    if ((!inputText.trim() && !fileUpload.selectedFile) || streamingAPI.isLoading) return;

    const userMessage = {
      text: inputText,
      isUser: true,
      timestamp: new Date().toISOString(),
      hasAttachment: !!fileUpload.selectedFile,
      attachmentName: fileUpload.selectedFile ? fileUpload.selectedFile.name : null
    };

    const aiMessageTimestamp = new Date(Date.now() + 1).toISOString();
    const aiMessage = {
      text: '',
      isUser: false,
      timestamp: aiMessageTimestamp
    };

    // Capture the history BEFORE adding the new message to avoid stale state issues
    const historyToSend = [...messages, userMessage];

    addMessages([userMessage, aiMessage]);
    setInputText('');
    clearError();
    setLoading(true);
    let latestContent = '';
    let hadError = false;

    try {
      // Stream chat response
      await streamingAPI.streamChat(
        historyToSend,
        fileUpload.selectedFile,
        {
          onContent: (content) => {
            latestContent = content;
            updateMessage(aiMessageTimestamp, { text: content, isStreaming: true });
          },
          onError: (err) => {
            hadError = true;
            setError(`Connection failed: ${err}. Please try again.`);
            removeMessage(aiMessageTimestamp); // Remove failed AI message by timestamp
          },
          onComplete: () => {}
        }
      );

    } catch (err) {
      if (err.name !== 'AbortError') {
        hadError = true;
        setError(`Connection failed: ${err.message || 'Unknown error'}. Please try again.`);
        removeMessage(aiMessageTimestamp);
      }
    } finally {
      if (!hadError) {
        updateMessage(aiMessageTimestamp, { text: latestContent, finalize: true });
      }
      setLoading(false);
      fileUpload.clearUploadState();
    }
  };

  const handleStop = () => {
    streamingAPI.stopGeneration();
    setLoading(false);
  };

  // Handle court analysis
  const handleCourtAnalysis = async () => {
    if (!caseNumber.trim()) {
      setCourtAnalysisError('Molimo unesite broj predmeta.');
      return;
    }

    setCourtAnalysisError('');
    setCourtAnalysisLoading(true);
    setAnalysisProgress(0);

    try {
      await streamingAPI.streamCourtAnalysis(caseNumber.trim(), {
        onProgress: (data) => {
          setAnalysisProgress(data.progress || 0);
        },
        onComplete: (data) => {
          setAnalysisResult(data);
          setIsAnalysisModalOpen(true);
        },
        onError: (err) => {
          setCourtAnalysisError(err);
        }
      });

    } catch (error) {
      setCourtAnalysisError(error.message || 'Greška pri spajanju. Molimo pokušajte ponovno.');
    } finally {
      setCourtAnalysisLoading(false);
      setAnalysisProgress(0);
    }
  };

  // Handle clear chat
  const handleClearChat = () => {
    clearMessages();
    setShowClearConfirm(false);
  };

  // Handle file selection
  const handleFileSelect = (file) => {
    fileUpload.handleFileSelect({ target: { files: [file] } });
  };

  useEffect(() => {
    const scrollContainer = chatScrollContainerRef.current;
    if (!scrollContainer) return;

    const updateScrollButtonVisibility = () => {
      const distanceFromBottom =
        scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight;
      setShowScrollButton(distanceFromBottom >= 120);
    };

    updateScrollButtonVisibility();
    scrollContainer.addEventListener('scroll', updateScrollButtonVisibility, { passive: true });

    return () => {
      scrollContainer.removeEventListener('scroll', updateScrollButtonVisibility);
    };
  }, []);

  useEffect(() => {
    const scrollContainer = chatScrollContainerRef.current;
    if (!scrollContainer) return;

    const distanceFromBottom =
      scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight;
    setShowScrollButton(distanceFromBottom >= 120);
  }, [messages, streamingAPI.isLoading]);

  const handleScrollToBottom = useCallback(() => {
    const scrollContainer = chatScrollContainerRef.current;
    if (!scrollContainer) return;

    setShowScrollButton(false);
    scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: 'smooth' });
  }, []);

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* Header */}
      <ChatHeader
        textSize={textSize}
        onTextSizeChange={setTextSize}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar */}
        <div className="hidden md:block w-1/6 lg:w-1/5">
          <div className="sticky top-4">
            {/* Google Adsense Left Column Code */}
            <div className="ad-container-left h-96 lg:h-[600px] bg-slate-100 rounded-lg">
              <ins className="adsbygoogle"
                style={{ display: "block" }}
                data-ad-client="ca-pub-4611047163958988"
                data-ad-slot="6802702755"
                data-ad-format="auto"
                data-full-width-responsive="true"></ins>
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 min-h-0">
          <div className="flex flex-col h-full min-h-0">
            {/* Message List */}
            <div className="flex-1 min-h-0 relative">
              <div
                ref={chatScrollContainerRef}
                className="h-full min-h-0 overflow-y-auto"
                data-scroll-container="chat"
              >
                <ErrorBoundary>
                  <MessageList />
                </ErrorBoundary>
              </div>
              <div className="pointer-events-none absolute inset-x-0 bottom-6 z-30 flex justify-center">
                <ScrollToBottomButton visible={showScrollButton} onClick={handleScrollToBottom} />
              </div>
            </div>

            {/* Chat Input */}
            <ChatInput
              inputText={inputText}
              setInputText={setInputText}
              onSend={handleSend}
              onStop={handleStop}
              isLoading={streamingAPI.isLoading}
              selectedFile={fileUpload.selectedFile}
              onFileSelect={handleFileSelect}
            />

            {/* Footer */}
            <footer className="bg-white p-4 border-t border-slate-200 mt-auto">
              <div className="max-w-4xl mx-auto text-center text-slate-600 text-sm">
                <p>© {new Date().getFullYear()} Alimentacija.info</p>
                <p className="mt-1">
                  Sve informacije pružene putem ove usluge su informativne prirode i ne predstavljaju pravni savjet.
                </p>
              </div>
            </footer>
          </div>
        </div>

        {/* Right Controls Panel */}
        <ControlPanel
          textSize={textSize}
          setTextSize={setTextSize}
          onClearChat={() => setShowClearConfirm(true)}
          caseNumber={caseNumber}
          setCaseNumber={setCaseNumber}
          onCourtAnalysis={handleCourtAnalysis}
          courtAnalysisLoading={courtAnalysisLoading}
          courtAnalysisError={courtAnalysisError}
          analysisProgress={analysisProgress}
        />

        {/* Mobile Controls */}
        <MobileControls
          textSize={textSize}
          setTextSize={setTextSize}
          onClearChat={() => setShowClearConfirm(true)}
          onFileUpload={handleFileSelect}
          isLoading={streamingAPI.isLoading}
          selectedFile={fileUpload.selectedFile}
        />

        {/* Confirmation Modal */}
        {showClearConfirm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg p-6 max-w-sm w-full shadow-xl">
              <h3 className="text-lg font-medium mb-3">Očisti razgovor</h3>
              <p className="text-slate-600 mb-4">Jeste li sigurni da želite očistiti cijeli razgovor?</p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setShowClearConfirm(false)}
                  className="px-4 py-2 border border-slate-300 rounded-md text-slate-700 hover:bg-slate-50"
                >
                  Odustani
                </button>
                <button
                  onClick={handleClearChat}
                  className="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600"
                >
                  Očisti
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Court Analysis Modal */}
      <CourtAnalysisModal
        isOpen={isAnalysisModalOpen}
        onClose={() => setIsAnalysisModalOpen(false)}
        progress={analysisProgress}
        result={analysisResult}
        searchTerm={caseNumber}
      />

      {/* Welcome Modal */}
      <WelcomeModal
        isOpen={showWelcomeModal}
        onClose={() => setShowWelcomeModal(false)}
      />
    </div>
  );
}
