import React from 'react';
import DashboardShell from './Dashboard/DashboardShell';

export default function PrivacyPolicy() {
  return (
    <DashboardShell>
      <main className="mx-auto max-w-4xl px-4 py-8">
        <div className="card p-6">
          <h1 className="mb-6 text-2xl font-bold text-ink">Pravila privatnosti</h1>

          <section className="mb-8">
            <h2 className="mb-3 text-xl font-semibold text-ink">1. Uvod</h2>
            <p className="mb-3 text-ink-muted">
              Dobrodošli na Pravila privatnosti za uslugu alimentacija.info. Ova pravila opisuju kako prikupljamo, koristimo i štitimo vaše osobne podatke prilikom korištenja naše usluge.
            </p>
            <p className="text-ink-muted">
              Korištenjem usluge pristajete na prikupljanje i korištenje informacija u skladu s ovim pravilima privatnosti.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 text-xl font-semibold text-ink">2. Koje podatke prikupljamo</h2>
            <p className="mb-3 text-ink-muted">
              Prikupljamo sljedeće vrste podataka:
            </p>
            <ul className="mb-3 list-disc space-y-2 pl-6 text-ink-muted">
              <li>Upit za analizu koji unesete (OIB, broj predmeta ili tekstualni pojam)</li>
              <li>Rezultate analize javno dostupnih sudskih objava</li>
              <li>Osnovne podatke o korištenju usluge</li>
            </ul>
            <p className="text-ink-muted">
              Pokrenute analize i pripadajući događaji pohranjuju se lokalno na poslužitelju u obliku JSON datoteka radi prikaza povijesti analiza na nadzornoj ploči.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 text-xl font-semibold text-ink">3. Kako koristimo vaše podatke</h2>
            <p className="mb-3 text-ink-muted">
              Prikupljene podatke koristimo za:
            </p>
            <ul className="mb-3 list-disc space-y-2 pl-6 text-ink-muted">
              <li>Pružanje i održavanje usluge analize sudskih objava</li>
              <li>Prikaz povijesti pokrenutih analiza</li>
              <li>Poboljšanje korisničkog iskustva</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 text-xl font-semibold text-ink">4. Sigurnost podataka</h2>
            <p className="mb-3 text-ink-muted">
              Predani smo zaštiti vaših osobnih podataka. Implementirali smo odgovarajuće tehničke i organizacijske mjere kako bismo zaštitili vaše podatke.
            </p>
            <p className="text-ink-muted">
              Imajte na umu da nijedan način prijenosa putem interneta ili metoda elektroničke pohrane nije 100% siguran, pa iako koristimo komercijalno prihvatljiva sredstva za zaštitu vaših podataka, ne možemo jamčiti njihovu apsolutnu sigurnost.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 text-xl font-semibold text-ink">5. Ograničenje odgovornosti</h2>
            <p className="mb-3 text-ink-muted">
              Usluga pruža opće informacije o javno dostupnim sudskim objavama i ne predstavlja pravni savjet. Ne postoji odvjetničko-klijentski odnos između korisnika i pružatelja usluge.
            </p>
            <p className="text-ink-muted">
              Za konkretne pravne probleme i savjete prilagođene vašoj situaciji, obratite se kvalificiranom pravnom stručnjaku ili odvjetniku.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 text-xl font-semibold text-ink">6. Kolačići i tehnologije praćenja</h2>
            <p className="mb-3 text-ink-muted">
              Naša usluga može koristiti kolačiće za poboljšanje korisničkog iskustva i prikupljanje analitičkih podataka. Možete podesiti svoj preglednik da odbije sve kolačiće ili da vas upozori kada se kolačići šalju.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="mb-3 text-xl font-semibold text-ink">7. Izmjene ovih pravila privatnosti</h2>
            <p className="mb-3 text-ink-muted">
              Povremeno možemo ažurirati naša pravila privatnosti. Savjetujemo vam da povremeno pregledavate ovu stranicu za eventualne promjene.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-ink">8. Kontakt</h2>
            <p className="mb-3 text-ink-muted">
              Za sva pitanja, možete nas kontaktirati putem:
            </p>
            <p className="text-ink-muted">Email: admin@alimentacija.info</p>
          </section>
        </div>
      </main>
    </DashboardShell>
  );
}
