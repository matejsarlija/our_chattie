import React from 'react';
import ReactMarkdown from 'react-markdown';

// Helper function to download markdown file
const downloadMarkdown = (fileAnalysis, index) => {
    const fileName = fileAnalysis.text || `Document_${index + 1}`;
    const content = fileAnalysis.aiResult?.summary || 'No analysis available';

    // Create markdown content
    const markdownContent = `# ${fileName}\n\n${content}`;

    // Create blob and download
    const blob = new Blob([markdownContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${fileName.replace(/[^a-zA-Z0-9]/g, '_')}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

// Helper function to download final summary
const downloadFinalSummary = (finalSummary, caseNumber) => {
    const fileName = caseNumber ? `Zaključak_${caseNumber}` : 'Zaključak_Analize';
    const markdownContent = `# Zaključak Analize\n\n${finalSummary}`;

    const blob = new Blob([markdownContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${fileName.replace(/[^a-zA-Z0-9]/g, '_')}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

// Helper component to render individual document analysis
const DocumentAnalysis = ({ fileAnalysis, index }) => (
    <div key={index} className="bg-slate-50 border border-slate-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                <div className="relative group">
                    <svg
                        onClick={() => downloadMarkdown(fileAnalysis, index)}
                        className="w-8 h-8 p-2 rounded-full bg-blue-100 text-blue-600 hover:bg-blue-200 hover:text-blue-800 transition-colors cursor-pointer"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                        />
                    </svg>

                    {/* Custom tooltip */}
                    <span className="absolute left-1/2 -translate-x-1/2 mt-2 px-2 py-1 text-xs text-white bg-gray-800 rounded opacity-0 group-hover:opacity-100 transition">
                        Kliknite ikonu za preuzimanje kao .md datoteku
                    </span>
                </div>
            </div>
            <div className="flex-1 min-w-0">
                <h4 className="font-medium text-slate-800 truncate">{fileAnalysis.text}</h4>
                {fileAnalysis.error ? (
                    <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-md">
                        <p className="text-sm text-red-600">
                            <span className="font-medium">Greška:</span> {fileAnalysis.error}
                        </p>
                    </div>
                ) : fileAnalysis.aiResult?.summary ? (
                    <div className="mt-2 p-3 bg-white border border-slate-200 rounded-md">
                        <div className="text-sm text-slate-700 whitespace-pre-wrap">
                            {fileAnalysis.aiResult.summary}
                        </div>
                    </div>
                ) : (
                    <p className="mt-2 text-sm text-slate-500">Nema dostupnih rezultata analize.</p>
                )}
            </div>
        </div>
    </div>
);

// Main modal component
export default function CourtAnalysisModal({ isOpen, onClose, result }) {
    if (!isOpen) return null;

    const hasResult = result && result.analysis.individualAnalyses && result.analysis.individualAnalyses.length > 0;
    const caseInfo = result?.caseResult;
    const documents = result?.analysis.individualAnalyses || [];
    const originalFileUrl = result?.originalFile?.url || '';
    const originalFileText = result?.originalFile?.text || 'Izvorni dokument';
    const finalSummary = result?.analysis.finalSummary;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
                {/* Header */}
                <div className="flex justify-between items-center p-6 border-b border-slate-200">
                    <div>
                        <h3 className="text-xl font-bold text-slate-800">Analiza e-Oglasne ploče</h3>
                        {caseInfo?.caseNumber && (
                            <p className="text-sm text-slate-600 mt-1">Predmet: {caseInfo.caseNumber}</p>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-600 transition-colors"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-6">
                    {hasResult ? (
                        <div className="space-y-6">
                            {/* Case Summary */}
                            {caseInfo && (
                                <div className="bg-blue-50 ring ring-blue-200 rounded-md p-4">
                                    <h4 className="font-semibold text-blue-900 mb-3">Informacije o predmetu</h4>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                                        <div>
                                            <span className="font-medium text-blue-800">Broj predmeta:</span>
                                            <span className="ml-2 text-blue-700">{caseInfo.caseNumber || 'N/A'}</span>
                                        </div>
                                        <div>
                                            <span className="font-medium text-blue-800">Sud:</span>
                                            <span className="ml-2 text-blue-700">{caseInfo.court || 'N/A'}</span>
                                        </div>
                                        <div>
                                            <span className="font-medium text-blue-800">Datum:</span>
                                            <span className="ml-2 text-blue-700">{caseInfo.date || 'N/A'}</span>
                                        </div>
                                        <div>
                                            <span className="font-medium text-blue-800">Dokumenti:</span>
                                            <span className="ml-2 text-blue-700">{documents.length} pronađen{documents.length === 1 ? '' : 'o'}</span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Documents Analysis */}
                            <div>
                                <h4 className="font-semibold text-slate-800 mb-4">
                                    Analiza dokumenata ({documents.length})
                                </h4>
                                {documents.length > 0 ? (
                                    <div className="space-y-4">
                                        {documents.map((doc, index) => (
                                            <DocumentAnalysis
                                                key={index}
                                                fileAnalysis={doc}
                                                index={index}
                                            />
                                        ))}
                                    </div>
                                ) : (
                                    <div className="text-center py-8 text-slate-500">
                                        <svg className="w-12 h-12 mx-auto mb-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        </svg>
                                        <p>Nema dokumenata za analizu</p>
                                    </div>
                                )}
                            </div>

                            {/* Final Summary */}
                            {finalSummary && (
                                <>
                                    {/* Final summary text with left border */}
                                    <div className="relative bg-slate-50 rounded-md p-4 overflow-hidden">
                                        <div className="absolute left-0 top-0 w-1 h-full bg-slate-300"></div>
                                        <div className="absolute left-0 top-0 w-1 h-full bg-gradient-to-b from-blue-400 via-blue-200 to-blue-400 animate-[scrollBorder_3s_linear_infinite]"></div>
                                        <h4 className="font-semibold text-slate-900 flex items-center gap-2 mb-2">
                                            <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    strokeWidth={2}
                                                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                                                />
                                            </svg>
                                            Zaključak
                                        </h4>
                                        <div className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                                            <ReactMarkdown>{finalSummary}</ReactMarkdown>
                                        </div>
                                    </div>

                                    {/* Buttons BELOW the summary block */}
                                    <div className="mt-3 flex justify-end gap-4">
                                        {originalFileUrl && (
                                            <a
                                                href={originalFileUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-slate-600 text-sm hover:underline"
                                            >
                                                ⬇ Preuzmi izvorne datoteke – {originalFileText}
                                            </a>
                                        )}

                                        <button
                                            onClick={() => downloadFinalSummary(finalSummary, caseInfo?.caseNumber)}
                                            className="text-blue-600 text-sm hover:underline"
                                        >
                                            ⬇ Preuzmi zaključak kao .md datoteku
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    ) : (
                        <div className="text-center py-12">
                            <svg className="w-16 h-16 mx-auto mb-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <h4 className="text-lg font-medium text-slate-800 mb-2">Nema rezultata</h4>
                            <p className="text-slate-600">Analiza nije uspješno završena ili nema podataka za prikaz.</p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex justify-end p-6 border-t border-slate-200">
                    <button
                        onClick={onClose}
                        className="px-6 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 transition-colors"
                    >
                        Zatvori
                    </button>
                </div>
            </div>
        </div>
    );
}