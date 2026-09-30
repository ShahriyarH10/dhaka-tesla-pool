// Geography is deliberately simple: a fixed list of Dhaka zones and a hand-written road-distance table.
// The distances are INVENTED, approximate road kilometres (not real routing) so fares can be checked by hand.
// Single source of truth: the `zones` DB table is synced from this file at boot (see syncZones).

export const ZONES = [
  { id: 'banani', name: 'Banani', lat: 23.7937, lng: 90.4066 },
  { id: 'gulshan-1', name: 'Gulshan 1', lat: 23.7808, lng: 90.4167 },
  { id: 'mohakhali', name: 'Mohakhali', lat: 23.7781, lng: 90.402 },
  { id: 'dhanmondi', name: 'Dhanmondi', lat: 23.7461, lng: 90.3742 },
  { id: 'mirpur', name: 'Mirpur', lat: 23.8069, lng: 90.3687 },
  { id: 'uttara', name: 'Uttara', lat: 23.8759, lng: 90.3795 },
  { id: 'farmgate', name: 'Farmgate', lat: 23.7561, lng: 90.3872 },
  { id: 'bashundhara', name: 'Bashundhara', lat: 23.8193, lng: 90.4526 },
];

// Symmetric table, metres. Each unordered pair appears once.
const PAIRS_M = {
  'banani|gulshan-1': 3000,
  'banani|mohakhali': 2000,
  'banani|dhanmondi': 8000,
  'banani|mirpur': 9000,
  'banani|uttara': 10000,
  'banani|farmgate': 4000,
  'banani|bashundhara': 6000,
  'gulshan-1|mohakhali': 3500,
  'gulshan-1|dhanmondi': 9500,
  'gulshan-1|mirpur': 11000,
  'gulshan-1|uttara': 11000,
  'gulshan-1|farmgate': 6500,
  'gulshan-1|bashundhara': 4500,
  'mohakhali|dhanmondi': 6500,
  'mohakhali|mirpur': 8500,
  'mohakhali|uttara': 10500,
  'mohakhali|farmgate': 3000,
  'mohakhali|bashundhara': 6500,
  'dhanmondi|mirpur': 7500,
  'dhanmondi|uttara': 15000,
  'dhanmondi|farmgate': 3500,
  'dhanmondi|bashundhara': 10000,
  'mirpur|uttara': 8500,
  'mirpur|farmgate': 6500,
  'mirpur|bashundhara': 12000,
  'uttara|farmgate': 11500,
  'uttara|bashundhara': 7500,
  'farmgate|bashundhara': 8000,
};

const ZONE_IDS = new Set(ZONES.map((z) => z.id));

export function isValidZone(id) {
  return ZONE_IDS.has(id);
}

/** Road distance in metres between two zones; 0 for the same zone. Throws on unknown zone or missing pair. */
export function distanceMeters(a, b) {
  if (!ZONE_IDS.has(a) || !ZONE_IDS.has(b)) throw new Error(`unknown zone: ${a} / ${b}`);
  if (a === b) return 0;
  const d = PAIRS_M[`${a}|${b}`] ?? PAIRS_M[`${b}|${a}`];
  if (d === undefined) throw new Error(`no distance for ${a} <-> ${b}`);
  return d;
}

/** Idempotent upsert of the zones table (runs after migrations). */
export async function syncZones(client) {
  for (const z of ZONES) {
    await client.query(
      `INSERT INTO zones (id, name, lat, lng) VALUES ($1,$2,$3,$4)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, lat = EXCLUDED.lat, lng = EXCLUDED.lng`,
      [z.id, z.name, z.lat, z.lng],
    );
  }
}
