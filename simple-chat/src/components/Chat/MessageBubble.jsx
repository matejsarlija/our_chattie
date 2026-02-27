import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import TipTapEditor from './TipTapEditor';
import WordFadeIn from './WordFadeIn';
import { extractAndCleanMarkdown } from '../../hooks/utils/markdownParser';
import { convertMarkdownWithCitations } from '../../hooks/utils/markdownToHTML';
import { useChat } from '../../contexts/ChatContext';

/**
 * Renders a single chat message (User or AI)
 */
export default function MessageBubble({ msg, index, isLastMessage }) {
  const isUser = msg.isUser;

  return (
    <div className={isUser ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={
          isUser
            ? 'max-w-xs sm:max-w-md md:max-w-2xl p-3 md:p-4 rounded-2xl rounded-tr-md shadow-sm bg-blue-600 text-white ring-1 ring-blue-600'
            : 'max-w-xs sm:max-w-md md:max-w-2xl p-3 md:p-4 rounded-2xl rounded-tl-none shadow-sm bg-white ring-1 ring-slate-200'
        }
      >
        <div>
          {isUser ? (
            <UserMessageContent msg={msg} />
          ) : (
            <div className="prose prose-slate max-w-none">
              <WordFadeIn animate={isLastMessage && !msg.isStreaming}>
                <AIMessageContent msg={msg} messageIndex={index} isLastMessage={isLastMessage} />
              </WordFadeIn>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function UserMessageContent({ msg }) {
  return (
    <>
      <div className="whitespace-pre-wrap">{msg.text}</div>
      {msg.hasAttachment && (
        <div className="mt-2 flex items-center text-white/90 text-sm bg-white/10 p-2 rounded-md">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mr-2 flex-shrink-0"
          >
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
          </svg>
          <span className="truncate max-w-[200px]">{msg.attachmentName}</span>
        </div>
      )}
    </>
  );
}

const AIMessageContent = React.memo(({ msg, messageIndex, isLastMessage }) => {
  const { updateEditorContent } = useChat();
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
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
