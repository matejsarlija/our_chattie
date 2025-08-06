import React from 'react';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';

const WelcomeModal = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 md:mx-auto overflow-hidden">
        <div className="p-6">
          <h3 className="text-lg md:text-xl font-semibold mb-3 text-slate-800">
            Dobrodošli na Alimentacija.info
          </h3>

          <div className="space-y-4 text-sm md:text-base">
            <p className="text-slate-600">
              Alimentacija.info je besplatna usluga koja omogućava pristup osnovnim pravnim informacijama i smjernicama vezanim uz razna pravna područja.
            </p>

            <div className="bg-yellow-50 border border-yellow-200 p-3 rounded-md">
              <div className="flex items-center space-x-3">
                <ExclamationTriangleIcon className="w-5 h-5 text-yellow-700 flex-shrink-0" />
                <p className="text-yellow-700 text-sm">
                  S obzirom na besplatnu narav i tehnička ograničenja usluge, moguće je čekanje od 30 sekundi na prvi odgovor asistenta.
                </p>
              </div>
            </div>

            <p className="text-slate-600">
              Ova usluga pruža opće pravne informacije i ne predstavlja pravni savjet. Za konkretne pravne probleme obratite se kvalificiranom pravnom stručnjaku.
            </p>
          </div>
        </div>

        <div className="bg-slate-50 px-6 py-4 flex justify-end border-t border-slate-200">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm md:text-base transition-colors"
          >
            Razumijem
          </button>
        </div>
      </div>
    </div>
  );
};

export default WelcomeModal;