import ReactMarkdown from 'react-markdown';
import React, { useRef, useEffect } from 'react';
import TipTapEditor from './TipTapEditor';
import { extractAndCleanMarkdown } from '../../hooks/utils/markdownParser';
import { convertMarkdownWithCitations } from '../../hooks/utils/markdownToHTML';
import { useChat } from '../../contexts/ChatContext';

function MessageList() {
  const { messages, error, isLoading, textSize } = useChat();
  const messagesEndRef = useRef(null);

  // Debug logging for message display issues
  useEffect(() => {
    console.log('MessageList render:', {
      messageCount: messages.length,
      isLoading,
      hasError: !!error
    });
  }, [messages, isLoading, error]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Empty state for chat
  if (messages.length === 0) {
    return (
      <div className="text-center text-slate-500 py-10">
        <h2 className="text-xl mb-3">Dobrodošli na Alimentacija.info</h2>
        <p>Postavite pitanje kroz chat i odmah dobijte odgovor sa informacijama koji vam može pomoći u daljnjem usmjeravanju!</p>
        <p>Ova usluga pruža opće pravne informacije i ne predstavlja pravni savjet. Ne postoji odvjetničko-klijentski odnos između korisnika i pružatelja usluge.</p>
        <p>Za konkretne pravne probleme i savjete prilagođene vašoj situaciji, obratite se kvalificiranom pravnom stručnjaku ili odvjetniku.</p>
        <p>Korištenjem ove usluge korisnik prihvaća navedene uvjete i razumije da pružene informacije nisu pravno obvezujuće.</p>
        <p>Asistent *može pogriješiti*. Provjerite važne informacije.</p>
      </div>
    );
  }

  return (
    <div 
      className="max-w-4xl mx-auto p-4 md:p-5 w-full" 
      style={{ fontSize: `${textSize}px` }}
      role="log"
      aria-label="Povijest razgovora"
      aria-live="polite"
    >
      <div className="space-y-4">
        {/* Render chat messages */}
        {messages.map((msg, index) => {
          const messageKey = msg.timestamp || `msg-${index}`;
          return (
          <div
            key={messageKey}
            className={msg.isUser ? 'flex justify-end' : 'flex justify-start'}
          >
            <div
              className={msg.isUser ?
                'max-w-xs sm:max-w-md md:max-w-2xl p-3 md:p-4 rounded-xl shadow-sm bg-blue-600 text-white ring ring-blue-600' :
                'max-w-xs sm:max-w-md md:max-w-2xl p-3 md:p-4 rounded-xl shadow-sm bg-white ring ring-slate-100'
              }
            >
               <div>
                 {msg.isUser ? (
                   <>
                     <div>{msg.text}</div>
                     {msg.hasAttachment && (
                       <div className="mt-2 flex items-center text-white text-sm">
                         <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1">
                           <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                         </svg>
                         <span className="truncate max-w-[200px]">{msg.attachmentName}</span>
                       </div>
                     )}
                   </>
                 ) : (
                   <div className="prose prose-slate max-w-none">
                     {/* Parse markdown blocks and render embedded editors */}
                     <MessageContent 
                       msg={msg} 
                       messageIndex={index} 
                     />
                   </div>
                 )}
               </div>
            </div>
          </div>
          );
        })}



        {/* Error display */}
        {error && (
          <div className="bg-red-50 p-3 rounded-lg border border-red-100 text-red-600 text-center">
            {error}
          </div>
        )}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex justify-center">
            <div className="flex items-center space-x-2 text-slate-500">
              <svg className="animate-spin -ml-1 mr-1 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span className="text-sm">AI odgovara...</span>
            </div>
          </div>
        )}
        
        {/* Scroll anchor */}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}

// Separate component for message content with error boundary and memoization
const MessageContent = React.memo(({ msg, messageIndex }) => {
  const { updateEditorContent } = useChat();
  const [hasError, setHasError] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState('');

  React.useEffect(() => {
    setHasError(false);
    setErrorMessage('');
  }, [msg.text]);

  if (hasError) {
    return (
      <div className="text-red-600 text-sm p-2 border border-red-200 rounded">
        <div>Error rendering message content:</div>
        <div className="text-xs mt-1">{errorMessage}</div>
        <div className="mt-2 text-xs text-slate-600">
          Raw content: {msg.text?.substring(0, 200)}...
        </div>
      </div>
    );
  }

  try {
    // Priority 1: Use pre-processed editors from workspace state
    if (msg.editors && msg.editors.length > 0) {
      return (
        <>
          {/* Render cleaned text directly from the message */}
          <ReactMarkdown>{msg.text}</ReactMarkdown>
          
          {/* Render existing editors from state */}
          {msg.editors.map((editor) => (
            <div key={editor.id} className="mt-4 mb-4">
              <TipTapEditor
                messageId={msg.timestamp}
                editorId={editor.id}
                initialContent={editor.content}
                onChange={updateEditorContent}
                onError={(error) => {
                  console.error('TipTapEditor error:', error);
                  setHasError(true);
                  setErrorMessage(error.message || 'Editor initialization failed');
                }}
              />
            </div>
          ))}
        </>
      );
    }

    // Priority 2: Fallback to parsing text (legacy or unprocessed messages)
    // Use rawText if available to ensure we don't parse already-cleaned text
    const textToParse = msg.rawText || msg.text;
    const markdownData = extractAndCleanMarkdown(textToParse, messageIndex);
    const cleanedText = markdownData?.cleanedText || textToParse;
    const blocks = markdownData?.blocks || [];
    
    return (
      <>
        {/* Render cleaned text (text with markdown blocks removed) */}
        <ReactMarkdown>{cleanedText}</ReactMarkdown>
        
        {/* Render TipTap editors for each markdown block */}
        {blocks.map((block) => (
          <div key={block.id} className="mt-4 mb-4">
            <TipTapEditor
              messageId={msg.timestamp}
              editorId={block.id}
              initialContent={convertMarkdownWithCitations(block.markdown)}
              onChange={updateEditorContent}
              onError={(error) => {
                console.error('TipTapEditor error:', error);
                setHasError(true);
                setErrorMessage(error.message || 'Editor initialization failed');
              }}
            />
          </div>
        ))}
      </>
    );
  } catch (error) {
    console.error('Error parsing markdown blocks:', error);
    setHasError(true);
    setErrorMessage(error.message || 'Markdown parsing failed');
    
    // Fallback to rendering the raw text if markdown parsing fails
    return <ReactMarkdown>{msg.text}</ReactMarkdown>;
  }
});

export default MessageList;