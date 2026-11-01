import type { Deal, Stage } from './types';

/** Small deterministic PRNG so every run (and every reviewer) sees the same data. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const CURRENT_USER = 'Akshay Manocha';

export const OWNERS = [
  CURRENT_USER,
  'Rahul Verma',
  'Ananya Iyer',
  'Vikram Singh',
  'Neha Kapoor',
  'Arjun Mehta',
  'Sneha Reddy',
  'Karan Malhotra',
  'Pooja Nair',
  'Rohit Gupta',
  'Divya Menon',
  'Aditya Joshi',
  'Meera Pillai',
  'Siddharth Rao',
  'Kavya Desai',
  'Nikhil Bansal',
  'Ishita Chawla',
  'Manish Agarwal',
  'Tanvi Shah',
  'Varun Khanna',
];

const PREFIX = [
  'Acme',
  'Globex',
  'Initech',
  'Umbrella',
  'Stark',
  'Wayne',
  'Tyrell',
  'Soylent',
  'Hooli',
  'Vandelay',
  'Pied Piper',
  'Wonka',
  'Cyberdyne',
  'Gringotts',
  'Oscorp',
  'Nakatomi',
  'Zenith',
  'Sapphire',
  'Lotus',
  'Banyan',
  'Peacock',
  'Indus',
  'Ganga',
  'Himalaya',
  'Saffron',
  'Monsoon',
  'Deccan',
  'Konark',
  'Ashoka',
  'Nimbus',
  'Quantum',
  'Vertex',
  'Orbit',
  'Pinnacle',
  'Summit',
  'Harbor',
  'Falcon',
  'Tiger',
  'Cobalt',
  'Silverline',
  'Bluechip',
  'Greenleaf',
  'Redwood',
  'Northstar',
  'Brightpath',
  'Clearwater',
  'Ironclad',
];
const MIDDLE = [
  '',
  '',
  'Tech',
  'Digital',
  'Retail',
  'Health',
  'Foods',
  'Motors',
  'Logistics',
  'Finance',
  'Energy',
  'Media',
];
const SUFFIX = ['Corp', 'Pvt Ltd', 'Ltd', 'Labs', 'Systems', 'Industries', 'Solutions', 'Group', 'Ventures', 'Inc'];

// Rough shape of a real pipeline: wide at the top, narrow at the bottom.
const STAGE_WEIGHTS: [Stage, number][] = [
  ['new', 10000],
  ['contacted', 10000],
  ['demo', 8000],
  ['proposal', 6500],
  ['negotiation', 4500],
  ['won', 5000],
  ['lost', 6000],
];

const DAY = 86_400_000;

export function generateDeals(count = 50_000, seed = 42, now = Date.now()): Deal[] {
  const rand = mulberry32(seed);
  const pick = <T>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const totalWeight = STAGE_WEIGHTS.reduce((s, [, w]) => s + w, 0);

  const deals: Deal[] = [];
  for (let i = 0; i < count; i++) {
    let r = rand() * totalWeight;
    let stage: Stage = 'new';
    for (const [s, w] of STAGE_WEIGHTS) {
      if ((r -= w) <= 0) {
        stage = s;
        break;
      }
    }
    const mid = pick(MIDDLE);
    const company = `${pick(PREFIX)}${mid ? ' ' + mid : ''} ${pick(SUFFIX)}`;
    const licences = 5 + Math.floor(rand() * rand() * 500);
    const pricePerLicence = 4000 + Math.floor(rand() * 16) * 1000;
    const idleDays = Math.floor(rand() * rand() * 200);
    const closeOffset = Math.floor(rand() * 120) - 30;
    deals.push({
      id: `D-${String(i + 1).padStart(5, '0')}`,
      company,
      companyLc: company.toLowerCase(),
      licences,
      value: licences * pricePerLicence,
      owner: OWNERS[Math.floor(rand() * OWNERS.length)],
      stage,
      lastActivityAt: now - idleDays * DAY - Math.floor(rand() * DAY),
      closeDate: now + closeOffset * DAY,
      version: 1,
      updatedBy: 'system',
      updatedAt: now - idleDays * DAY,
    });
  }
  return deals;
}
