// Fare model. Pure functions, integer paisa only (1 BDT = 100 paisa), no floating point.
//
//   gross         = (BASE_FARE + round(distanceMeters * PER_KM / 1000)) * seats
//   poolDiscount  = pooled ? floor(gross * POOL_DISCOUNT_PCT / 100) : 0
//   passengerFare = gross - poolDiscount
//
// Why integer paisa: floats cannot represent 0.1 exactly, so sums of fares drift and "each passenger pays
// exactly their share" stops being testable. Integers make every fare exact and hand-verifiable.
import { distanceMeters } from './zones.js';

export const FARE_CONFIG = Object.freeze({
  BASE_FARE_PAISA: 4000, // 40 BDT
  PER_KM_PAISA: 1500, // 15 BDT per km
  POOL_DISCOUNT_PCT: 20,
});

/** @returns {{baseFare:number, distanceMeters:number, distanceCharge:number, seats:number, gross:number,
 *            poolDiscount:number, pooled:boolean, total:number}} */
export function calculateFare({ pickup, destination, seats, pooled }) {
  if (!Number.isInteger(seats) || seats < 1) throw new Error('seats must be a positive integer');
  if (pickup === destination) throw new Error('pickup and destination must differ');
  const meters = distanceMeters(pickup, destination);
  const distanceCharge = Math.round((meters * FARE_CONFIG.PER_KM_PAISA) / 1000);
  const gross = (FARE_CONFIG.BASE_FARE_PAISA + distanceCharge) * seats;
  const poolDiscount = pooled ? Math.floor((gross * FARE_CONFIG.POOL_DISCOUNT_PCT) / 100) : 0;
  return {
    baseFare: FARE_CONFIG.BASE_FARE_PAISA,
    distanceMeters: meters,
    distanceCharge,
    seats,
    gross,
    poolDiscount,
    pooled: Boolean(pooled),
    total: gross - poolDiscount,
  };
}

/** What we show before matching: the solo fare plus the best-case pooled fare. */
export function estimateFare({ pickup, destination, seats }) {
  const solo = calculateFare({ pickup, destination, seats, pooled: false });
  const pooled = calculateFare({ pickup, destination, seats, pooled: true });
  return { solo, pooled, soloTotal: solo.total, pooledTotal: pooled.total };
}
