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
              Alimentacija.info je usluga koja vam pruža pristup osnovnim pravnim informacijama i smjernicama vezanim uz obiteljsko, kazneno, porezno, radno i sva ostala prava definirana na području RH.
            </p>

            <p className="mb-3">
              Dobili ste prometnu kaznu ili poziv na sud? Razmatrate privatnu tužbu ili čekate ostavinski postupak? Radite prekovremeno bez dodatne naknade? Prolazite kroz razvod ili imate pitanja oko skrbništva?
            </p>

            <p className="mb-3">Naša usluga može vam pomoći da dobijete osnovne informacije i smjernice. Alat je koristan i za novinare koji žele pratiti sudski postupak.</p>
            <p className="mb-3">
              Zastupanje od strane odvjetnika, javni bilježnici, alimentacija i ugovori za nekretnine su teme koje ćemo rado pojasniti.
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
            <p className="mb-3">
              Vjerujemo da svatko zaslužuje pristup pravnim informacijama na jasan, razumljiv i pristupačan način.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-3">Kako koristiti pravnog asistenta</h2>
            <p className="mb-3">
              Naš asistent je intuitivno i jednostavno sučelje dizajnirano za brzo dobivanje informacija kroz razgovor i analizu javno dostupnih sudskih podataka. Na jednostavan način:
            </p>
            <ul className="pl-6 mb-3 space-y-2 list-items">
              <li>Postavite svoje pitanje u chat prozoru</li>
              <li>Ako je potrebno, priložite dokument ili sliku</li>
              <li>Dobijte trenutni odgovor s relevantnim pravnim informacijama</li>
              <li>Dodatno istražite temu postavljanjem potpitanja</li>
              <li>Razgovor se automatski pohranjuje lokalno u vašem pregledniku dok ga ne izbrišete</li>
            </ul>
            <p className="mb-3">
              Usluga je potpuno besplatna i dostupna 24/7, bez potrebe za registracijom ili ostavljanjem osobnih podataka.
            </p>
          </section>

          <section className="mb-8">

            <div className="bg-indigo-100 p-6 rounded-lg shadow-md ring ring-indigo-100">
              <h2 className="font-bold mb-3">Za znatiželjne i za profesionalce <span className="text-2xl">🤓</span></h2>
              <h4 className="mb-3">Automatizirana analiza  i praćenje sudskih objava!</h4>
              <p className="mb-3">
                Unesite odgovarajući pojam za pretragu u okvir sa desne strane, a naš asistent će pronaći relevantan sudski predmet na e-Oglasnoj ploči, preuzeti pripadajuću dokumentaciju, analizirati je i pružiti vam jasan i razumljiv sažetak cjelokupne objave.</p>
              <p className="mb-3">
                Nakon što unesete naziv pravnog subjekta, OIB ili oznaku sudskog postupka, naš sustav će automatski:
              </p>
              <ul className="pl-6 mb-3 space-y-2 list-items">
                <li>Pronaći najnoviju objavu vezanu uz postupak</li>
                <li>Preuzeti i analizirati sve dokumente iz objave</li>
                <li>Identificirati ključne informacije</li>
                <li>Pružiti vam jasan sažetak o trenutnom statusu postupka i što možete očekivati dalje</li>
              </ul>
              <h4 className="font-semibold mb-3">Želite pratiti tijek ovrhe ili stečajnog postupka?</h4>
              <p className="mb-3">
                <span className="text-base">✅</span> Ukoliko je naša tražilica uspješno pronašla sudski postupak po željenom terminu pretraživanja, na isti se na jednostavan način možete <b><em>pretplatiti.</em></b></p>
              <p className="mb-3">
                Jednostavno kliknite na gumb za zvoncem '<b>Prati ovaj OIB</b>' i unesite vašu e-mail adresu kako bi u vaš sandučić stizala obavijest sa novim detaljima iz sudskog postupka.</p>
              <p className="mb-3">
                Na jednostavan način pratite novosti u sudskom postupku i fokusirajte se na ključne informacije koje su vam potrebne za daljnje postupanje. Naš pravni asistent čita sa razumijevanjem.</p>
              <h4 className="font-semibold mb-3">Koga mogu pratiti?</h4>
              <p className="mb-3">
               Možete pratiti bilo koji pojam pretrage koji je javno dostupan na stranicama e-Oglasne ploče – ime i prezime fizičke osobe, njihov OIB, naziv tvrtke ili njen OIB, kao i konkretan broj sudskog predmeta.</p>
              <p className="mb-3">
                <i>*Usluga je predviđena za obradu javno dostupnih podataka. <a href="mailto:admin@alimentacija.info" className="text-blue-600 hover:underline">Kontaktirajte nas</a> za više pitanja.</i></p>
            </div>

          </section>

          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-3">Vrijednost ove usluge</h2>
            <p className="mb-3">
              Pravni asistent je potpuno besplatan za korištenje, no iza njega stoji rad i tehnologija.
            </p>
            <p className="mb-3">
              Tipična konzultacija s odvjetnikom može koštati između 50€ i 100€ po satu. Budući da naš asistent ne može zamijeniti osobni savjet odvjetnika ili pravni odnos, pokušati će vam pomoći u sljedećem:
            </p>
            <ul className="pl-6 mb-3 space-y-2 list-items-alt">
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
              Najbolji način da podržite naš rad je da podijelite Alimentacija.info sa svima kojima bi ova usluga mogla koristiti.
            </p>
          </section>

          <section className="mb-8">

            <div className="bg-indigo-100 p-6 rounded-lg shadow-md ring ring-indigo-100">
              <h4 className="text-xl font-semibold mb-3 text-end"><i class="fa-solid fa-circle-question"></i></h4>
              <p className="mb-3">
                Želite uvesti pametnog asistenta u vlastito poslovanje na GDPR sukladan način?
              </p>
              <p className="mb-3">
                Potrebna vam je analiza i obrada velike količine dokumenata sa povjerljivim informacijama?
              </p>
              <p className="mb-3">
                Kontaktirajte nas putem e-mail adrese: <a href="mailto:admin@alimentacija.info" className="text-blue-600 hover:underline">admin@alimentacija.info</a>
              </p>
              <p>
                Cijenimo vaše povratne informacije jer nam pomažu da unaprijedimo uslugu.
              </p>
            </div>
          </section>
        </div>
      </div>

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
  );
}