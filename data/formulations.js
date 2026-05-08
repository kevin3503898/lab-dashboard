// Pre-fetched from Notion: PVP/beta-CD/AzoIL project > 比例 page
const formulations = [
  {
    id: 'initial',
    date: null,
    dateLabel: '初始配方',
    system: 'AA/PVP',
    description: '基礎 AA/PVP 比例探索（無 AzoIL）',
    entries: [
      { components: { 'Acrylic Acid (g)': 1.0368, 'PVP (mg)': 800, 'I2959 (mg)': 9.2 },  notes: 'AA:PVP=2:1 mol%, I2959 0.5wt% of DES', result: null },
      { components: { 'Acrylic Acid (g)': 1.5552, 'PVP (mg)': 800, 'I2959 (mg)': 11.8 }, notes: 'AA:PVP=3:1 mol%', result: null },
      { components: { 'Acrylic Acid (g)': 2.0736, 'PVP (mg)': 800, 'I2959 (mg)': 14.4 }, notes: 'AA:PVP=4:1 mol%', result: null },
      { components: { 'Acrylic Acid (g)': 2.592,  'PVP (mg)': 800, 'I2959 (mg)': 17.0 }, notes: 'AA:PVP=5:1 mol%', result: null },
    ],
  },
  {
    id: '0128',
    date: '2026-01-28',
    dateLabel: '1/28',
    system: 'AA/PVP/AzoIL',
    description: '引入 AzoIL 的初步嘗試',
    entries: [
      { components: { 'Acrylic Acid (g)': 1.0368, 'PVP (mg)': 400, 'AzoIL (mg)': 'x=50/30/10', 'I2959 (mg)': 7.2 }, notes: 'AA:PVP=4:1 mol%', result: 'fail', resultNote: '狗骨頭照光 1.5 hr → 沒聚起來' },
      { components: { 'Acrylic Acid (g)': 1.0368, 'PVP (mg)': 400, 'AzoIL (mg)': 'x=100',     'I2959 (mg)': 7.2 }, notes: 'AA:PVP=4:1 mol%', result: 'fail', resultNote: '沒聚過' },
    ],
  },
  {
    id: '0129a',
    date: '2026-01-29',
    dateLabel: '1/29 (a)',
    system: 'AA/PVP/AzoIL',
    description: '調整 I2959 用量（1 & 3 wt%）',
    entries: [
      { components: { 'Acrylic Acid (g)': 1.0368, 'PVP (mg)': 400, 'AzoIL (mg)': 10, 'I2959 (mg)': 14.4 }, notes: '4:1 mol%, I2959 1wt%', result: 'success', resultNote: '照光 1.5 hr 聚起來' },
      { components: { 'Acrylic Acid (g)': 1.0368, 'PVP (mg)': 400, 'AzoIL (mg)': 10, 'I2959 (mg)': 43.2 }, notes: '4:1 mol%, I2959 3wt%', result: 'success', resultNote: '照光 1.5 hr 聚起來' },
    ],
  },
  {
    id: '0129b',
    date: '2026-01-29',
    dateLabel: '1/29 (b)',
    system: 'AA+PVP/AzoIL',
    description: 'AA+PVP 預混，系統性調整 I2959',
    entries: [
      { components: { 'AA+PVP (g)': 1.4368, 'AzoIL (mg)': 10, 'I2959 (mg)': 14.4  }, notes: '3:1 mol%, I2959 1wt%',  result: 'success', resultNote: '照光 1 hr 聚起來' },
      { components: { 'AA+PVP (g)': 1.4368, 'AzoIL (mg)': 10, 'I2959 (mg)': 43.2  }, notes: '3:1 mol%, I2959 3wt%',  result: 'success', resultNote: '照光 40 min 聚起來' },
      { components: { 'AA+PVP (g)': 1.4368, 'AzoIL (mg)': 10, 'I2959 (mg)': 72.0  }, notes: '3:1 mol%, I2959 5wt%',  result: 'success', resultNote: '照光 30 min 聚起來' },
      { components: { 'AA+PVP (g)': 1.4368, 'AzoIL (mg)': 10, 'I2959 (mg)': 144.0 }, notes: '3:1 mol%, I2959 10wt%', result: 'success', resultNote: '照光 30 min 聚起來' },
    ],
  },
  {
    id: '0130',
    date: '2026-01-30',
    dateLabel: '1/30',
    system: 'Acrylamide/PVP',
    description: '轉換至 Acrylamide 系統',
    entries: [
      { components: { 'Acrylamide (mg)': 1000, 'PVP (mg)': 1000, 'AzoIL (mg)': 10, 'I2959 (mg)': '5/10/30', 'MBA (mg)': 2.168, 'H2O (mg)': 3000, 'Glycerol (mg)': 1000 }, notes: 'MBA 0.1mol%', result: 'partial', resultNote: '1 hr, 3wt% 的略稠' },
      { components: { 'Acrylamide (mg)': 1000, 'PVP (mg)': 1000, 'I2959 (mg)': 30,        'MBA (mg)': 2.168, 'H2O (mg)': 3000, 'Glycerol (mg)': 1000 }, notes: 'I2959 3wt%, MBA 0.1mol%', result: 'success', resultNote: '30 min 成功' },
      { components: { 'Acrylamide (mg)': 1000, 'PVP (mg)': 1000, 'I2959 (mg)': 30,        'MBA (mg)': 2.168, 'H2O (mg)': 3000 }, notes: '無 Glycerol', result: 'success', resultNote: '30 min 成功' },
    ],
  },
  {
    id: '0202',
    date: '2026-02-02',
    dateLabel: '2/2',
    system: 'Acrylamide/PVP/AzoIL',
    description: '引入 AzoIL 至 AAm 系統',
    entries: [
      { components: { 'Acrylamide (mg)': 1000, 'PVP (mg)': 1000, 'AzoIL (mg)': 10, 'I2959 (mg)': 50,  'MBA (mg)': 2.168, 'H2O (mg)': 3000, 'Glycerol (mg)': 1000 }, notes: 'I2959 5wt%',  result: 'partial', resultNote: '30 min 略稠, 1 hr 略稠' },
      { components: { 'Acrylamide (mg)': 1000, 'PVP (mg)': 1000, 'AzoIL (mg)': 10, 'I2959 (mg)': 100, 'MBA (mg)': 2.168, 'H2O (mg)': 3000, 'Glycerol (mg)': 1000 }, notes: 'I2959 10wt%', result: 'success', resultNote: '30 min 略稠, 1 hr 聚起來' },
      { components: { 'Acrylamide (mg)': 1000, 'PVP (mg)': 1000, 'AzoIL (mg)': 10, 'I2959 (mg)': 100, 'MBA (mg)': 2.168, 'H2O (mg)': 2000, 'Glycerol (mg)': 2000 }, notes: 'Glycerol 先加', result: 'fail',    resultNote: '相分離' },
    ],
  },
  {
    id: '0203',
    date: '2026-02-03',
    dateLabel: '2/3',
    system: 'Acrylamide/PVP/AzoIL',
    description: '提高 MBA 交聯劑至 0.5mol%',
    entries: [
      { components: { 'Acrylamide (mg)': 1000, 'PVP (mg)': 1000, 'AzoIL (mg)': 10, 'I2959 (mg)': 100, 'MBA (mg)': 10.84, 'H2O (mg)': 3000, 'Glycerol (mg)': 1000 }, notes: 'MBA 0.5mol%',   result: 'success', resultNote: '30 min 聚起來，狗骨頭 30 min 薄膜' },
      { components: { 'Acrylamide (mg)': 1000, 'PVP (mg)': 1000, 'AzoIL (mg)': 10, 'I2959 (mg)': 100, 'MBA (mg)': 10.84, 'H2O (mg)': 3000 },                        notes: '無 Glycerol',  result: 'success', resultNote: '1 hr 聚起來' },
      { components: { 'Acrylamide (mg)': 1000, 'PVP (mg)': 500,  'AzoIL (mg)': 10, 'I2959 (mg)': 100, 'MBA (mg)': 10.84, 'H2O (mg)': 2000, 'Glycerol (mg)': 1000 }, notes: 'PVP 減半',    result: 'success', resultNote: '30 min 聚起來' },
    ],
  },
  {
    id: '0304',
    date: '2026-03-04',
    dateLabel: '3/4',
    system: 'DMAA/NVP/AzoIL-Br',
    description: '轉換至 DMAA/NVP 系統',
    entries: [
      { components: { 'DMAA (mg)': 300, 'NVP (mg)': 400, 'AzoIL-Br (mg)': 0,  'TPO-L (mg)': 7, 'MBA (mg)': 5, 'DES (mg)': 300 },                             notes: 'DES 溶劑系統',  result: 'fail',    resultNote: 'DES 沒有形成' },
      { components: { 'DMAA (mg)': 300, 'NVP (mg)': 400, 'AzoIL-Br (mg)': 0,  'TPO-L (mg)': 7, 'MBA (mg)': 5, 'H2O (mg)': 150, 'Glycerol (mg)': 150 },      notes: 'TPO-L 1wt%',   result: 'success', resultNote: '30 sec 聚起來' },
      { components: { 'DMAA (mg)': 300, 'NVP (mg)': 400, 'AzoIL-Br (mg)': 25, 'TPO-L (mg)': 7, 'MBA (mg)': 5, 'H2O (mg)': 150, 'Glycerol (mg)': 150 },      notes: 'TPO-L 1wt%',   result: 'fail',    resultNote: '30 min 聚不起來' },
    ],
  },
  {
    id: '0311',
    date: '2026-03-11',
    dateLabel: '3/11',
    system: 'DMAA/NVP/AzoIL-Br + HP-β-CD',
    description: '引入 HP-β-CD 改善 AzoIL 溶解度',
    entries: [
      { components: { 'DMAA (mg)': 500, 'NVP (mg)': 200, 'AzoIL-Br (mg)': 10, 'TPO-L (mg)': 14, 'MBA (mg)': 5, 'H2O (mg)': 150, 'Glycerol (mg)': 150 },             notes: 'TPO-L 2wt%', result: 'fail', resultNote: '30 min 聚不起來' },
      { components: { 'DMAA (mg)': 500, 'NVP (mg)': 200, 'AzoIL-Br (mg)': 10, 'TPO-L (mg)': 35, 'MBA (mg)': 5, 'H2O (mg)': 150, 'Glycerol (mg)': 150 },             notes: 'TPO-L 5wt%', result: 'fail', resultNote: '30 min 聚不起來' },
      { components: { 'DMAA (mg)': 500, 'NVP (mg)': 200, 'AzoIL-Br (mg)': 10, 'HP-β-CD (mg)': 29.6, 'TPO-L (mg)': 14, 'MBA (mg)': 5, 'H2O (mg)': 150, 'Glycerol (mg)': 150 }, notes: '+ HP-β-CD', result: 'fail', resultNote: '30 min 聚不起來' },
    ],
  },
  {
    id: '0318',
    date: '2026-03-18',
    dateLabel: '3/18',
    system: 'DMAA/NVP/AzoIL-TFSI + HP-β-CD',
    description: '切換至 AzoTFSI，大幅改善相容性',
    entries: [
      { components: { 'DMAA (mg)': 600, 'NVP (mg)': 100, 'AzoIL-TFSI (mg)': 10, 'TPO-L (mg)': 35, 'MBA (mg)': 5 },                                                                      notes: '無溶劑',  result: 'fail',    resultNote: '30 min 聚不起來' },
      { components: { 'DMAA (mg)': 600, 'NVP (mg)': 100, 'AzoIL-TFSI (mg)': 10, 'HP-β-CD (mg)': 19.91, 'TPO-L (mg)': 35, 'MBA (mg)': 5, 'H2O (mg)': 150, 'Glycerol (mg)': 150 }, notes: '有溶劑',  result: 'success', resultNote: '不到 20 min 可聚合' },
      { components: { 'DMAA (mg)': 600, 'NVP (mg)': 100, 'AzoIL-TFSI (mg)': 10, 'HP-β-CD (mg)': 19.91, 'TPO-L (mg)': 35, 'MBA (mg)': 5 },                                          notes: '無溶劑',  result: 'success', resultNote: '不到 20 min 可聚合，相比有溶劑較硬' },
    ],
  },
  {
    id: '0408',
    date: '2026-04-08',
    dateLabel: '4/8',
    system: 'DMAA/NVP/AzoIL-TFSI + HP-β-CD',
    description: '調整 AzoIL 用量（10→100 mg）',
    entries: [
      { components: { 'DMAA (mg)': 600, 'NVP (mg)': 100, 'AzoIL-TFSI (mg)': 30,  'HP-β-CD (mg)': 59.73,  'TPO-L (mg)': 35, 'H2O (mg)': 150, 'Glycerol (mg)': 150 },              notes: 'AzoIL ×3，無MBA',   result: 'fail', resultNote: '需加熱才可溶，聚不起來' },
      { components: { 'DMAA (mg)': 600, 'NVP (mg)': 100, 'AzoIL-TFSI (mg)': 50,  'HP-β-CD (mg)': 99.55,  'TPO-L (mg)': 35, 'H2O (mg)': 150, 'Glycerol (mg)': 150 },              notes: 'AzoIL ×5，無MBA',   result: 'fail', resultNote: 'HP-β-CD 不溶' },
      { components: { 'DMAA (mg)': 600, 'NVP (mg)': 100, 'AzoIL-TFSI (mg)': 100, 'HP-β-CD (mg)': 199.91, 'TPO-L (mg)': 35, 'H2O (mg)': 150, 'Glycerol (mg)': 150 },              notes: 'AzoIL ×10，無MBA',  result: 'fail', resultNote: 'HP-β-CD 不溶' },
      { components: { 'DMAA (mg)': 600, 'NVP (mg)': 100, 'AzoIL-TFSI (mg)': 20,  'HP-β-CD (mg)': 39.82,  'TPO-L (mg)': 35, 'MBA (mg)': 5, 'H2O (mg)': 150, 'Glycerol (mg)': 150 }, notes: 'AzoIL ×2 + MBA',  result: 'fail', resultNote: '聚失敗' },
      { components: { 'DMAA (mg)': 600, 'NVP (mg)': 100, 'AzoIL-TFSI (mg)': 30,  'HP-β-CD (mg)': 59.73,  'TPO-L (mg)': 35, 'MBA (mg)': 5, 'H2O (mg)': 150, 'Glycerol (mg)': 150 }, notes: 'AzoIL ×3 + MBA',  result: 'fail', resultNote: '聚失敗' },
    ],
  },
];

module.exports = { formulations };
