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

  /**
   * Rooms X08 and X09 are one combined room → stored as X08, labelled "X08/X09".
   * Rooms X10 and X11 are one combined room → stored as X10, labelled "X10/X11".
   */
  roomLabel(roomId) {
    const last2 = roomId % 100;
    if (last2 === 8 || last2 === 10) return `${roomId}/${roomId + 1}`;
    return String(roomId);
  },

  /** Generate all active room IDs for a floor (X09 and X11 are merged, not listed) */
  roomsForFloor(floorId) {
    const rooms = [];
    for (let i = 1; i <= 16; i++) {
      if (i === 9 || i === 11) continue; // merged into X08/X09 and X10/X11
      rooms.push(floorId * 100 + i);
    }
    return rooms;
  },
};
