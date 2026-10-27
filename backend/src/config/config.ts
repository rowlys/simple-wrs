// Typed env config, validated once at startup; the app refuses to start on a bad value (spec §8, §10).
export abstract class AppConfig {
  abstract readonly databaseUrl: string;
  abstract readonly jwtSecret: string;
  abstract readonly jwtExpiresInSeconds: number;
  abstract readonly port: number;
}

const SECONDS_PER_UNIT = { s: 1, m: 60, h: 3600, d: 86400 } as const;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const fail = (message: string): never => {
    throw new Error(`Invalid configuration: ${message}`);
  };

  const databaseUrl = env.DATABASE_URL || fail('DATABASE_URL is required');
  const jwtSecret = env.JWT_SECRET || fail('JWT_SECRET is required');
  if (jwtSecret.length < 32) fail('JWT_SECRET must be at least 32 characters');

  // A bare number would be read as milliseconds by jsonwebtoken, so a unit is mandatory.
  const expiresIn = env.JWT_EXPIRES_IN || '8h';
  const [, amount, unit] =
    /^(\d+)([smhd])$/.exec(expiresIn) ?? fail(`JWT_EXPIRES_IN must match ^\d+[smhd]$ (e.g. 8h), got "${expiresIn}"`);

  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`PORT must be a port number, got "${env.PORT}"`);

  return {
    databaseUrl,
    jwtSecret,
    jwtExpiresInSeconds: Number(amount) * SECONDS_PER_UNIT[unit as keyof typeof SECONDS_PER_UNIT],
    port,
  };
}
