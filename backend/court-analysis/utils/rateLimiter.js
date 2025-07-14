// Token bucket rate limiter middleware for Express
// 1000 requests/hour, 5 requests/5s per client (by IP)
// Returns 429 with X-Rate-Limit-Retry-After-Milliseconds header

const buckets = new Map();
const HOUR = 60 * 60 * 1000;
const FIVE_SECONDS = 5 * 1000;
const MAX_HOURLY = 1000;
const MAX_5S = 5;

function now() { return Date.now(); }

function getBucket(ip) {
    if (!buckets.has(ip)) {
        buckets.set(ip, {
            hourTokens: MAX_HOURLY,
            hourLast: now(),
            fiveTokens: MAX_5S,
            fiveLast: now()
        });
    }
    return buckets.get(ip);
}

function refill(bucket, max, last, interval) {
    const elapsed = now() - last;
    const tokensToAdd = Math.floor(elapsed / interval);
    if (tokensToAdd > 0) {
        return Math.min(max, bucket + tokensToAdd);
    }
    return bucket;
}

module.exports = function rateLimiter(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress;
    const bucket = getBucket(ip);
    // refill tokens
    bucket.hourTokens = refill(bucket.hourTokens, MAX_HOURLY, bucket.hourLast, HOUR / MAX_HOURLY);
    bucket.fiveTokens = refill(bucket.fiveTokens, MAX_5S, bucket.fiveLast, FIVE_SECONDS / MAX_5S);
    // check limits
    if (bucket.hourTokens <= 0) {
        const retry = HOUR - (now() - bucket.hourLast);
        res.set('X-Rate-Limit-Retry-After-Milliseconds', retry);
        return res.status(429).send('Too Many Requests (hourly limit)');
    }
    if (bucket.fiveTokens <= 0) {
        const retry = FIVE_SECONDS - (now() - bucket.fiveLast);
        res.set('X-Rate-Limit-Retry-After-Milliseconds', retry);
        return res.status(429).send('Too Many Requests (5s limit)');
    }
    // consume tokens
    bucket.hourTokens--;
    bucket.hourLast = now();
    bucket.fiveTokens--;
    bucket.fiveLast = now();
    next();
};
