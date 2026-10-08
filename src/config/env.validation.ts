export function validateEnv(config: Record<string, unknown>) {
  const required = [
    'DATABASE_URL',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
  ]

  const missing = required.filter((key) => !config[key])

  if (config.NODE_ENV === 'production') {
    for (const key of ['RESEND_API_KEY', 'RESEND_FROM_EMAIL']) {
      if (!config[key]) {
        missing.push(key)
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    )
  }

  return config
}
