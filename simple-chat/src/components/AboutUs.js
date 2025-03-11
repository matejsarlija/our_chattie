import React from 'react';
import { Link } from 'react-router-dom';

export default function AboutUs() {
  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      {/* Header - same as main app for consistency */}
      <div className="bg-white p-4 shadow-sm border-b border-slate-200">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <h1 className="text-slate-800 text-xl font-medium font-main">
          <Link to="/">
                        Pravni Asistent
                        </Link>
          </h1>
          <div className="flex gap-6">
            <Link to="/" className="text-slate-600 hover:text-slate-800 transition-colors">
              Povratak na chat
            </Link>
            <Link to="/pravila-privatnosti" className="text-slate-600 hover:text-slate-800 transition-colors">
              Pravila privatnosti
            </Link>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1">
        <div className="max-w-4xl mx-auto p-6 my-8 bg-white rounded-lg shadow-sm border border-slate-100">
          <h1 className="text-2xl font-bold mb-6">O nama</h1>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-3">Tko smo mi</h2>
            <p className="mb-3">
              Alimentacija.info je besplatna usluga koja svima pruža pristup osnovnim pravnim informacijama i smjernicama vezanim uz obiteljsko, kazneno, radno i sva ostala prava definirana na području Republike Hrvatske. Pokrivamo teme od skrbništva, alimentacije i privatnih tužbi do radnih odnosa, poreza, nekretnina i poslovnih transakcija. i sva druga pitanja koja utječu na svakodnevan život.
            </p>
            <p className="mb-3">
              Vjerujemo da svatko zaslužuje pristup pravnim informacijama na jasan, razumljiv i pristupačan način, bez obzira na njihovu financijsku situaciju.
            </p>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-3">Naša misija</h2>
            <p className="mb-3">
              Cilj ove stranice je demokratizirati pristup pravnim informacijama i pomoći svima da bolje razumiju svoja prava i obveze definirane zakonima RH.
            </p>
            <p className="mb-3">
              Želimo premostiti jaz između složenog pravnog sustava i svakodnevnih potreba građana, nudeći pristupačan alat koji može odgovoriti na osnovna pravna pitanja i pružiti smjernice za daljnje djelovanje.
            </p>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-3">Kako koristiti pravnog asistenta</h2>
            <p className="mb-3">
              Naš pravni asistent je intuitivno i jednostavno sučelje dizajnirano za brzo dobivanje informacija kroz razgovor. Na jednostavan način:
            </p>
            <ul className="list-disc pl-6 mb-3 space-y-2">
              <li>Postavite svoje pitanje u chat prozoru</li>
              <li>Dobijte trenutni odgovor s relevantnim pravnim informacijama</li>
              <li>Dodatno istražite temu postavljanjem potpitanja</li>
              <li>Razgovor se automatski pohranjuje lokalno u vašem pregledniku dok ga ne izbrišete</li>
            </ul>
            <p className="mb-3">
              Usluga je potpuno besplatna i dostupna 24/7, bez potrebe za registracijom ili ostavljanjem osobnih podataka.
            </p>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-3">Vrijednost naše usluge</h2>
            <p className="mb-3">
              Iako je pravni asistent potpuno besplatan za korištenje, važno je napomenuti da iza njega stoji rad i tehnologija. Naš cilj je održavati ovu uslugu besplatnom kroz prihode od oglasa, te omogućiti svima pristup bez financijskih prepreka.
            </p>
            <p className="mb-3">
              Tipična konzultacija s odvjetnikom može koštati između 50€ i 100€ po satu. Budući da naš asistent ne može zamijeniti osobni savjet odvjetnika ili pravni odnos, pokušati će vam pomoći u sljedećem:
            </p>
            <ul className="list-disc pl-6 mb-3 space-y-2">
              <li>Bolje razumjeti svoje pravno pitanje prije traženja profesionalne pomoći</li>
              <li>Upoznati se s relevantnim zakonima i propisima</li>
              <li>Pripremiti se za razgovor s odvjetnikom, čime možete uštedjeti vrijeme i novac</li>
              <li>Razjasniti osnovne pravne pojmove i procedure</li>
            </ul>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-3">Ograničenja i odgovornost</h2>
            <p className="mb-3">
              Važno je razumjeti da Pravni Asistent pruža opće pravne informacije i ne predstavlja pravni savjet. Ne postoji odvjetničko-klijentski odnos između korisnika i pružatelja usluge.
            </p>
            <p className="mb-3">
              Za konkretne pravne probleme i savjete prilagođene vašoj situaciji, uvijek preporučujemo da se obratite kvalificiranom pravnom stručnjaku ili odvjetniku.
            </p>
            <p className="mb-3">
              Naš asistent se neprestano usavršava, ali može pogriješiti. Uvijek provjerite važne informacije iz vjerodostojnih izvora.
            </p>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-3">Podržite naš rad</h2>
            <p className="mb-3">
              Alimentacija.info planiramo održavati zahvaljujući oglasima. Omogućavanjem oglasa u vašem pregledniku pomažete nam da nastavimo pružati ovu uslugu.
            </p>
            <p className="mb-3">
              Najbolji način da podržite naš rad je da podijelite Alimentacija.info s prijateljima, obitelji, kolegama i svima ostalima kojima bi ova usluga mogla koristiti.
            </p>
          </section>
          
          <section>
            <h2 className="text-xl font-semibold mb-3">Kontaktirajte nas</h2>
            <p className="mb-3">
              Imate prijedlog za poboljšanje? Uočili ste pogrešku? Želite nam poslati pohvalu?
            </p>
            <p className="mb-3">
              Kontaktirajte nas putem email adrese: <span className="text-blue-600">admin@alimentacija.info</span>
            </p>
            <p>
              Cijenimo sve vaše povratne informacije jer nam pomažu da unaprijedimo našu uslugu i učinimo je još korisnijim alatom za sve građane.
            </p>
          </section>
        </div>
      </div>

      {/* Footer */}
      <footer className="bg-white p-4 border-t border-slate-200 mt-auto">
        <div className="max-w-4xl mx-auto text-center text-slate-600 text-sm">
          <p>© {new Date().getFullYear()} Alimentacija.info | Pravni Asistent</p>
          <p className="mt-1">
            Sve informacije pružene putem ove usluge su informativne prirode i ne predstavljaju pravni savjet.
          </p>
        </div>
      </footer>
    </div>
  );
}