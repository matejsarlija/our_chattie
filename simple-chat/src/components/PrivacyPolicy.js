import React from 'react';

export default function PrivacyPolicy() {
  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      {/* Header - same as main app for consistency */}
      <div className="bg-white p-4 shadow-sm border-b border-slate-200">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <h1 className="text-slate-800 text-xl font-medium font-main">
            Pravni Asistent
          </h1>
          <div className="flex gap-6">
            <a href="/" className="text-slate-600 hover:text-slate-800 transition-colors">
              Povratak na chat
            </a>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1">
        <div className="max-w-4xl mx-auto p-6 my-8 bg-white rounded-lg shadow-sm border border-slate-100">
          <h1 className="text-2xl font-bold mb-6">Pravila privatnosti</h1>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-3">1. Uvod</h2>
            <p className="mb-3">
              Dobrodošli na Pravila privatnosti za pravnog asistenta i web-stranicu alimentacija.info. Ova pravila opisuju kako prikupljamo, koristimo i štitimo vaše osobne podatke prilikom korištenja naše usluge.
            </p>
            <p>
              Korištenjem Pravnog Asistenta pristajete na prikupljanje i korištenje informacija u skladu s ovim pravilima privatnosti.
            </p>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-3">2. Koje podatke prikupljamo</h2>
            <p className="mb-3">
              Prikupljamo sljedeće vrste podataka:
            </p>
            <ul className="list-disc pl-6 mb-3 space-y-2">
              <li>Tekstualni sadržaj vaših razgovora s Pravnim Asistentom</li>
              <li>Postavke korisničkog sučelja (kao što je veličina teksta)</li>
              <li>Osnovne podatke o korištenju usluge</li>
            </ul>
            <p>
              Razgovori se pohranjuju lokalno u vašem pregledniku putem funkcionalosti samog preglednika, s ograničenjem na posljednjih 50 poruka.
            </p>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-3">3. Kako koristimo vaše podatke</h2>
            <p className="mb-3">
              Prikupljene podatke koristimo za:
            </p>
            <ul className="list-disc pl-6 mb-3 space-y-2">
              <li>Pružanje i održavanje usluge pravnog asistenta</li>
              <li>Poboljšanje korisničkog iskustva</li>
              <li>Spremanje vaših preferenci (npr. veličina teksta)</li>
              <li>Analiziranje korištenja usluge kako bismo je unaprijedili</li>
            </ul>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-3">4. Sigurnost podataka</h2>
            <p className="mb-3">
              Predani smo zaštiti vaših osobnih podataka. Implementirali smo odgovarajuće tehničke i organizacijske mjere kako bismo zaštitili vaše podatke.
            </p>
            <p>
              Imajte na umu da nijedan način prijenosa putem interneta ili metoda elektroničke pohrane nije 100% siguran, pa iako koristimo komercijalno prihvatljiva sredstva za zaštitu vaših podataka, ne možemo jamčiti njihovu apsolutnu sigurnost.
            </p>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-3">5. Ograničenje odgovornosti</h2>
            <p className="mb-3">
              Pravni Asistent pruža opće pravne informacije i ne predstavlja pravni savjet. Ne postoji odvjetničko-klijentski odnos između korisnika i pružatelja usluge.
            </p>
            <p>
              Za konkretne pravne probleme i savjete prilagođene vašoj situaciji, obratite se kvalificiranom pravnom stručnjaku ili odvjetniku.
            </p>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-3">6. Kolačići i tehnologije praćenja</h2>
            <p className="mb-3">
              Naša usluga može koristiti kolačiće za poboljšanje korisničkog iskustva i prikupljanje analitičkih podataka. Možete podesiti svoj preglednik da odbije sve kolačiće ili da vas upozori kada se kolačići šalju.
            </p>
          </section>
          
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-3">7. Izmjene ovih pravila privatnosti</h2>
            <p className="mb-3">
              Povremeno možemo ažurirati naša pravila privatnosti. Savjetujemo vam da povremeno pregledavate ovu stranicu za eventualne promjene.
            </p>
          </section>
          
          <section>
            <h2 className="text-xl font-semibold mb-3">8. Kontakt</h2>
            <p className="mb-3">
              Za sva pitanja, možete nas kontaktirati putem:
            </p>
            <p>Email: admin@alimentacija.info</p>
          </section>
        </div>
      </div>
    </div>
  );
}