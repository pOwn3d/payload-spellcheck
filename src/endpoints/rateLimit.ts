/**
 * Simple in-memory rate limiter — no external dependencies.
 * Tracks requests by IP address using a sliding window approach.
 */

interface RateLimitEntry {
  timestamps: number[]
}

/**
 * Create a rate limiter that allows `maxRequests` per `windowMs` milliseconds.
 * Returns a function that checks if a request from the given IP should be allowed.
 *
 * Usage:
 *   const limiter = createRateLimiter(30, 60_000) // 30 req/min
 *   if (!limiter.check(ip)) return 429
 */
export function createRateLimiter(maxRequests: number, windowMs: number) {
  const store = new Map<string, RateLimitEntry>()

  // Periodic cleanup to prevent unbounded memory growth (every 5 minutes)
  const CLEANUP_INTERVAL = 5 * 60 * 1000
  let lastCleanup = Date.now()

  function cleanup(now: number): void {
    if (now - lastCleanup < CLEANUP_INTERVAL) return
    lastCleanup = now

    for (const [ip, entry] of store) {
      // Remove entries where all timestamps are expired
      if (entry.timestamps.length === 0 || entry.timestamps[entry.timestamps.length - 1] < now - windowMs) {
        store.delete(ip)
      }
    }
  }

  return {
    /**
     * Check if the request from `ip` is allowed.
     * Returns true if allowed, false if rate limit exceeded.
     */
    check(ip: string): boolean {
      const now = Date.now()
      cleanup(now)

      const entry = store.get(ip)
      if (!entry) {
        store.set(ip, { timestamps: [now] })
        return true
      }

      // Remove timestamps outside the current window
      const cutoff = now - windowMs
      entry.timestamps = entry.timestamps.filter((t) => t > cutoff)

      if (entry.timestamps.length >= maxRequests) {
        return false
      }

      entry.timestamps.push(now)
      return true
    },
  }
}

/**
 * Extract client IP from a Payload request.
 * Checks x-forwarded-for, x-real-ip, then falls back to 'unknown'.
 *
 * SECURITY NOTE: x-forwarded-for and x-real-ip headers can be spoofed by
 * clients when there is no trusted reverse proxy stripping/overwriting them.
 * This rate limiter is a best-effort defense-in-depth measure. In production,
 * ensure your reverse proxy (nginx, Cloudflare, etc.) sets these headers from
 * the actual client IP and strips any client-supplied values.
 *
 * If `trustProxy` is false, only 'unknown' is returned (all clients share
 * the same bucket, effectively a global rate limit).
 */
export function getClientIp(req: { headers: Headers }, trustProxy = true): string {
  if (trustProxy) {
    const forwarded = req.headers.get('x-forwarded-for')
    if (forwarded) {
      // x-forwarded-for can contain multiple IPs; take the first (client)
      return forwarded.split(',')[0].trim()
    }

    const realIp = req.headers.get('x-real-ip')
    if (realIp) return realIp.trim()
  }

  return 'unknown'
}

/**
 * Helper to create a 429 Too Many Requests response.
 */
export function rateLimitResponse(retryAfter = 60): Response {
  return Response.json(
    { error: 'Too many requests. Please try again later.' },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } },
  )
}
