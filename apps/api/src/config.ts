import { z } from 'zod'

/** Development-only default. Production refuses it; see lib/internal-secret.ts. */
export const INSECURE_INTERNAL_AUTH_SECRET_DEFAULT = 'dev_internal_auth_secret_key_12345'
/** Development-only default. Production must point at the real database explicitly. */
export const LOCAL_DATABASE_URL_DEFAULT = 'postgresql://stealthmark:dev_password@localhost:5432/stealthmark'

const MIN_INTERNAL_AUTH_SECRET_LENGTH = 32

/** Only the literal string "true" enables a flag; "false", "0", "" and unset all stay off. */
const strictBoolean = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true')

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  /** Listen address. Containers need every interface; a host that puts a local proxy in front of the API sets 127.0.0.1. */
  HOST: z.string().min(1).default('0.0.0.0'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  DATABASE_URL: z.string().default(LOCAL_DATABASE_URL_DEFAULT),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  /** Reverse proxies in front of the API (Cloud Run's Google front end is one). The client address is the Nth entry from the right of X-Forwarded-For. */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  GCP_PROJECT_ID: z.string().optional(),
  /** Optional fallback for /v1/web when Scrapling fails. Unset means no fallback: the request fails instead of charging for fabricated content. */
  WEB_VISION_UPSTREAM_URL: z.string().url().optional(),
  WEB_VISION_API_KEY: z.string().optional(),
  SCRAPLING_SERVICE_URL: z.string().url().default('http://localhost:8001'),
  SKIP_DNS_VERIFICATION: strictBoolean,
  PASSPORT_PRIVATE_KEY: z.string().optional(),
  PASSPORT_PUBLIC_KEY: z.string().optional(),
  REDIS_URL: z.string().optional(),
  FEATURE_COMMERCE: strictBoolean,
  FEATURE_PASSPORTS: strictBoolean,
  INTERNAL_AUTH_SECRET: z.string().default(INSECURE_INTERNAL_AUTH_SECRET_DEFAULT),
  RESEND_API_KEY: z.string().min(1).optional(),
  QUOTA_ALERT_FROM: z.string().min(1).default('StealthMark <alerts@stealthmark.io>'),
}).refine(
  (data) => !(data.NODE_ENV === 'production' && (!data.DATABASE_URL || data.DATABASE_URL === LOCAL_DATABASE_URL_DEFAULT)),
  {
    message: 'DATABASE_URL must be set explicitly in production environment',
    path: ['DATABASE_URL'],
  }
).refine(
  (data) => !(data.NODE_ENV === 'production' && data.SKIP_DNS_VERIFICATION),
  {
    message: 'SKIP_DNS_VERIFICATION cannot be enabled in production environment',
    path: ['SKIP_DNS_VERIFICATION'],
  }
).refine(
  (data) => !(data.NODE_ENV === 'production' && (!data.PASSPORT_PRIVATE_KEY || !data.PASSPORT_PUBLIC_KEY)),
  {
    message: 'PASSPORT_PRIVATE_KEY and PASSPORT_PUBLIC_KEY are required in production environment',
    path: ['PASSPORT_PRIVATE_KEY'],
  }
).refine(
  (data) =>
    data.NODE_ENV !== 'production' ||
    (data.INTERNAL_AUTH_SECRET !== INSECURE_INTERNAL_AUTH_SECRET_DEFAULT &&
      data.INTERNAL_AUTH_SECRET.length >= MIN_INTERNAL_AUTH_SECRET_LENGTH),
  {
    message: `INTERNAL_AUTH_SECRET must be set to a non-default value of at least ${MIN_INTERNAL_AUTH_SECRET_LENGTH} characters in production`,
    path: ['INTERNAL_AUTH_SECRET'],
  }
)

export const config = envSchema.parse(process.env)
export type Config = z.infer<typeof envSchema>

export interface FeatureFlags {
  commerce: boolean
  passports: boolean
}

export function resolveFeatures(overrides: Partial<FeatureFlags> = {}): FeatureFlags {
  return {
    commerce: overrides.commerce ?? config.FEATURE_COMMERCE,
    passports: overrides.passports ?? config.FEATURE_PASSPORTS,
  }
}
