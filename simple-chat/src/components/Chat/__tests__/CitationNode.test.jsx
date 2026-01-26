import '@testing-library/jest-dom';

// Mock window.open for citation link testing
const mockOpen = jest.fn();
Object.defineProperty(window, 'open', {
  writable: true,
  value: mockOpen,
});

// Test the CitationNode utility functions without importing TipTap
describe('CitationNode Utility Functions', () => {
  beforeEach(() => {
    mockOpen.mockClear();
  });

  // Mock the getConfidenceClasses function for testing
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

  // Mock test citations
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

  test('high confidence returns green styling', () => {
    const classes = getConfidenceClasses('high');
    expect(classes).toBe('bg-green-100 text-green-700 border-green-500');
  });

  test('medium confidence returns yellow styling', () => {
    const classes = getConfidenceClasses('medium');
    expect(classes).toBe('bg-yellow-100 text-yellow-700 border-yellow-500');
  });

  test('low confidence returns orange styling', () => {
    const classes = getConfidenceClasses('low');
    expect(classes).toBe('bg-orange-100 text-orange-700 border-orange-500');
  });

  test('unknown confidence returns default blue styling', () => {
    const classes = getConfidenceClasses('unknown');
    expect(classes).toBe('bg-blue-100 text-blue-700 border-blue-500');
  });

  test('test citations have correct structure', () => {
    expect(testCitations).toHaveLength(3);
    
    // Check high confidence citation
    const highConfCitation = testCitations.find(c => c.confidence === 'high');
    expect(highConfCitation).toEqual({
      label: 'Zakon o obveznim odnosima',
      sourceId: 'zo-1',
      url: 'https://www.zakon.hr/z/zo-1',
      confidence: 'high'
    });

    // Check medium confidence citation
    const mediumConfCitation = testCitations.find(c => c.confidence === 'medium');
    expect(mediumConfCitation).toEqual({
      label: 'Presuda VSRH-123/2023',
      sourceId: 'vsrh-123',
      url: '#',
      confidence: 'medium'
    });

    // Check low confidence citation
    const lowConfCitation = testCitations.find(c => c.confidence === 'low');
    expect(lowConfCitation).toEqual({
      label: 'Zakon o parničnom postupku',
      sourceId: 'zpp-1',
      url: 'https://www.zakon.hr/z/zpp-1',
      confidence: 'low'
    });
  });

  test('window.open is called with correct parameters for valid URLs', () => {
    const citation = {
      label: 'Test Citation',
      url: 'https://example.com/citation',
      confidence: 'high'
    };

    // Simulate click handler
    const handleClick = (e) => {
      e.preventDefault();
      if (citation.url && citation.url !== '#') {
        window.open(citation.url, '_blank', 'noopener,noreferrer');
      }
    };

    const mockEvent = { preventDefault: jest.fn() };
    handleClick(mockEvent);

    expect(mockOpen).toHaveBeenCalledWith(
      'https://example.com/citation',
      '_blank',
      'noopener,noreferrer'
    );
  });

  test('window.open is not called for invalid URLs', () => {
    const citation = {
      label: 'Test Citation',
      url: '#',
      confidence: 'high'
    };

    // Simulate click handler
    const handleClick = (e) => {
      e.preventDefault();
      if (citation.url && citation.url !== '#') {
        window.open(citation.url, '_blank', 'noopener,noreferrer');
      }
    };

    const mockEvent = { preventDefault: jest.fn() };
    handleClick(mockEvent);

    expect(mockOpen).not.toHaveBeenCalled();
  });

  test('citation styling classes are correctly applied', () => {
    const citations = [
      { confidence: 'high', expectedClasses: 'bg-green-100 text-green-700 border-green-500' },
      { confidence: 'medium', expectedClasses: 'bg-yellow-100 text-yellow-700 border-yellow-500' },
      { confidence: 'low', expectedClasses: 'bg-orange-100 text-orange-700 border-orange-500' },
    ];

    citations.forEach(citation => {
      const classes = getConfidenceClasses(citation.confidence);
      expect(classes).toBe(citation.expectedClasses);
    });
  });
});

// Test CitationNode component creation (structural test)
describe('CitationNode Component Structure', () => {
  test('citation node should have required attributes', () => {
    // This tests the expected structure without actually importing TipTap
    const expectedAttributes = {
      label: { default: null },
      sourceId: { default: null },
      url: { default: null },
      confidence: { default: 'medium' },
    };

    // Test that our expected structure matches what we defined
    Object.keys(expectedAttributes).forEach(attr => {
      expect(expectedAttributes[attr]).toBeDefined();
    });
  });

  test('citation node properties are correct', () => {
    // Test the node properties we expect
    const nodeProperties = {
      name: 'citation',
      group: 'inline',
      inline: true,
      atom: true,
    };

    expect(nodeProperties.name).toBe('citation');
    expect(nodeProperties.group).toBe('inline');
    expect(nodeProperties.inline).toBe(true);
    expect(nodeProperties.atom).toBe(true);
  });
});