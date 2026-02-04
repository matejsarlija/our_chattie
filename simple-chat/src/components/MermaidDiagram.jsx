import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { ArrowsPointingOutIcon, ArrowDownTrayIcon, XMarkIcon } from '@heroicons/react/24/outline';

// Initialize mermaid
mermaid.initialize({
  startOnLoad: false, // Changed to false for manual rendering control
  theme: 'default',
  securityLevel: 'loose',
  fontFamily: 'inherit',
  flowchart: {
    htmlLabels: true,
    useMaxWidth: false, // Don't squash the diagram
  }
});

const MermaidDiagram = ({ chart }) => {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const [svg, setSvg] = useState('');
  const [error, setError] = useState(null);
  const [showRaw, setShowRaw] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const renderDiagram = async () => {
    if (!chart) return;

    try {
      setError(null);
      const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
      
      // 1. Clean fences
      let cleanChart = chart.replace(/```mermaid/g, '').replace(/```/g, '').trim();
      
      // 2. Aggressive Header Cleaning (Fixes "Rogue TD" bug)
      // Remove any existing graph/flowchart headers entirely before prepending our own
      cleanChart = cleanChart.replace(/^(flowchart|graph)\s+(TD|LR|TB|BT)\s+/, '');
      cleanChart = cleanChart.replace(/^(flowchart|graph)\s+/, '');

      // 3. Prepend Gold Standard Header
      const finalChart = `flowchart TD\n${cleanChart}`;

      const { svg } = await mermaid.render(id, finalChart);
      setSvg(svg);
    } catch (err) {
      console.error('Mermaid rendering failed:', err);
      setError('Nepravilan format dijagrama.');
    }
  };

  useEffect(() => {
    renderDiagram();
  }, [chart]);

  const downloadPNG = () => {
    const svgElement = containerRef.current.querySelector('svg');
    if (!svgElement) return;

    const canvas = document.createElement('canvas');
    const bbox = svgElement.getBBox();
    const padding = 40;
    
    // Set canvas size with padding
    canvas.width = bbox.width + padding * 2;
    canvas.height = bbox.height + padding * 2;
    
    const ctx = canvas.getContext('2d');
    const xml = new XMLSerializer().serializeToString(svgElement);
    const svg64 = btoa(unescape(encodeURIComponent(xml)));
    const b64Start = 'data:image/svg+xml;base64,';
    const image64 = b64Start + svg64;

    const img = new Image();
    img.onload = () => {
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, padding, padding);
      
      const link = document.createElement('a');
      link.download = 'analiza-dijagram.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
    };
    img.src = image64;
  };

  if (error) {
    return (
      <div className="my-6 p-4 bg-amber-50 border border-amber-200 rounded-lg shadow-sm font-sans">
        <div className="flex items-center justify-between mb-2">
          <span className="text-amber-700 text-sm font-medium flex items-center gap-2">
            ⚠️ {error}
          </span>
          <button 
            onClick={() => setShowRaw(!showRaw)}
            className="text-xs text-amber-600 hover:underline"
          >
            {showRaw ? 'Sakrij kod' : 'Vidi izvorni kod'}
          </button>
        </div>
        {showRaw && (
          <div className="mt-2 p-2 bg-white/50 rounded border border-amber-100 overflow-x-auto">
            <pre className="text-[10px] font-mono text-slate-600 whitespace-pre">
              {chart}
            </pre>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="group relative my-8 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden transition-all hover:shadow-md">
        {/* Toolbar */}
        <div className="absolute top-3 right-3 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
          <button 
            onClick={() => setIsFullscreen(true)}
            className="p-2 bg-white/90 backdrop-blur-sm border border-slate-200 rounded-lg text-slate-600 hover:text-blue-600 hover:bg-white shadow-sm transition-all"
            title="Povećaj"
          >
            <ArrowsPointingOutIcon className="w-4 h-4" />
          </button>
          <button 
            onClick={downloadPNG}
            className="p-2 bg-white/90 backdrop-blur-sm border border-slate-200 rounded-lg text-slate-600 hover:text-blue-600 hover:bg-white shadow-sm transition-all"
            title="Preuzmi kao PNG"
          >
            <ArrowDownTrayIcon className="w-4 h-4" />
          </button>
        </div>

        {/* Diagram Container */}
        <div 
          ref={containerRef}
          className="p-6 overflow-x-auto min-h-[200px] flex justify-center items-center"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        
        <div className="bg-slate-50 px-4 py-2 border-t border-slate-100 flex justify-between items-center">
          <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Vizualizacija predmeta</span>
          <span className="text-[10px] text-slate-400 italic">Interaktivni dijagram</span>
        </div>
      </div>

      {/* Fullscreen Modal */}
      {isFullscreen && (
        <div className="fixed inset-0 z-[100] bg-slate-900/90 backdrop-blur-md flex flex-col p-4 md:p-8">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-white font-bold text-lg">Pregled dijagrama</h3>
            <div className="flex items-center gap-4">
              <button 
                onClick={downloadPNG}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-lg"
              >
                <ArrowDownTrayIcon className="w-5 h-5" />
                <span className="hidden sm:inline">Preuzmi PNG</span>
              </button>
              <button 
                onClick={() => setIsFullscreen(false)}
                className="p-2 text-white/70 hover:text-white transition-colors"
              >
                <XMarkIcon className="w-8 h-8" />
              </button>
            </div>
          </div>
          <div className="flex-1 bg-white rounded-2xl overflow-auto flex items-start justify-center p-8">
            <div 
              className="min-w-max"
              dangerouslySetInnerHTML={{ __html: svg }} 
            />
          </div>
        </div>
      )}
    </>
  );
};

export default MermaidDiagram;
