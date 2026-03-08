module.exports = {
  BUILDING_NAME: 'GWG Reutlingen',
  TOTAL_FLOORS: 7,
  ROOMS_PER_FLOOR: 16,
  MAX_BIN_ALERTS_PER_DAY: 5,

  BIN_TYPES: {
    restmuell: { label_de: 'Restmüll',              label_en: 'Residual waste',       short_de: 'Restmüll',   short_en: 'Residual',  emoji: '🗑️', color: '#616161' },
    papier:    { label_de: 'Papier',                 label_en: 'Paper',                short_de: 'Papier',     short_en: 'Paper',     emoji: '📦', color: '#1565C0' },
    verpackung:{ label_de: 'Verpackung/Wertstoff',   label_en: 'Packaging/Recyclables',short_de: 'Verpackung', short_en: 'Packaging', emoji: '♻️', color: '#F9A825' },
    biomuell:  { label_de: 'BioMüll',                label_en: 'Organic waste',        short_de: 'BioMüll',   short_en: 'Organic',   emoji: '🌿', color: '#2E7D32' },
  },

  /** Valid QR codes per floor (one code per floor) */
  QR_CODES: {
    1: 'IOMS-F1-2024',
    2: 'IOMS-F2-2024',
    3: 'IOMS-F3-2024',
    4: 'IOMS-F4-2024',
    5: 'IOMS-F5-2024',
    6: 'IOMS-F6-2024',
    7: 'IOMS-F7-2024',
  },

  /** Generate all room numbers for a floor */
  roomsForFloor(floorId) {
    return Array.from({ length: this.ROOMS_PER_FLOOR }, (_, i) => floorId * 100 + (i + 1));
  },
};
