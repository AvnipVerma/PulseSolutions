import { PrismaClient } from '@prisma/client';

import { ensureEnvLoaded } from './config/load-env.js';

ensureEnvLoaded();

if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set');
}

const globalForPrisma = global;
const globalForPrismaStatus = globalForPrisma;

export const prisma =
    globalForPrisma.prisma ||
    new PrismaClient({
        log: ['query'],
    });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

if (!globalForPrismaStatus.prismaConnectionPromise) {
    globalForPrismaStatus.prismaConnectionPromise = prisma
        .$connect()
        .then(() => {
            console.log('Database connected successfully.');
        })
        .catch((error) => {
            console.error('Database connection failed.', error);
            throw error;
        });
}
