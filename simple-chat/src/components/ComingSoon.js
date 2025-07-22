import React from 'react';
import { Link } from 'react-router-dom';

export default function ComingSoon() {
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
            <h1 className="text-2xl font-bold mb-6">Coming soon</h1>
            
            <section className="mb-8">
                <p className="mb-3">
                Ova stranica je trenutno u razvoju.
                </p>
                <p className="mb-3">
                U međuvremenu, slobodno se vratite na našu glavnu stranicu ili nas kontaktirajte ako imate bilo kakvih pitanja.
                </p>
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