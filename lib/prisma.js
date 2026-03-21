import { PrismaClient } from '@prisma/client';

// ❌ Removed ensureEnvLoaded (not needed on Vercel)

if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set');
}

// Use globalThis for better compatibility (Node + Vercel)
const globalForPrisma = globalThis;

// Create or reuse Prisma instance
export const prisma =
    globalForPrisma.prisma ||
    new PrismaClient({
        log: ['error'], // avoid 'query' in production
    });

// Cache Prisma instance in development to prevent multiple instances
if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prisma;
}

// ❌ Removed manual $connect() block (Prisma handles this internally)