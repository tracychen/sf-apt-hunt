import { Redis } from "@upstash/redis";

type FixedWindowRateLimitOptions = {
  redis: Redis;
  key: string;
  limit: number;
  windowSeconds: number;
};

type FixedWindowRateLimitResult = {
  ok: boolean;
  remaining: number;
  resetAt: Date;
};

export function createRedisFromEnv(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return null;
  }

  return new Redis({ url, token });
}

export async function checkFixedWindowRateLimit({
  redis,
  key,
  limit,
  windowSeconds,
}: FixedWindowRateLimitOptions): Promise<FixedWindowRateLimitResult> {
  // Initialise the counter and its expiry atomically: SET NX EX only creates
  // the key (with a TTL) when it is absent, so a crash can never leave a
  // counter without an expiry and permanently lock out the caller.
  await redis.set(key, 0, { nx: true, ex: windowSeconds });
  const current = await redis.incr(key);

  let ttl = await redis.ttl(key);
  if (ttl < 0) {
    await redis.expire(key, windowSeconds);
    ttl = windowSeconds;
  }

  const resetInSeconds = ttl;

  return {
    ok: current <= limit,
    remaining: Math.max(0, limit - current),
    resetAt: new Date(Date.now() + resetInSeconds * 1000),
  };
}
