import { Node } from '@tiptap/core';

// Dummy test citation data for development
const testCitations = [
  { 
    label: 'Zakon o obveznim odnosima', 
    sourceId: 'zo-1', 
    url: 'https://www.zakon.hr/z/zo-1', 
    confidence: 'high' 
  },
  { 
    label: 'Presuda VSRH-123/2023', 
    sourceId: 'vsrh-123', 
    url: '#', 
    confidence: 'medium' 
  },
  { 
    label: 'Zakon o parničnom postupku', 
    sourceId: 'zpp-1', 
    url: 'https://www.zakon.hr/z/zpp-1', 
    confidence: 'low' 
  }
];

// Get confidence-based styling
const getConfidenceClasses = (confidence) => {
  switch (confidence) {
    case 'high':
      return 'bg-green-100 text-green-700 border-green-500';
    case 'medium':
      return 'bg-yellow-100 text-yellow-700 border-yellow-500';
    case 'low':
      return 'bg-orange-100 text-orange-700 border-orange-500';
    default:
      return 'bg-blue-100 text-blue-700 border-blue-500';
  }
};

// CitationNode - AI-generated legal citations
export default Node.create({
  name: 'citation',
  
  group: 'inline',
  inline: true,
  atom: true, // Cannot edit content inside
  
  addAttributes() {
    return {
      label: {
        default: null,
      },
      sourceId: {
        default: null,
      },
      url: {
        default: null,
      },
      confidence: {
        default: 'medium',
      },
    };
  },
  
  parseHTML() {
    return [
      {
        tag: 'citation[data-citation]',
      },
    ];
  },
  
  renderHTML({ HTMLAttributes }) {
    return ['citation', { 'data-citation': 'true', ...HTMLAttributes }];
  },
  
  addNodeView() {
    return ({ node, editor }) => {
      const dom = document.createElement('span');
      const { label, url, confidence } = node.attrs;
      
      // Create citation pill badge
      dom.className = `inline-flex items-center px-2 py-1 m-1 rounded-full text-xs font-medium border cursor-pointer transition-all hover:shadow-md ${getConfidenceClasses(confidence)}`;
      dom.contentEditable = 'false'; // Make immutable
      
      // Add citation text
      const textSpan = document.createTextNode(label || 'Citation');
      dom.appendChild(textSpan);
      
      // Add click handler for citation verification
      if (url && url !== '#') {
        dom.addEventListener('click', (e) => {
          e.preventDefault();
          window.open(url, '_blank', 'noopener,noreferrer');
        });
        dom.title = `Kliknite za provjeru citata: ${label}`;
      } else {
        dom.title = `Citat: ${label} (nema dostupnog linka)`;
      }
      
      // Add delete functionality (delete-only interaction)
      dom.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (editor) {
          const { from } = editor.state.selection;
          editor.chain().focus().deleteRange({ from, to: from + 1 }).run();
        }
      });
      
      // Add visual indicator for clickability
      if (url && url !== '#') {
        const linkIndicator = document.createElement('svg');
        linkIndicator.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        linkIndicator.setAttribute('width', '12');
        linkIndicator.setAttribute('height', '12');
        linkIndicator.setAttribute('viewBox', '0 0 24 24');
        linkIndicator.setAttribute('fill', 'none');
        linkIndicator.setAttribute('stroke', 'currentColor');
        linkIndicator.setAttribute('stroke-width', '2');
        linkIndicator.setAttribute('class', 'ml-1');
        linkIndicator.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />';
        dom.appendChild(linkIndicator);
      }
      
      return {
        dom,
        destroy: () => {
          // Cleanup if needed
        },
      };
    };
  },
  
  // Add command to insert citation (for AI-generated content)
  addCommands() {
    return {
      insertCitation: (attributes) => ({ chain }) => {
        return chain()
          .insertContent({
            type: this.name,
            attrs: attributes,
          })
          .run();
      },
      
      // For testing: insert random test citation
      insertTestCitation: () => ({ chain }) => {
        const randomCitation = testCitations[Math.floor(Math.random() * testCitations.length)];
        return chain()
          .insertContent({
            type: this.name,
            attrs: randomCitation,
          })
          .run();
      },
    };
  },
});