import React from 'react';
import DashboardShell from './Dashboard/DashboardShell';

export default function AboutUs() {
  return (
    <DashboardShell>
      <main className="mx-auto max-w-4xl px-4 py-8">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
          <h1 className="mb-6 text-2xl font-bold text-[var(--text)]">O nama</h1>

          <section className="mb-8">
            <h2 className="mb-3 text-xl font-semibold text-[var(--text)]">Tko smo mi</h2>
            <p className="mb-3 text-[var(--text-muted)]">
              Alimentacija.info je usluga koja vam pruža pristup analizi javno dostupnih sudskih objava s hrvatske e-Oglasne ploče.
            </p>
            <p className="mb-3 text-[var(--text-muted)]">
              Naš alat automatski pretražuje službene objave, preuzima pripadajuću dokumentaciju i koristi AI modele kako bi je sažeo u jasan i razumljiv pregled tijeka predmeta.
            </p>
            <p className="text-[var(--text-muted)]">
              Usluga je korisna i za novinare i pravne profesionalce koji žele pratiti sudske postupke, kao i za građane koji žele bolje razumjeti javno dostupne informacije.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 text-xl font-semibold text-[var(--text)]">Naša misija</h2>
            <p className="mb-3 text-[var(--text-muted)]">
              Cilj ove stranice je demokratizirati pristup pravnim informacijama i pomoći svima da bolje razumiju svoja prava i obveze definirane zakonima RH.
            </p>
            <p className="mb-3 text-[var(--text-muted)]">
              Želimo premostiti jaz između složenog pravnog sustava i svakodnevnih potreba građana, nudeći pristupačan alat koji može analizirati sudski predmet i pružiti smjernice za daljnje djelovanje.
            </p>
            <p className="text-[var(--text-muted)]">
              Vjerujemo da svatko zaslužuje pristup pravnim informacijama na jasan, razumljiv i pristupačan način.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 text-xl font-semibold text-[var(--text)]">Kako koristiti uslugu</h2>
            <p className="mb-3 text-[var(--text-muted)]">
              Usluga je jednostavna za korištenje:
            </p>
            <ul className="mb-3 space-y-2 list-disc pl-6 text-[var(--text-muted)]">
              <li>Unesite OIB, broj predmeta ili tekstualni pojam za pretragu</li>
              <li>Sustav pretražuje javno dostupne objave na e-Oglasnoj ploči</li>
              <li>Preuzima i analizira pripadajuću dokumentaciju</li>
              <li>Prikazuje jasan sažetak tijeka predmeta s vremenskom crtom</li>
            </ul>
            <p className="text-[var(--text-muted)]">
              Pokrenute analize vidljive su na nadzornoj ploči, gdje možete pratiti napredak obrade i pregledati rezultate.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 text-xl font-semibold text-[var(--text)]">Vrijednost ove usluge</h2>
            <p className="mb-3 text-[var(--text-muted)]">
              Usluga je potpuno besplatna za korištenje, no iza nje stoji rad i tehnologija.
            </p>
            <p className="mb-3 text-[var(--text-muted)]">
              Naš alat vam može pomoći u sljedećem:
            </p>
            <ul className="mb-3 space-y-2 list-disc pl-6 text-[var(--text-muted)]">
              <li>Bolje razumjeti svoj pravni predmet prije traženja profesionalne pomoći</li>
              <li>Upoznati se s tijekom postupka na temelju javno dostupnih informacija</li>
              <li>Pripremiti se za razgovor s odvjetnikom, čime možete uštedjeti vrijeme i novac</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 text-xl font-semibold text-[var(--text)]">Ograničenja i odgovornost</h2>
            <p className="mb-3 text-[var(--text-muted)]">
              Važno je razumjeti da usluga pruža opće informacije o javno dostupnim sudskim objavama i ne predstavlja pravni savjet. Ne postoji odvjetničko-klijentski odnos između korisnika i pružatelja usluge.
            </p>
            <p className="mb-3 text-[var(--text-muted)]">
              Za konkretne pravne probleme i savjete prilagođene vašoj situaciji, uvijek preporučujemo da se obratite kvalificiranom pravnom stručnjaku ili odvjetniku.
            </p>
            <p className="text-[var(--text-muted)]">
              Naš alat se neprestano usavršava, ali može pogriješiti. Uvijek provjerite važne informacije iz vjerodostojnih izvora.
            </p>
          </section>

          <section>
            <div className="rounded-xl bg-indigo-100 p-6 ring ring-indigo-100">
              <h4 className="mb-3 text-xl font-semibold text-[var(--text)]">Kontakt</h4>
              <p className="mb-3 text-[var(--text-muted)]">
                Želite uvesti pametnog asistenta u vlastito poslovanje na GDPR sukladan način? Potrebna vam je analiza i obrada velike količine dokumenata s povjerljivim informacijama?
              </p>
              <p className="mb-3 text-[var(--text-muted)]">
                Kontaktirajte nas putem e-mail adrese: <a href="mailto:admin@alimentacija.info" className="text-blue-600 hover:underline">admin@alimentacija.info</a>
              </p>
              <p className="text-[var(--text-muted)]">
                Cijenimo vaše povratne informacije jer nam pomažu da unaprijedimo uslugu.
              </p>
            </div>
          </section>
        </div>
      </main>
    </DashboardShell>
  );
}
