process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});


import { closeDatabase, initializeDatabase } from './database.js';

let fastify;


const start = async () => {
    try {
        await initializeDatabase();
        ({ default: fastify } = await import('./api.js'));
        await fastify.listen({ port: 8080, host: '0.0.0.0' });

    } catch (err) {
        if (fastify) fastify.log.error(err);
        else console.error(err);
        await closeDatabase().catch(() => undefined);
        process.exit(1);
    }
};

const shutdown = async (signal) => {
    fastify?.log.info(`${signal} received, shutting down`);
    if (fastify) await fastify.close();
    await closeDatabase();
    process.exit(0);
};

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

start();