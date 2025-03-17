import React from 'react';

const WelcomeModal = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
        <h3 className="text-xl font-medium mb-3">Dobrodošli na Alimentacija.info</h3>
        <p className="text-slate-600 mb-4">
          Alimentacija.info je besplatna usluga koja omogućava pristup osnovnim pravnim informacijama i smjernicama vezanim uz razna pravna područja.
        </p>
        <p className="text-red-600 mb-4">
          S obzirom na besplatnu narav i tehnička ograničenja usluge moguće je čekanje od 30 sekundi na prvi odgovor asistenta.
        </p>
        <p className="text-slate-600 mb-4">
          Ova usluga pruža opće pravne informacije i ne predstavlja pravni savjet. Za konkretne pravne probleme obratite se kvalificiranom pravnom stručnjaku.
        </p>
        
        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            Razumijem
          </button>
        </div>
      </div>
    </div>
  );
};

export default WelcomeModal;