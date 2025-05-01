import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';

// Common class name for sections to be counted
const SECTION_CLASS = 'scroll-section';

export default function AboutUs() {
  const [activeSection, setActiveSection] = useState(0);
  const [totalSections, setTotalSections] = useState(0);
  const containerRef = useRef(null);
  const isScrolling = useRef(false);
  const scrollTimeoutRef = useRef(null); // Ref for scroll timeout to properly clean up
  const sectionRefs = useRef([]); // Store references to each section

  // Effect to count sections after initial render and adjust container scroll properties
  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      const sectionElements = container.querySelectorAll(`.${SECTION_CLASS}`);
      setTotalSections(sectionElements.length);
      
      // Store references to each section element
      sectionRefs.current = Array.from(sectionElements);
      
      // Override any potential CSS that might interfere with scrolling
      container.style.overscrollBehaviorY = 'contain';
      
      // Center the first card in each section
      sectionRefs.current.forEach((section) => {
        const card = section.querySelector(".bg-white, .bg-slate-100");
        if (card) {
          section.style.display = "flex";
          section.style.flexDirection = "column";
          section.style.justifyContent = "center";
        }
      });
      
      // Force a tiny scroll after component mounts to ensure section detection works
      setTimeout(() => {
        container.scrollBy(0, 1);
        container.scrollBy(0, -1);
      }, 100);
    }
  }, []);

  // Improved scroll handler using IntersectionObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container || totalSections === 0 || sectionRefs.current.length === 0) return;

    // Create an IntersectionObserver to detect which section is most visible
    const observer = new IntersectionObserver(
      (entries) => {
        // Skip updating during controlled scrolls
        if (isScrolling.current) return;

        // Find the entry with the highest intersection ratio
        const mostVisibleEntry = entries.reduce((prev, current) => 
          (prev && prev.intersectionRatio > current.intersectionRatio) ? prev : current
        );
        
        if (mostVisibleEntry && mostVisibleEntry.intersectionRatio > 0.3) {
          const sectionIndex = sectionRefs.current.findIndex(
            section => section === mostVisibleEntry.target
          );
          if (sectionIndex !== -1 && sectionIndex !== activeSection) {
            setActiveSection(sectionIndex);
          }
        }
      },
      {
        root: container,
        threshold: [0.1, 0.3, 0.5, 0.7], // Multiple thresholds for better accuracy
        rootMargin: "0px"
      }
    );

    // Observe all sections
    sectionRefs.current.forEach(section => {
      observer.observe(section);
    });

    return () => {
      observer.disconnect();
    };
  }, [activeSection, totalSections]);

  // Manual scroll handler for backup and edge cases
  useEffect(() => {
    const container = containerRef.current;
    if (!container || totalSections === 0) return;

    const handleScroll = () => {
      if (isScrolling.current) return;

      // This is a backup method that uses scroll position
      const scrollPosition = container.scrollTop;
      const containerHeight = container.clientHeight;
      const scrollHeight = container.scrollHeight;
      const containerCenter = scrollPosition + containerHeight / 2;

      // Handle special case for the last section (bottom of page)
      if (scrollPosition + containerHeight >= scrollHeight - 20) {
        if (activeSection !== totalSections - 1) {
          setActiveSection(totalSections - 1);
        }
        return;
      }

      // For other positions, find the section whose center is closest to the container's center
      let closestSection = 0;
      let closestDistance = Infinity;

      sectionRefs.current.forEach((section, index) => {
        const sectionTop = section.offsetTop;
        const sectionHeight = section.offsetHeight;
        const sectionCenter = sectionTop + sectionHeight / 2;
        
        const distance = Math.abs(sectionCenter - containerCenter);
        
        if (distance < closestDistance) {
          closestDistance = distance;
          closestSection = index;
        }
      });

      if (closestSection !== activeSection) {
        setActiveSection(closestSection);
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [activeSection, totalSections]);

  const scrollToSection = (index) => {
    // Validate index and check if already at target or scrolling
    if (
      index < 0 || 
      index >= totalSections || 
      !containerRef.current || 
      isScrolling.current || 
      index === activeSection
    ) return;

    isScrolling.current = true;
    setActiveSection(index);

    const container = containerRef.current;
    
    // Use the actual offsetTop of the target section for more precise scrolling
    if (sectionRefs.current[index]) {
      const targetSection = sectionRefs.current[index];
      const targetTop = targetSection.offsetTop;
      
      // Get the container height and the card height
      const containerHeight = container.clientHeight;
      
      // Find the card element within the section
      const cardElement = targetSection.querySelector(".bg-white, .bg-slate-100");
      
      if (cardElement) {
        // Calculate the card's position relative to the section
        const cardOffset = cardElement.getBoundingClientRect().top - targetSection.getBoundingClientRect().top;
        
        // Calculate the offset needed to center the card in the viewport
        const cardHeight = cardElement.offsetHeight;
        const centerOffset = (containerHeight - cardHeight) / 2;
        
        // Scroll to position that centers the card
        container.scrollTo({
          top: targetTop + cardOffset - centerOffset,
          behavior: 'smooth'
        });
      } else {
        // Fallback to standard section scrolling if no card is found
        container.scrollTo({
          top: targetTop,
          behavior: 'smooth'
        });
      }
    }

    // Clear any existing timeout before setting a new one
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    // Set new timeout and store reference
    scrollTimeoutRef.current = setTimeout(() => {
      isScrolling.current = false;
      scrollTimeoutRef.current = null;
      
      // Double-check if we reached the intended section
      if (container) {
        const finalPosition = container.scrollTop;
        // If we're at the bottom of the container, make sure the last section is active
        if (finalPosition + container.clientHeight >= container.scrollHeight - 20) {
          setActiveSection(totalSections - 1);
        }
      }

      // Verify if we're at the correct section, and adjust if needed
      const actualSection = findActualSection(container.scrollTop);
      if (actualSection !== index) {
        setActiveSection(actualSection);
      }
    }, 1000); // Slightly longer timeout to ensure scroll completes
  };

  // Helper function to find which section we're actually on based on scroll position
  const findActualSection = (scrollTop) => {
    if (!sectionRefs.current.length) return 0;
    
    // Special case for bottom of page
    const container = containerRef.current;
    if (container && scrollTop + container.clientHeight >= container.scrollHeight - 20) {
      return totalSections - 1;
    }
    
    // Find the section whose top is closest to current scroll position
    let closestSection = 0;
    let closestDistance = Infinity;
    
    sectionRefs.current.forEach((section, index) => {
      const distance = Math.abs(section.offsetTop - scrollTop);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestSection = index;
      }
    });
    
    return closestSection;
  };

  // Wheel handler with improved logic
  useEffect(() => {
    const container = containerRef.current;
    if (!container || totalSections === 0) return;

    let wheelEvents = []; // Track recent wheel events for smoother experience
    let wheelTimeout = null;

    const handleWheel = (e) => {
      // Accumulate wheel events to detect intent
      wheelEvents.push(e.deltaY);
      
      // Clear old events
      if (wheelTimeout) {
        clearTimeout(wheelTimeout);
      }
      
      wheelTimeout = setTimeout(() => {
        wheelEvents = [];
      }, 200);
      
      // If we have enough events, process them
      if (wheelEvents.length >= 2) {
        // Determine direction from recent events (more reliable)
        const avgDelta = wheelEvents.reduce((sum, delta) => sum + delta, 0) / wheelEvents.length;
        
        // Only proceed if delta is significant
        if (Math.abs(avgDelta) < 15) return;
        
        // Prevent default behavior
        e.preventDefault();
        
        // Skip if already scrolling
        if (isScrolling.current) return;
        
        const direction = avgDelta > 0 ? 1 : -1;
        
        // Check boundaries
        if (activeSection === totalSections - 1 && direction > 0) {
          // Already at last section, do nothing or scroll to bottom
          if (container.scrollTop + container.clientHeight < container.scrollHeight - 5) {
            container.scrollTo({
              top: container.scrollHeight,
              behavior: 'smooth'
            });
          }
          return;
        }
        
        if (activeSection === 0 && direction < 0) {
          // Already at top, do nothing
          return;
        }
        
        // Calculate next section
        const nextSection = Math.min(
          totalSections - 1,
          Math.max(0, activeSection + direction)
        );
        
        if (nextSection !== activeSection) {
          // Clear wheel events to prevent multiple scrolls
          wheelEvents = [];
          scrollToSection(nextSection);
        }
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      container.removeEventListener('wheel', handleWheel);
      if (wheelTimeout) {
        clearTimeout(wheelTimeout);
      }
    };
  }, [activeSection, totalSections]);

  // Clean up scroll timeout on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="h-screen flex flex-col bg-slate-50">
      {/* Header */}
      <div className="bg-white p-4 shadow-sm border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <h1 className="text-slate-800 text-xl font-medium font-main">
            <Link to="/">Pravni Asistent</Link>
          </h1>
          <div className="flex gap-4 md:gap-6">
            <Link to="/" className="text-slate-600 hover:text-slate-800 transition-colors text-sm md:text-base">
              Povratak na chat
            </Link>
            <Link to="/pravila-privatnosti" className="text-slate-600 hover:text-slate-800 transition-colors text-sm md:text-base">
              Pravila privatnosti
            </Link>
          </div>
        </div>
      </div>

      {/* Main content container */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto scroll-smooth hide-scrollbar relative"
      >
        {/* Title Section (Section 0) */}
        <section className={`${SECTION_CLASS} bg-slate-50 min-h-[80vh] flex flex-col justify-center items-center p-4`}>
          <div className="max-w-2xl w-full py-1 text-center">
            <h3 className="text-xl md:text-2xl font-bold mb-4 text-slate-800">O nama</h3>
            <p className="text-slate-600 text-lg md:text-lg mb-8">
              Saznajte više o našoj usluzi i kako vam možemo pomoći.
            </p>
            <div className="flex justify-center">
              <button
                className="animate-bounce cursor-pointer p-2 rounded-full hover:bg-blue-100 transition-colors"
                onClick={() => scrollToSection(1)}
                aria-label="Scroll down to next section"
              >
                <svg className="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 14l-7 7m0 0l-7-7m7 7V3"></path>
                </svg>
              </button>
            </div>
          </div>
        </section>

        {/* Section 1: Tko smo mi */}
        <section className={`${SECTION_CLASS} bg-slate-50 min-h-[80vh] flex flex-col justify-center p-4`}>
          <div className="max-w-4xl mx-auto w-full py-1">
            <div className="bg-white rounded-lg shadow-md ring ring-slate-100 p-4 md:p-6">
              <h3 className="text-xl md:text-2xl font-semibold mb-3 text-slate-800">Tko smo mi</h3>
              <p className="mb-2 text-slate-700 text-base">
                Alimentacija.info je usluga koja vam pruža pristup osnovnim pravnim informacijama i smjernicama vezanim uz obiteljsko, kazneno, porezno, radno i sva ostala prava definirana na području RH.
              </p>
              <p className="mb-2 text-slate-700 text-base">
                Dobili ste prometnu kaznu ili poziv na sud? Razmatrate privatnu tužbu ili čekate ostavinski postupak? Traže da potpišete sporazumni otkaz? Radite prekovremeno bez dodatne naknade? Želite se razvesti ili imate pitanja oko skrbništva?
              </p>
              <p className="mb-2 text-slate-700 text-base">Naša usluga može vam pomoći da dobijete osnovne informacije i smjernice za dalje.</p>
              <p className="mb-2 text-slate-700 text-base">
                Niste sigurni kako napisati žalbu ili prigovor? Na koji način odgovoriti na dopis? Kako se ponašati na sudu? Doznajte koji je zakon trenutno važeći za dopis koji ste primili.
              </p>
              <p className="text-slate-700 text-base">
                Zastupanje od strane odvjetnika, javni bilježnici, alimentacija, ugovori za nekretnine, i ostalo su teme koje ćemo rado pojasniti.
              </p>
            </div>
          </div>
        </section>

        {/* Section 2: Naša misija */}
        <section className={`${SECTION_CLASS} bg-slate-50 min-h-[80vh] flex flex-col justify-center p-4`}>
          <div className="max-w-4xl mx-auto w-full py-1">
            <div className="bg-white rounded-lg shadow-md ring ring-slate-100 p-4 md:p-6">
              <h3 className="text-xl md:text-2xl font-semibold mb-3 text-slate-800">Naša misija</h3>
              <p className="mb-2 text-slate-700 text-base">
                Cilj ove stranice je demokratizirati pristup pravnim informacijama i pomoći svima da bolje razumiju svoja prava i obveze definirane zakonima RH.
              </p>
              <p className="mb-2 text-slate-700 text-base">
                Želimo premostiti jaz između složenog pravnog sustava i svakodnevnih potreba građana, nudeći pristupačan alat koji može odgovoriti na osnovna pravna pitanja i pružiti smjernice za daljnje djelovanje.
              </p>
              <p className="text-slate-700 text-base">
                Vjerujemo da svatko zaslužuje pristup pravnim informacijama na jasan, razumljiv i pristupačan način.
              </p>
            </div>
          </div>
        </section>

        {/* Section 3: Kako koristiti */}
        <section className={`${SECTION_CLASS} bg-slate-50 min-h-[80vh] flex flex-col justify-center p-4`}>
          <div className="max-w-4xl mx-auto w-full py-1">
            <div className="bg-white rounded-lg shadow-md ring ring-slate-100 p-4 md:p-6">
              <h3 className="text-xl md:text-2xl font-semibold mb-3 text-slate-800">Kako koristiti pravnog asistenta</h3>
              <p className="mb-2 text-slate-700 text-base">
                Naš pravni asistent je intuitivno i jednostavno sučelje dizajnirano za brzo dobivanje informacija kroz razgovor. Na jednostavan način:
              </p>
              <ul className="pl-5 mb-2 space-y-1 list-disc text-slate-700 text-base list-items">
                <li>Postavite svoje pitanje u chat prozoru</li>
                <li>Ako je potrebno, priložite dokument ili sliku</li>
                <li>Dobijte trenutni odgovor s relevantnim pravnim informacijama</li>
                <li>Dodatno istražite temu postavljanjem potpitanja</li>
                <li>Razgovor se automatski pohranjuje lokalno u vašem pregledniku dok ga ne izbrišete</li>
              </ul>
              <p className="text-slate-700 text-base">
                Usluga je potpuno besplatna i dostupna 24/7, bez potrebe za registracijom ili ostavljanjem osobnih podataka.
              </p>
            </div>
          </div>
        </section>

        {/* Section 4: Vrijednost usluge */}
        <section className={`${SECTION_CLASS} bg-slate-50 min-h-[80vh] flex flex-col justify-center p-4`}>
          <div className="max-w-4xl mx-auto w-full py-1">
            <div className="bg-white rounded-lg shadow-md ring ring-slate-100 p-4 md:p-6">
              <h3 className="text-xl md:text-2xl font-semibold mb-3 text-slate-800">Vrijednost ove usluge</h3>
              <p className="mb-2 text-slate-700 text-base">
                Pravni asistent je potpuno besplatan za korištenje, no iza njega stoji rad i tehnologija.
              </p>
              <p className="mb-2 text-slate-700 text-base">
                Tipična konzultacija s odvjetnikom može koštati između 50€ i 100€ po satu. Budući da naš asistent ne može zamijeniti osobni savjet odvjetnika ili pravni odnos, pokušati će vam pomoći u sljedećem:
              </p>
              <ul className="pl-5 mb-2 space-y-1 list-disc text-slate-700 text-base list-items-alt">
                <li>Bolje razumjeti svoje pravno pitanje prije traženja profesionalne pomoći</li>
                <li>Upoznati se s relevantnim zakonima i propisima</li>
                <li>Pripremiti se za razgovor s odvjetnikom, čime možete uštedjeti vrijeme i novac</li>
                <li>Razjasniti osnovne pravne pojmove i procedure</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Section 5: Ograničenja */}
        <section className={`${SECTION_CLASS} bg-slate-50 min-h-[80vh] flex flex-col justify-center p-4`}>
          <div className="max-w-4xl mx-auto w-full py-1">
            <div className="bg-white rounded-lg shadow-md ring ring-slate-100 p-4 md:p-6">
              <h3 className="text-xl md:text-2xl font-semibold mb-3 text-slate-800">Ograničenja i odgovornost</h3>
              <p className="mb-2 text-slate-700 text-base">
                Važno je razumjeti da Pravni Asistent pruža <strong className="font-medium">opće pravne informacije</strong> i ne predstavlja pravni savjet. Ne postoji odvjetničko-klijentski odnos između korisnika i pružatelja usluge.
              </p>
              <p className="mb-2 text-slate-700 text-base">
                Za konkretne pravne probleme i savjete prilagođene vašoj situaciji, uvijek preporučujemo da se obratite kvalificiranom pravnom stručnjaku ili odvjetniku.
              </p>
              <p className="text-slate-700 text-base">
                Naš asistent se neprestano usavršava, ali može pogriješiti. Uvijek provjerite važne informacije iz vjerodostojnih izvora.
              </p>
            </div>
          </div>
        </section>

        {/* Section 6: Podrška */}
        <section className={`${SECTION_CLASS} bg-slate-50 min-h-[80vh] flex flex-col justify-center p-4`}>
          <div className="max-w-4xl mx-auto w-full py-1">
            <div className="bg-white rounded-lg shadow-md ring ring-slate-100 p-4 md:p-6">
              <h3 className="text-xl md:text-2xl font-semibold mb-3 text-slate-800">Podržite naš rad</h3>
              <p className="mb-2 text-slate-700 text-base">
                Alimentacija.info planiramo održavati zahvaljujući oglasima. Omogućavanjem oglasa u vašem pregledniku pomažete nam da nastavimo pružati ovu uslugu besplatno.
              </p>
              <p className="text-slate-700 text-base">
                Najbolji način da podržite naš rad je da <strong className="font-medium">podijelite Alimentacija.info</strong> s prijateljima, obitelji, i svima ostalima kojima bi ova usluga mogla koristiti. Vaša preporuka nam puno znači!
              </p>
            </div>
          </div>
        </section>

        {/* Section 7: Contact */}
        <section className={`${SECTION_CLASS} bg-slate-50 min-h-[80vh] flex flex-col justify-center p-4`} id="contact-section">
          <div className="max-w-4xl mx-auto w-full py-1">
            <div className="bg-indigo-100 p-4 md:p-4 rounded-lg shadow-md ring ring-indigo-100">
              <h3 className="text-xl md:text-2xl font-semibold mb-3 text-slate-800">Kontaktirajte nas</h3>
              <p className="mb-2 text-slate-700 text-base">
                Imate prijedlog za poboljšanje? Uočili ste pogrešku? Želite nam poslati pohvalu?
              </p>
              <p className="mb-2 text-slate-700 text-base">
                Želite uvesti pametnog asistenta u vlastito poslovanje?
              </p>
              <p className="mb-2 text-slate-700 text-base">
                Kontaktirajte nas putem e-mail adrese: <a href="mailto:admin@alimentacija.info" className="text-blue-600 hover:text-blue-700 hover:underline font-medium">admin@alimentacija.info</a>
              </p>
              <p className="text-slate-700 text-base">
                Cijenimo vaše povratne informacije jer nam pomažu da unaprijedimo uslugu.
              </p>
            </div>
          </div>
        </section>

        {/* Section 8: Final Links */}
        <section className={`${SECTION_CLASS} bg-slate-50 min-h-[80vh] flex flex-col justify-center items-center p-4`}>
          <div className="max-w-4xl w-full py-1 text-center">
            <div className="flex flex-col sm:flex-row justify-center items-center gap-4">
              <Link
                to="/"
                className="px-5 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors shadow-md"
              >
                Povratak na chat
              </Link>
              <Link
                to="/pravila-privatnosti"
                className="text-blue-500 hover:underline text-base"
              >
                Pročitajte Pravila privatnosti
              </Link>
            </div>
            <div
              className="mt-8 cursor-pointer p-2 rounded-full hover:bg-blue-100 transition-colors inline-block"
              onClick={() => scrollToSection(0)}
              aria-label="Scroll back to top"
            >
              <svg className="w-6 h-6 text-blue-500 transform rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 14l-7 7m0 0l-7-7m7 7V3"></path>
              </svg>
            </div>
          </div>
        </section>
      </div>

      {/* Navigation dots */}
      {totalSections > 0 && (
        <div className="fixed right-4 top-1/2 transform -translate-y-1/2 z-40 flex flex-col gap-2">
          {Array.from({ length: totalSections }).map((_, index) => (
            <button
              key={index}
              className={`w-2 h-2 rounded-full transition-all duration-300 ease-in-out ${
                activeSection === index
                  ? 'bg-blue-600 scale-125 ring-2 ring-blue-300 ring-offset-1 ring-offset-slate-50'
                  : 'bg-slate-300 hover:bg-slate-400 hover:scale-110'
              }`}
              onClick={() => scrollToSection(index)}
              aria-label={`Idi na sekciju ${index + 1}`}
              aria-current={activeSection === index ? 'step' : undefined}
            />
          ))}
        </div>
      )}

      {/* Footer */}
      <footer className="bg-white p-4 border-t border-slate-200 mt-auto">
        <div className="max-w-4xl mx-auto text-center text-slate-600 text-sm">
          <p>© {new Date().getFullYear()} Alimentacija.info | Pravni Asistent</p>
          <p className="mt-1">
            Sve informacije pružene putem ove usluge su informativne prirode i ne predstavljaju pravni savjet.
          </p>
        </div>
      </footer>

      {/* CSS */}
      <style jsx global>{`
        .hide-scrollbar {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }
        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
        
        .animate-bounce {
          animation: bounce 1.5s ease-in-out infinite;
        }
        
        @keyframes bounce {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-15%);
          }
        }
      `}</style>
    </div>
  );
}