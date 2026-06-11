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
  const current = await redis.incr(key);

  if (current === 1) {
    await redis.expire(key, windowSeconds);
  }

  const ttl = await redis.ttl(key);
  const resetInSeconds = ttl > 0 ? ttl : windowSeconds;

  return {
    ok: current <= limit,
    remaining: Math.max(0, limit - current),
    resetAt: new Date(Date.now() + resetInSeconds * 1000),
  };
}
