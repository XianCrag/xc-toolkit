// Generate FFR path with mean reversion toward 3 control points (start, mid, end)
// Interpolates linearly toward mid at midYear, then toward end at final year
export const generateFFR = (startFFR, midFFR, endFFR, volatility, years) => {
    const ffr = [startFFR];
    const midYear = Math.floor(years / 2);
    for (let i = 1; i <= years; i++) {
        // Linear interpolation: start→mid for first half, mid→end for second half
        let target;
        if (i <= midYear) {
            target = startFFR + (midFFR - startFFR) * (i / midYear);
        } else {
            target = midFFR + (endFFR - midFFR) * ((i - midYear) / (years - midYear));
        }
        const diffusion = volatility * (Math.random() * 2 - 1);
        ffr.push(Math.max(0.01, target + diffusion));
    }
    return ffr;
};

// Derive 30y rate from FFR changes
// Long-term rates are less sensitive to short-term rate changes
// Beta ~0.3 means 30y moves 30% of FFR change (typical empirical value)
export const derive30yRate = (ffr, start30y, startFFR, beta = 0.3) => {
    const rates = [start30y];
    for (let i = 1; i < ffr.length; i++) {
        const ffrChange = ffr[i] - ffr[i - 1];
        const newRate = rates[i - 1] + beta * ffrChange;
        rates.push(Math.max(0.5, newRate)); // floor at 0.5%
    }
    return rates;
};

// Bond price per $1 face value
export const bondPrice = (couponRate, marketRate, years) => {
    const r = Math.max(0.01, marketRate) / 100 / 2;
    const c = couponRate / 100 / 2;
    const n = years * 2;
    return c * (1 - Math.pow(1 + r, -n)) / r + 1 / Math.pow(1 + r, n);
};

export const simulateRolling = (investment, startFFR, midFFR, endFFR, start30y, volatility, simYears, maxMat, minMat) => {
    const ffr = generateFFR(startFFR, midFFR, endFFR, volatility, simYears);
    const rates = derive30yRate(ffr, start30y, startFFR);
    const values = [investment];
    const transactions = [];
    
    const numTranches = maxMat - minMat;
    
    // Each tranche tracks units of $1 face value bonds
    // Initially buy at par, so units = investment / numTranches
    const tranches = Array.from({ length: numTranches }, (_, i) => ({
        units: investment / numTranches,
        coupon: start30y,
        remaining: minMat + 1 + i  // 21, 22, ..., 30
    }));
    
    for (let year = 1; year <= simYears; year++) {
        const rate = rates[year];
        let sold = null, bought = null;
        let rolledIdx = -1;
        
        // Age all bonds
        for (const t of tranches) t.remaining--;
        
        // Roll first: sell bonds at minMat before reinvesting their coupons
        for (let i = 0; i < tranches.length; i++) {
            if (tranches[i].remaining <= minMat) {
                const t = tranches[i];
                const coupon = t.units * t.coupon / 100;
                const sellPrice = bondPrice(t.coupon, rate, Math.max(0.01, t.remaining));
                const saleValue = t.units * sellPrice;
                const proceeds = saleValue + coupon;
                
                sold = { units: t.units, maturity: t.remaining, coupon: t.coupon, price: sellPrice, saleValue, couponReceived: coupon, value: proceeds };
                bought = { units: proceeds, maturity: maxMat, coupon: rate, price: 1, value: proceeds };
                
                tranches[i] = { units: proceeds, coupon: rate, remaining: maxMat };
                rolledIdx = i;
            }
        }
        
        // Reinvest coupons for non-sold tranches (skip newly rolled one)
        for (let i = 0; i < tranches.length; i++) {
            if (i !== rolledIdx) {
                const t = tranches[i];
                const couponPayment = t.units * t.coupon / 100;
                const price = bondPrice(t.coupon, rate, Math.max(0.01, t.remaining));
                t.units += couponPayment / price;
            }
        }
        
        // Mark-to-market NAV (units × current bond price)
        const nav = tranches.reduce((sum, t) => 
            sum + t.units * bondPrice(t.coupon, rate, Math.max(0.01, t.remaining)), 0);
        values.push(nav);
        
        transactions.push({ year, ffr: ffr[year], rate, nav, sold, bought });
    }
    
    return { values, rates, ffr, transactions };
};

export const simulateFixed = (investment, couponRate, maturity, compoundRates) => {
    const coupon = investment * couponRate / 100;
    const values = [investment];
    const couponDetails = [];
    const isConstant = typeof compoundRates === 'number';
    const getRate = year => isConstant ? compoundRates : compoundRates[year];
    
    // Track cash accumulated from reinvested coupons
    let cash = 0;
    
    for (let year = 1; year <= maturity; year++) {
        // Compound existing cash at this year's rate
        if (year > 1) {
            cash *= (1 + getRate(year) / 100);
        }
        // Receive this year's coupon
        cash += coupon;
        
        // NAV = face value (at par for simplicity) + cash
        values.push(investment + cash);
    }
    
    // Calculate each coupon's final compounded value
    for (let year = 1; year <= maturity; year++) {
        let compounded = coupon;
        // Compound from year+1 to maturity
        for (let j = year + 1; j <= maturity; j++) {
            compounded *= (1 + getRate(j) / 100);
        }
        couponDetails.push({ year, coupon, compounded });
    }
    
    const finalValue = investment + couponDetails.reduce((sum, c) => sum + c.compounded, 0);
    
    return { values, finalValue, couponDetails };
};
