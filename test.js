// Run: node test.js
import { generateFFR, derive30yRate, bondPrice, simulateRolling, simulateFixed } from './simulation.js';

console.log('=== BOND SIMULATION TESTS ===\n');
const tests = [];

// Test 1: FFR generator with zero volatility
const ffr = generateFFR(5, 5, 5, 0, 10);
tests.push(['Constant FFR (vol=0)', ffr.every(r => Math.abs(r - 5) < 0.5)]);

// Test 2: 30y rate derivation
const rates30y = derive30yRate([5, 5, 5], 4.7, 5);
tests.push(['30y rate stable when FFR stable', rates30y.every(r => Math.abs(r - 4.7) < 0.01)]);

// Test 3: Fixed with constant FFR (should compound at FFR rate for coupons)
const constantFFR = Array(31).fill(4.7);
const fixed = simulateFixed(10000, 4.7, 30, constantFFR);
// With constant 4.7% FFR, coupons reinvested at 4.7% should give same as simple compound
const expected = 10000 * Math.pow(1.047, 30);
tests.push([`Fixed 4.7% 30y with constant FFR ~= ${expected.toFixed(0)}`, Math.abs(fixed.finalValue - expected) / expected < 0.01]);

// Test 4: Rolling with stable rates (FFR=30y=4.7, vol=0)
const rolling = simulateRolling(10000, 4.7, 4.7, 4.7, 4.7, 0, 30, 30, 20);
const fixedWithRollingFFR = simulateFixed(10000, 4.7, 30, rolling.ffr);
const diff = Math.abs(rolling.values.at(-1) - fixedWithRollingFFR.finalValue) / fixedWithRollingFFR.finalValue * 100;
tests.push([`Rolling ~= Fixed at constant rate (diff ${diff.toFixed(2)}%)`, diff < 1]);

// Test 5: Initial NAV
tests.push(['Initial NAV = 10000', Math.abs(rolling.values[0] - 10000) < 1]);

// Test 6: Bond price at par = 1
const parPrice = bondPrice(5, 5, 20);
tests.push([`Bond price at par = 1 (got ${parPrice.toFixed(4)})`, Math.abs(parPrice - 1) < 0.001]);

// Results
tests.forEach(([name, pass]) => console.log(`${pass ? 'PASS' : 'FAIL'}: ${name}`));
console.log(`\n${tests.filter(t => t[1]).length}/${tests.length} passed`);
process.exit(tests.every(t => t[1]) ? 0 : 1);
